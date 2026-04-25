package org

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/orgtiers"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

const (
	defaultSubOrgLimit    = 40
	maxSubOrgLimit        = 100
	maxSubOrgsPerOrg = 256
)

// CreateSubOrg handles POST /org/create-suborg
func CreateSubOrg(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.CreateSubOrgRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		region, err := s.Global.GetRegionByCode(ctx, globaldb.Region(req.PinnedRegion))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("region not found", "region", req.PinnedRegion)
				http.Error(w, "invalid pinned_region", http.StatusBadRequest)
				return
			}
			s.Logger(ctx).Debug("failed to get region", "error", err)
			http.Error(w, "invalid pinned_region", http.StatusBadRequest)
			return
		}
		if !region.IsActive {
			s.Logger(ctx).Debug("region is not active", "region", req.PinnedRegion)
			http.Error(w, "pinned_region is not available", http.StatusBadRequest)
			return
		}

		// Enforce suborgs quota before creating
		quotaPayload, quotaErr := orgtiers.EnforceQuota(ctx, orgtiers.QuotaSubOrgs, orgUser.OrgID, s.Global, s.Regional)
		if quotaErr != nil {
			if errors.Is(quotaErr, orgtiers.ErrQuotaExceeded) {
				orgtiers.WriteQuotaError(w, quotaPayload)
				return
			}
			s.Logger(ctx).Error("failed to check suborgs quota", "error", quotaErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var created regionaldb.Suborg
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			count, txErr := qtx.CountSubOrgsByOrg(ctx, orgUser.OrgID)
			if txErr != nil {
				return txErr
			}
			if count >= maxSubOrgsPerOrg {
				return server.ErrConflict
			}

			created, txErr = qtx.CreateSubOrg(ctx, regionaldb.CreateSubOrgParams{
				OrgID:        orgUser.OrgID,
				Name:         req.Name,
				PinnedRegion: req.PinnedRegion,
			})
			if txErr != nil {
				return txErr
			}

			eventDataWithID, _ := json.Marshal(map[string]any{
				"suborg_name":   req.Name,
				"pinned_region": req.PinnedRegion,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.create_suborg",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventDataWithID,
			})
		})
		if err != nil {
			if errors.Is(err, server.ErrConflict) {
				s.Logger(ctx).Debug("maximum suborgs reached for org", "org_id", orgUser.OrgID)
				w.WriteHeader(http.StatusConflict)
				return
			}
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				s.Logger(ctx).Debug("suborg with name already exists", "name", req.Name)
				w.WriteHeader(http.StatusConflict)
				return
			}
			s.Logger(ctx).Error("failed to create suborg", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(dbSubOrgToResponse(created))
	}
}

// ListSubOrgs handles POST /org/list-suborgs
func ListSubOrgs(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.ListSubOrgsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		limit := defaultSubOrgLimit
		if req.Limit != nil && *req.Limit > 0 {
			limit = *req.Limit
			if limit > maxSubOrgLimit {
				limit = maxSubOrgLimit
			}
		}

		var cursorCreatedAt pgtype.Timestamp
		var cursorID pgtype.UUID
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			ca, id, err := decodeSubOrgCursor(*req.PaginationKey)
			if err != nil {
				s.Logger(ctx).Debug("invalid pagination_key", "error", err)
				http.Error(w, "invalid pagination_key format", http.StatusBadRequest)
				return
			}
			cursorCreatedAt = pgtype.Timestamp{Time: ca, Valid: true}
			if err := cursorID.Scan(id); err != nil {
				s.Logger(ctx).Debug("invalid pagination_key id", "error", err)
				http.Error(w, "invalid pagination_key format", http.StatusBadRequest)
				return
			}
		}

		var filterStatus pgtype.Text
		if req.FilterStatus != nil {
			filterStatus = pgtype.Text{String: *req.FilterStatus, Valid: true}
		}

		rows, err := s.Regional.ListSubOrgs(ctx, regionaldb.ListSubOrgsParams{
			OrgID:           orgUser.OrgID,
			FilterStatus:    filterStatus,
			CursorCreatedAt: cursorCreatedAt,
			CursorID:        cursorID,
			LimitCount:      int32(limit + 1),
		})
		if err != nil {
			s.Logger(ctx).Error("failed to list suborgs", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}

		items := make([]orgspec.SubOrg, 0, len(rows))
		for _, row := range rows {
			items = append(items, dbSubOrgToResponse(row))
		}

		var nextPaginationKey string
		if hasMore && len(rows) > 0 {
			last := rows[len(rows)-1]
			if last.CreatedAt.Valid {
				nextPaginationKey = encodeSubOrgCursor(last.CreatedAt.Time, last.SuborgID)
			}
		}

		json.NewEncoder(w).Encode(orgspec.ListSubOrgsResponse{
			SubOrgs:           items,
			NextPaginationKey: nextPaginationKey,
		})
	}
}

// RenameSubOrg handles POST /org/rename-suborg
func RenameSubOrg(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.RenameSubOrgRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var updated regionaldb.Suborg
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			updated, txErr = qtx.RenameSubOrgByName(ctx, regionaldb.RenameSubOrgByNameParams{
				NewName: req.NewName,
				OrgID:   orgUser.OrgID,
				Name:    req.Name,
			})
			if txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{
				"old_name": req.Name,
				"new_name": req.NewName,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.rename_suborg",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("suborg not found", "name", req.Name)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to rename suborg", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(dbSubOrgToResponse(updated))
	}
}

// DisableSubOrg handles POST /org/disable-suborg
func DisableSubOrg(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.DisableSubOrgRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Look up org name for the notification email.
		orgForEmail, err := s.Global.GetOrgByID(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			suborg, txErr := qtx.GetSubOrgByOrgAndName(ctx, regionaldb.GetSubOrgByOrgAndNameParams{
				OrgID: orgUser.OrgID,
				Name:  req.Name,
			})
			if txErr != nil {
				return txErr
			}
			if suborg.Status == "disabled" {
				return server.ErrInvalidState
			}

			if _, txErr = qtx.UpdateSubOrgStatus(ctx, regionaldb.UpdateSubOrgStatusParams{
				SuborgID: suborg.SuborgID,
				OrgID:    orgUser.OrgID,
				Status:   "disabled",
			}); txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{
				"suborg_name": req.Name,
			})
			if txErr = qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.disable_suborg",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			}); txErr != nil {
				return txErr
			}

			// Enqueue notification emails inside the transaction so they
			// roll back if anything else fails.
			members, txErr := qtx.ListSubOrgMembersForNotification(ctx, suborg.SuborgID)
			if txErr != nil {
				return txErr
			}
			emailData := templates.OrgSubOrgDisabledData{
				SubOrgName: suborg.Name,
				OrgName:    orgForEmail.OrgName,
			}
			for _, m := range members {
				lang := string(m.PreferredLanguage)
				if _, txErr = qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
					EmailType:     regionaldb.EmailTemplateTypeOrgSuborgDisabled,
					EmailTo:       m.EmailAddress,
					EmailSubject:  templates.OrgSubOrgDisabledSubject(lang, emailData),
					EmailTextBody: templates.OrgSubOrgDisabledTextBody(lang, emailData),
					EmailHtmlBody: templates.OrgSubOrgDisabledHTMLBody(lang, emailData),
				}); txErr != nil {
					return txErr
				}
			}
			return nil
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("suborg not found", "name", req.Name)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				s.Logger(ctx).Debug("suborg already disabled", "name", req.Name)
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			s.Logger(ctx).Error("failed to disable suborg", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
	}
}

// EnableSubOrg handles POST /org/enable-suborg
func EnableSubOrg(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.EnableSubOrgRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			suborg, txErr := qtx.GetSubOrgByOrgAndName(ctx, regionaldb.GetSubOrgByOrgAndNameParams{
				OrgID: orgUser.OrgID,
				Name:  req.Name,
			})
			if txErr != nil {
				return txErr
			}
			if suborg.Status == "active" {
				return server.ErrInvalidState
			}

			if _, txErr = qtx.UpdateSubOrgStatus(ctx, regionaldb.UpdateSubOrgStatusParams{
				SuborgID: suborg.SuborgID,
				OrgID:    orgUser.OrgID,
				Status:   "active",
			}); txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{
				"suborg_name": req.Name,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.enable_suborg",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("suborg not found", "name", req.Name)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				s.Logger(ctx).Debug("suborg already active", "name", req.Name)
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			s.Logger(ctx).Error("failed to enable suborg", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
	}
}

// AddSubOrgMember handles POST /org/add-suborg-member
func AddSubOrgMember(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.AddSubOrgMemberRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Resolve email → org_user_id via global DB.
		emailHash := sha256.Sum256([]byte(req.EmailAddress))
		globalTargetUser, err := s.Global.GetOrgUserByEmailHashAndOrg(ctx, globaldb.GetOrgUserByEmailHashAndOrgParams{
			EmailAddressHash: emailHash[:],
			OrgID:            orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("target user not found", "email", req.EmailAddress)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to look up target user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		targetUserID := globalTargetUser.OrgUserID

		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// Verify the SubOrg belongs to this org.
			suborg, txErr := qtx.GetSubOrgByOrgAndName(ctx, regionaldb.GetSubOrgByOrgAndNameParams{
				OrgID: orgUser.OrgID,
				Name:  req.Name,
			})
			if txErr != nil {
				return txErr
			}

			if txErr := qtx.AddSubOrgMember(ctx, regionaldb.AddSubOrgMemberParams{
				SuborgID:  suborg.SuborgID,
				OrgUserID: targetUserID,
			}); txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{"suborg_name": req.Name})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:    "org.add_suborg_member",
				ActorUserID:  orgUser.OrgUserID,
				TargetUserID: targetUserID,
				OrgID:        orgUser.OrgID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    eventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("suborg not found", "name", req.Name)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				s.Logger(ctx).Debug("user already a member of suborg", "name", req.Name, "user_id", targetUserID)
				w.WriteHeader(http.StatusConflict)
				return
			}
			s.Logger(ctx).Error("failed to add suborg member", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
	}
}

// RemoveSubOrgMember handles POST /org/remove-suborg-member
func RemoveSubOrgMember(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.RemoveSubOrgMemberRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Resolve email → org_user_id via global DB.
		emailHash := sha256.Sum256([]byte(req.EmailAddress))
		globalTargetUser, err := s.Global.GetOrgUserByEmailHashAndOrg(ctx, globaldb.GetOrgUserByEmailHashAndOrgParams{
			EmailAddressHash: emailHash[:],
			OrgID:            orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("target user not found", "email", req.EmailAddress)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to look up target user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		targetUserID := globalTargetUser.OrgUserID

		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// Verify the SubOrg belongs to this org.
			suborg, txErr := qtx.GetSubOrgByOrgAndName(ctx, regionaldb.GetSubOrgByOrgAndNameParams{
				OrgID: orgUser.OrgID,
				Name:  req.Name,
			})
			if txErr != nil {
				return txErr
			}

			// Verify the membership exists.
			if _, txErr := qtx.GetSubOrgMembership(ctx, regionaldb.GetSubOrgMembershipParams{
				SuborgID:  suborg.SuborgID,
				OrgUserID: targetUserID,
			}); txErr != nil {
				return txErr
			}

			if txErr := qtx.RemoveSubOrgMember(ctx, regionaldb.RemoveSubOrgMemberParams{
				SuborgID:  suborg.SuborgID,
				OrgUserID: targetUserID,
			}); txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{"suborg_name": req.Name})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:    "org.remove_suborg_member",
				ActorUserID:  orgUser.OrgUserID,
				TargetUserID: targetUserID,
				OrgID:        orgUser.OrgID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    eventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("suborg or membership not found", "name", req.Name, "email", req.EmailAddress)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to remove suborg member", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
	}
}

// ListSubOrgMembers handles POST /org/list-suborg-members
func ListSubOrgMembers(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.ListSubOrgMembersRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Verify the SubOrg belongs to this org.
		if _, err := s.Regional.GetSubOrgByOrgAndName(ctx, regionaldb.GetSubOrgByOrgAndNameParams{
			OrgID: orgUser.OrgID,
			Name:  req.Name,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("suborg not found", "name", req.Name)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get suborg", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		limit := defaultSubOrgLimit

		var cursorAssignedAt pgtype.Timestamp
		var cursorID pgtype.UUID
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			ca, id, err := decodeSubOrgMemberCursor(*req.PaginationKey)
			if err != nil {
				s.Logger(ctx).Debug("invalid pagination_key", "error", err)
				http.Error(w, "invalid pagination_key format", http.StatusBadRequest)
				return
			}
			cursorAssignedAt = pgtype.Timestamp{Time: ca, Valid: true}
			if err := cursorID.Scan(id); err != nil {
				s.Logger(ctx).Debug("invalid pagination_key format", "error", err)
				http.Error(w, "invalid pagination_key format", http.StatusBadRequest)
				return
			}
		}

		rows, err := s.Regional.ListSubOrgMembersByName(ctx, regionaldb.ListSubOrgMembersByNameParams{
			OrgID:            orgUser.OrgID,
			SuborgName:       req.Name,
			CursorAssignedAt: cursorAssignedAt,
			CursorID:         cursorID,
			LimitCount:       int32(limit + 1),
		})
		if err != nil {
			s.Logger(ctx).Error("failed to list suborg members", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}

		members := make([]orgspec.SubOrgMember, 0, len(rows))
		for _, row := range rows {
			m := orgspec.SubOrgMember{
				EmailAddress: row.EmailAddress,
				AssignedAt:   row.AssignedAt.Time.UTC().Format(time.RFC3339),
			}
			if row.FullName.Valid {
				m.FullName = &row.FullName.String
			}
			members = append(members, m)
		}

		var nextPaginationKey string
		if hasMore && len(rows) > 0 {
			last := rows[len(rows)-1]
			if last.AssignedAt.Valid {
				nextPaginationKey = encodeSubOrgMemberCursor(last.AssignedAt.Time, last.OrgUserID)
			}
		}

		json.NewEncoder(w).Encode(orgspec.ListSubOrgMembersResponse{
			Members:           members,
			NextPaginationKey: nextPaginationKey,
		})
	}
}

// dbSubOrgToResponse converts a DB Suborg row to the API response type.
func dbSubOrgToResponse(s regionaldb.Suborg) orgspec.SubOrg {
	return orgspec.SubOrg{
		Name:         s.Name,
		PinnedRegion: s.PinnedRegion,
		Status:       s.Status,
		CreatedAt:    s.CreatedAt.Time.UTC().Format(time.RFC3339),
	}
}

func encodeSubOrgCursor(createdAt time.Time, id pgtype.UUID) string {
	data := fmt.Sprintf("%s|%s", createdAt.UTC().Format(time.RFC3339Nano), uuidToString(id))
	return base64.URLEncoding.EncodeToString([]byte(data))
}

func decodeSubOrgCursor(cursor string) (time.Time, string, error) {
	data, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", err
	}
	parts := strings.Split(string(data), "|")
	if len(parts) != 2 {
		return time.Time{}, "", fmt.Errorf("invalid cursor format")
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, "", err
	}
	return t, parts[1], nil
}

func encodeSubOrgMemberCursor(assignedAt time.Time, id pgtype.UUID) string {
	data := fmt.Sprintf("%s|%s", assignedAt.UTC().Format(time.RFC3339Nano), uuidToString(id))
	return base64.URLEncoding.EncodeToString([]byte(data))
}

func decodeSubOrgMemberCursor(cursor string) (time.Time, string, error) {
	return decodeSubOrgCursor(cursor)
}
