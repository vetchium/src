package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

// ApplyMarketplaceProviderCapability handles POST /org/apply-marketplace-provider-capability
func ApplyMarketplaceProviderCapability(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.ApplyMarketplaceProviderCapabilityRequest
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

		var applicationNote pgtype.Text
		if req.ApplicationNote != nil {
			applicationNote = pgtype.Text{String: *req.ApplicationNote, Valid: true}
		}

		var cap regionaldb.OrgCapability
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			cap, txErr = qtx.UpsertOrgCapabilityApply(ctx, regionaldb.UpsertOrgCapabilityApplyParams{
				OrgID:           orgUser.OrgID,
				Capability:      "marketplace_provider",
				ApplicationNote: applicationNote,
			})
			if txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{"capability": "marketplace_provider"})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "marketplace.apply_provider_capability",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Capability exists but is in a state that does not allow re-applying
				// (e.g., active or pending_approval)
				log.Debug("org capability not in re-appliable state")
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to apply marketplace provider capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		domains, err := s.Global.GetGlobalOrgDomainsByOrg(ctx, orgUser.OrgID)
		if err != nil || len(domains) == 0 {
			log.Error("failed to get org domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("marketplace provider capability applied", "org_id", orgUser.OrgID)
		json.NewEncoder(w).Encode(dbOrgCapabilityToAPI(cap, domains[0].Domain))
	}
}
