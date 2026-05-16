package org

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgdomains "vetchium-api-server.typespec/org-domains"
)

func DeleteDomain(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgdomains.DeleteDomainRequest
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

		// Verify the domain belongs to this org in regional DB.
		_, err := s.RegionalForCtx(ctx).GetOrgDomainByOrgAndDomain(ctx, regionaldb.GetOrgDomainByOrgAndDomainParams{
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

		// Fetch the global record to check is_primary.
		globalDomain, err := s.Global.GetGlobalOrgDomain(ctx, domain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get global domain record", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Block deletion of the primary domain if other domains exist.
		// The org must call set-primary-domain first.
		if globalDomain.IsPrimary {
			allGlobalDomains, err := s.Global.GetGlobalOrgDomainsByOrg(ctx, orgUser.OrgID)
			if err != nil {
				s.Logger(ctx).Error("failed to list global org domains", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			if len(allGlobalDomains) > 1 {
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "cannot delete primary domain while other domains exist; set a new primary domain first",
				})
				return
			}
		}

		// Block deletion of a domain that has active marketplace listings.
		inUse, err := s.RegionalForCtx(ctx).HasOrgDomainInUseByMarketplaceListing(ctx, domain)
		if err != nil {
			s.Logger(ctx).Error("failed to check domain marketplace usage", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if inUse {
			w.WriteHeader(http.StatusUnprocessableEntity)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "cannot delete a domain that has active marketplace listings",
			})
			return
		}

		// SAGA: global first (delete + cooldown), then regional.
		claimableAfter := time.Now().AddDate(0, 0, orgdomains.DomainReleaseCooldown)

		if err := s.Global.DeleteGlobalOrgDomain(ctx, domain); err != nil {
			s.Logger(ctx).Error("failed to delete domain from global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if err := s.Global.InsertDomainCooldown(ctx, globaldb.InsertDomainCooldownParams{
			Domain:         domain,
			PrevOrgID:      orgUser.OrgID,
			ClaimableAfter: pgtype.Timestamptz{Time: claimableAfter, Valid: true},
		}); err != nil {
			s.Logger(ctx).Error("failed to insert domain cooldown", "error", err)
			// Compensating: restore global domain record with its original region.
			if restoreErr := s.Global.CreateGlobalOrgDomain(ctx, globaldb.CreateGlobalOrgDomainParams{
				Domain:    domain,
				Region:    globalDomain.Region,
				OrgID:     orgUser.OrgID,
				IsPrimary: globalDomain.IsPrimary,
			}); restoreErr != nil {
				s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to restore global domain after cooldown insert failure",
					"domain", domain, "error", restoreErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		eventData, _ := json.Marshal(map[string]any{"domain": domain})
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.DeleteOrgDomain(ctx, domain); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.delete_domain",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to delete domain from regional DB", "error", err)
			// Compensating: restore global record and remove cooldown.
			if restoreErr := s.Global.CreateGlobalOrgDomain(ctx, globaldb.CreateGlobalOrgDomainParams{
				Domain:    domain,
				Region:    globalDomain.Region,
				OrgID:     orgUser.OrgID,
				IsPrimary: globalDomain.IsPrimary,
			}); restoreErr != nil {
				s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to restore global domain after regional delete failure",
					"domain", domain, "error", restoreErr)
			}
			if delErr := s.Global.DeleteDomainCooldown(ctx, domain); delErr != nil {
				s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to remove domain cooldown after regional delete failure",
					"domain", domain, "error", delErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("domain deleted", "domain", domain, "org_id", orgUser.OrgID,
			"claimable_after", claimableAfter)
		w.WriteHeader(http.StatusNoContent)
	}
}
