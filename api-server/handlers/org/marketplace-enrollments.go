package org

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

const defaultEnrollmentLimit = 20
const maxEnrollmentLimit = 100

// ListProviderEnrollments handles POST /org/marketplace/provider-enrollments/list
func ListProviderEnrollments(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			log.Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.ListProviderEnrollmentsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		limit := int32(defaultEnrollmentLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxEnrollmentLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxEnrollmentLimit
			}
		}

		params := regionaldb.ListMarketplaceEnrollmentsByOrgParams{
			OrgID:      orgUser.OrgID,
			LimitCount: limit + 1,
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			parts := splitEnrollmentPaginationKey(*req.PaginationKey)
			if parts != nil {
				params.PaginationKeyUpdatedAt = pgtype.Timestamptz{Time: parts.updatedAt, Valid: true}
				params.PaginationKeyCapabilitySlug = parts.capabilitySlug
			}
		}

		rows, err := s.Regional.ListMarketplaceEnrollmentsByOrg(ctx, params)
		if err != nil {
			log.Error("failed to list enrollments", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > int(limit)
		if hasMore {
			rows = rows[:limit]
		}

		enrollments := make([]orgtypes.MarketplaceEnrollment, 0, len(rows))
		for _, row := range rows {
			enrollments = append(enrollments, dbEnrollmentToAPI(row))
		}

		var nextKey *string
		if hasMore && len(rows) > 0 {
			last := rows[len(rows)-1]
			key := encodeEnrollmentPaginationKey(last.UpdatedAt.Time, last.CapabilitySlug)
			nextKey = &key
		}

		resp := orgtypes.ListProviderEnrollmentsResponse{
			Enrollments:       enrollments,
			NextPaginationKey: nextKey,
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

type enrollmentPaginationKey struct {
	updatedAt      time.Time
	capabilitySlug string
}

// splitEnrollmentPaginationKey parses an enrollment pagination key.
// Returns nil if the key is invalid.
func splitEnrollmentPaginationKey(key string) *enrollmentPaginationKey {
	// key format: "RFC3339Nano|capabilitySlug"
	for i, c := range key {
		if c == '|' {
			t, err := time.Parse(time.RFC3339Nano, key[:i])
			if err != nil {
				return nil
			}
			return &enrollmentPaginationKey{updatedAt: t, capabilitySlug: key[i+1:]}
		}
	}
	return nil
}

// GetProviderEnrollment handles POST /org/marketplace/provider-enrollments/get
func GetProviderEnrollment(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			log.Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.GetProviderEnrollmentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		enrollment, err := s.Regional.GetMarketplaceEnrollmentByOrgAndCapability(ctx,
			regionaldb.GetMarketplaceEnrollmentByOrgAndCapabilityParams{
				OrgID:          orgUser.OrgID,
				CapabilitySlug: req.CapabilitySlug,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get enrollment", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if err := json.NewEncoder(w).Encode(dbEnrollmentToAPI(enrollment)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// ApplyProviderEnrollment handles POST /org/marketplace/provider-enrollments/apply
func ApplyProviderEnrollment(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			log.Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.ApplyProviderEnrollmentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Look up the capability to determine enrollment_approval mode
		cap, err := s.Global.GetMarketplaceCapabilityBySlug(ctx, req.CapabilitySlug)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get marketplace capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if !cap.ProviderEnabled {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		appNote := pgtype.Text{}
		if req.ApplicationNote != nil {
			appNote = pgtype.Text{String: *req.ApplicationNote, Valid: true}
		}

		var enrollment regionaldb.MarketplaceEnrollment
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			if cap.EnrollmentApproval == "open" {
				enrollment, txErr = qtx.CreateMarketplaceEnrollmentApproved(ctx,
					regionaldb.CreateMarketplaceEnrollmentApprovedParams{
						OrgID:           orgUser.OrgID,
						CapabilitySlug:  req.CapabilitySlug,
						ApplicationNote: appNote,
					})
			} else {
				enrollment, txErr = qtx.CreateMarketplaceEnrollmentPendingReview(ctx,
					regionaldb.CreateMarketplaceEnrollmentPendingReviewParams{
						OrgID:           orgUser.OrgID,
						CapabilitySlug:  req.CapabilitySlug,
						ApplicationNote: appNote,
					})
			}
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_enrollment_applied",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"capability_slug":"` + req.CapabilitySlug + `"}`),
			})
		})
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				w.WriteHeader(http.StatusConflict)
				return
			}
			if errors.Is(err, pgx.ErrNoRows) {
				// ON CONFLICT DO UPDATE WHERE condition was false (enrollment already active/pending)
				w.WriteHeader(http.StatusConflict)
				return
			}
			log.Error("failed to apply enrollment", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if err := json.NewEncoder(w).Encode(dbEnrollmentToAPI(enrollment)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// ReapplyProviderEnrollment handles POST /org/marketplace/provider-enrollments/reapply
func ReapplyProviderEnrollment(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			log.Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.ReapplyProviderEnrollmentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Verify the enrollment exists and is in rejected/expired state
		existing, err := s.Regional.GetMarketplaceEnrollmentByOrgAndCapability(ctx,
			regionaldb.GetMarketplaceEnrollmentByOrgAndCapabilityParams{
				OrgID:          orgUser.OrgID,
				CapabilitySlug: req.CapabilitySlug,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get enrollment for reapply", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if existing.Status != regionaldb.MarketplaceEnrollmentStatusRejected &&
			existing.Status != regionaldb.MarketplaceEnrollmentStatusExpired {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Look up the capability for enrollment_approval mode
		cap, err := s.Global.GetMarketplaceCapabilityBySlug(ctx, req.CapabilitySlug)
		if err != nil {
			log.Error("failed to get marketplace capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if !cap.ProviderEnabled {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		appNote := pgtype.Text{}
		if req.ApplicationNote != nil {
			appNote = pgtype.Text{String: *req.ApplicationNote, Valid: true}
		}

		var enrollment regionaldb.MarketplaceEnrollment
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			if cap.EnrollmentApproval == "open" {
				enrollment, txErr = qtx.CreateMarketplaceEnrollmentApproved(ctx,
					regionaldb.CreateMarketplaceEnrollmentApprovedParams{
						OrgID:           orgUser.OrgID,
						CapabilitySlug:  req.CapabilitySlug,
						ApplicationNote: appNote,
					})
			} else {
				enrollment, txErr = qtx.CreateMarketplaceEnrollmentPendingReview(ctx,
					regionaldb.CreateMarketplaceEnrollmentPendingReviewParams{
						OrgID:           orgUser.OrgID,
						CapabilitySlug:  req.CapabilitySlug,
						ApplicationNote: appNote,
					})
			}
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_enrollment_reapplied",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"capability_slug":"` + req.CapabilitySlug + `"}`),
			})
		})
		if err != nil {
			log.Error("failed to reapply enrollment", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if err := json.NewEncoder(w).Encode(dbEnrollmentToAPI(enrollment)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
