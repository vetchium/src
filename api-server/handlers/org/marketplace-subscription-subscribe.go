package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func Subscribe(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.SubscribeRequest
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

		// Get consumer org's domain
		consumerOrg, err := s.Global.GetOrgByID(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get consumer org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Reject self-subscription
		if req.ProviderOrgDomain == consumerOrg.OrgName {
			w.WriteHeader(http.StatusUnprocessableEntity)
			json.NewEncoder(w).Encode(map[string]string{"message": "cannot subscribe to own listing"})
			return
		}

		// Look up the listing in the global catalog (must be active)
		catalog, err := s.Global.GetListingCatalogByDomainAndNumber(ctx, globaldb.GetListingCatalogByDomainAndNumberParams{
			OrgDomain:     req.ProviderOrgDomain,
			ListingNumber: req.ProviderListingNumber,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get listing catalog", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Look up provider org to get its region
		providerOrg, err := s.Global.GetOrgByID(ctx, catalog.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get provider org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		requestNote := ""
		if req.RequestNote != nil {
			requestNote = *req.RequestNote
		}

		var sub regionaldb.MarketplaceSubscription

		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			s2, err := qtx.UpsertMarketplaceSubscription(ctx, regionaldb.UpsertMarketplaceSubscriptionParams{
				ListingID:             catalog.ListingID,
				ConsumerOrgID:         orgUser.OrgID,
				ConsumerOrgDomain:     consumerOrg.OrgName,
				ProviderOrgID:         catalog.OrgID,
				ProviderOrgDomain:     catalog.OrgDomain,
				ProviderListingNumber: catalog.ListingNumber,
				RequestNote:           requestNote,
			})
			if err != nil {
				return err
			}
			sub = s2

			eventData, _ := json.Marshal(map[string]any{
				"subscription_id":         uuidToString(sub.SubscriptionID),
				"provider_org_domain":     catalog.OrgDomain,
				"provider_listing_number": catalog.ListingNumber,
			})
			if err := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_subscription_created",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			}); err != nil {
				return err
			}

			// Upsert global subscription index (fire and forget on failure per convention)
			upsertGlobalSubscriptionIndex(ctx, s, sub, s.CurrentRegion, catalog.OrgID, providerOrg.Region)
			return nil
		})
		if txErr != nil {
			s.Logger(ctx).Error("failed to subscribe", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(buildSubscription(sub))
	}
}
