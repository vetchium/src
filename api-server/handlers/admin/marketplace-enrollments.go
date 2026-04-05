package admin

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	admintypes "vetchium-api-server.typespec/admin"
)

const defaultAdminEnrollmentLimit = 50
const maxAdminEnrollmentLimit = 200

// AdminListEnrollments handles POST /admin/marketplace/provider-enrollments/list
// Iterates over all regional DBs and merges results (admin has global view).
func AdminListEnrollments(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminListEnrollmentsRequest
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

		limit := int32(defaultAdminEnrollmentLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxAdminEnrollmentLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxAdminEnrollmentLimit
			}
		}

		// Resolve optional org domain filter to org UUID.
		var filterOrgID pgtype.UUID
		var filterOrgDomain string
		if req.FilterOrgDomain != nil && *req.FilterOrgDomain != "" {
			filterOrgDomain = *req.FilterOrgDomain
			org, err := s.Global.GetOrgByDomain(ctx, filterOrgDomain)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					// No org found, return empty list.
					resp := admintypes.AdminListEnrollmentsResponse{
						Enrollments: []admintypes.AdminMarketplaceEnrollment{},
					}
					json.NewEncoder(w).Encode(resp)
					return
				}
				log.Error("failed to get org by domain", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			filterOrgID = org.OrgID
		}

		// Build filter status.
		var filterStatus regionaldb.NullMarketplaceEnrollmentStatus
		if req.FilterStatus != nil && *req.FilterStatus != "" {
			filterStatus = regionaldb.NullMarketplaceEnrollmentStatus{
				MarketplaceEnrollmentStatus: regionaldb.MarketplaceEnrollmentStatus(*req.FilterStatus),
				Valid:                       true,
			}
		}

		var filterCapSlug pgtype.Text
		if req.FilterCapabilitySlug != nil && *req.FilterCapabilitySlug != "" {
			filterCapSlug = pgtype.Text{String: *req.FilterCapabilitySlug, Valid: true}
		}

		var paginationKey pgtype.Text
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			paginationKey = pgtype.Text{String: *req.PaginationKey, Valid: true}
		}

		type enrollmentItem struct {
			domain     string
			enrollment regionaldb.MarketplaceEnrollment
		}

		// Gather enrollments from all regions.
		var all []enrollmentItem

		for _, region := range s.AllRegions() {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			rows, err := rdb.ListAllMarketplaceEnrollments(ctx, regionaldb.ListAllMarketplaceEnrollmentsParams{
				FilterOrgID:          filterOrgID,
				FilterCapabilitySlug: filterCapSlug,
				FilterStatus:         filterStatus,
				PaginationKey:        paginationKey,
				LimitCount:           limit + 1,
			})
			if err != nil {
				log.Error("failed to list enrollments in region", "region", region, "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			for _, e := range rows {
				// Resolve org domain.
				orgDomain := ""
				if filterOrgDomain != "" {
					orgDomain = filterOrgDomain
				} else {
					domains, domErr := s.Global.GetGlobalOrgDomainsByOrg(ctx, e.OrgID)
					if domErr == nil && len(domains) > 0 {
						orgDomain = domains[0].Domain
					}
				}
				all = append(all, enrollmentItem{domain: orgDomain, enrollment: e})
			}
		}

		// Sort merged results by capability_slug for stable pagination.
		sort.Slice(all, func(i, j int) bool {
			if all[i].enrollment.CapabilitySlug != all[j].enrollment.CapabilitySlug {
				return all[i].enrollment.CapabilitySlug < all[j].enrollment.CapabilitySlug
			}
			return all[i].domain < all[j].domain
		})

		hasMore := len(all) > int(limit)
		if hasMore {
			all = all[:limit]
		}

		enrollments := make([]admintypes.AdminMarketplaceEnrollment, 0, len(all))
		for _, item := range all {
			enrollments = append(enrollments, adminEnrollmentToAPI(item.domain, item.enrollment))
		}

		var nextKey *string
		if hasMore && len(all) > 0 {
			last := all[len(all)-1]
			k := last.enrollment.CapabilitySlug
			nextKey = &k
		}

		resp := admintypes.AdminListEnrollmentsResponse{
			Enrollments:       enrollments,
			NextPaginationKey: nextKey,
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminGetEnrollment handles POST /admin/marketplace/provider-enrollments/get
func AdminGetEnrollment(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminGetEnrollmentRequest
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

		org, err := s.Global.GetOrgByDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		rdb := s.GetRegionalDB(org.Region)
		if rdb == nil {
			log.Error("no regional DB for org region", "region", org.Region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		enrollment, err := rdb.GetMarketplaceEnrollmentByOrgAndCapability(ctx,
			regionaldb.GetMarketplaceEnrollmentByOrgAndCapabilityParams{
				OrgID:          org.OrgID,
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

		if err := json.NewEncoder(w).Encode(adminEnrollmentToAPI(req.OrgDomain, enrollment)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminApproveEnrollment handles POST /admin/marketplace/provider-enrollments/approve
func AdminApproveEnrollment(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminApproveEnrollmentRequest
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

		org, err := s.Global.GetOrgByDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var enrollment regionaldb.MarketplaceEnrollment
		err = s.WithRegionalTx(ctx, org.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			enrollment, txErr = qtx.AdminApproveMarketplaceEnrollment(ctx,
				regionaldb.AdminApproveMarketplaceEnrollmentParams{
					OrgID:            org.OrgID,
					CapabilitySlug:   req.CapabilitySlug,
					ExpiresAt:        optionalTimestamptz(req.ExpiresAt),
					BillingReference: optionalText(req.BillingReference),
					ReviewNote:       optionalText(req.ReviewNote),
				})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to approve enrollment", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Write admin audit log to global DB.
		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_enrollment_approved",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData:   []byte(`{"org_domain":"` + req.OrgDomain + `","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		if err := json.NewEncoder(w).Encode(adminEnrollmentToAPI(req.OrgDomain, enrollment)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminRejectEnrollment handles POST /admin/marketplace/provider-enrollments/reject
func AdminRejectEnrollment(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminRejectEnrollmentRequest
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

		org, err := s.Global.GetOrgByDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var enrollment regionaldb.MarketplaceEnrollment
		err = s.WithRegionalTx(ctx, org.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			enrollment, txErr = qtx.AdminRejectMarketplaceEnrollment(ctx,
				regionaldb.AdminRejectMarketplaceEnrollmentParams{
					OrgID:          org.OrgID,
					CapabilitySlug: req.CapabilitySlug,
					ReviewNote:     pgtype.Text{String: req.ReviewNote, Valid: true},
				})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to reject enrollment", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_enrollment_rejected",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData:   []byte(`{"org_domain":"` + req.OrgDomain + `","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		if err := json.NewEncoder(w).Encode(adminEnrollmentToAPI(req.OrgDomain, enrollment)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminSuspendEnrollment handles POST /admin/marketplace/provider-enrollments/suspend
func AdminSuspendEnrollment(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminSuspendEnrollmentRequest
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

		org, err := s.Global.GetOrgByDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var enrollment regionaldb.MarketplaceEnrollment
		err = s.WithRegionalTx(ctx, org.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			enrollment, txErr = qtx.AdminSuspendMarketplaceEnrollment(ctx,
				regionaldb.AdminSuspendMarketplaceEnrollmentParams{
					OrgID:          org.OrgID,
					CapabilitySlug: req.CapabilitySlug,
					ReviewNote:     pgtype.Text{String: req.ReviewNote, Valid: true},
				})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to suspend enrollment", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_enrollment_suspended",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData:   []byte(`{"org_domain":"` + req.OrgDomain + `","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		if err := json.NewEncoder(w).Encode(adminEnrollmentToAPI(req.OrgDomain, enrollment)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminReinstateEnrollment handles POST /admin/marketplace/provider-enrollments/reinstate
func AdminReinstateEnrollment(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminReinstateEnrollmentRequest
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

		org, err := s.Global.GetOrgByDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var enrollment regionaldb.MarketplaceEnrollment
		err = s.WithRegionalTx(ctx, org.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			enrollment, txErr = qtx.AdminReinstateMarketplaceEnrollment(ctx,
				regionaldb.AdminReinstateMarketplaceEnrollmentParams{
					OrgID:          org.OrgID,
					CapabilitySlug: req.CapabilitySlug,
				})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to reinstate enrollment", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_enrollment_reinstated",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData:   []byte(`{"org_domain":"` + req.OrgDomain + `","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		if err := json.NewEncoder(w).Encode(adminEnrollmentToAPI(req.OrgDomain, enrollment)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminRenewEnrollment handles POST /admin/marketplace/provider-enrollments/renew
func AdminRenewEnrollment(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminRenewEnrollmentRequest
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

		org, err := s.Global.GetOrgByDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var enrollment regionaldb.MarketplaceEnrollment
		err = s.WithRegionalTx(ctx, org.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			enrollment, txErr = qtx.AdminRenewMarketplaceEnrollment(ctx,
				regionaldb.AdminRenewMarketplaceEnrollmentParams{
					OrgID:            org.OrgID,
					CapabilitySlug:   req.CapabilitySlug,
					ExpiresAt:        optionalTimestamptz(req.ExpiresAt),
					BillingReference: optionalText(req.BillingReference),
					ReviewNote:       optionalText(req.ReviewNote),
				})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to renew enrollment", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_enrollment_renewed",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData:   []byte(`{"org_domain":"` + req.OrgDomain + `","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		if err := json.NewEncoder(w).Encode(adminEnrollmentToAPI(req.OrgDomain, enrollment)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
