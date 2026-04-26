package org

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgdomains "vetchium-api-server.typespec/org-domains"
)

func SetPrimaryDomain(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgdomains.SetPrimaryDomainRequest
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

		domain := strings.ToLower(string(req.Domain))

		// Verify the domain is VERIFIED in regional DB and belongs to this org.
		domainRecord, err := s.Regional.GetOrgDomainByOrgAndDomain(ctx, regionaldb.GetOrgDomainByOrgAndDomainParams{
			Domain: domain,
			OrgID:  orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get domain record", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if domainRecord.Status != regionaldb.DomainVerificationStatusVERIFIED {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Atomically update is_primary in global DB + write audit log in regional DB.
		// Global first (source of truth for primary), then regional for audit.
		if err := s.Global.SetPrimaryDomain(ctx, globaldb.SetPrimaryDomainParams{
			OrgID:  orgUser.OrgID,
			Domain: domain,
		}); err != nil {
			s.Logger(ctx).Error("failed to set primary domain in global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		eventData, _ := json.Marshal(map[string]any{"domain": domain})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.set_primary_domain",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to write audit log for set_primary_domain", "error", err)
			// Non-fatal: primary was already updated; log the inconsistency.
			s.Logger(ctx).Error("CONSISTENCY_ALERT: set_primary_domain audit log missing", "domain", domain, "org_id", orgUser.OrgID)
		}

		s.Logger(ctx).Info("primary domain updated", "domain", domain, "org_id", orgUser.OrgID)
		w.WriteHeader(http.StatusOK)
	}
}
