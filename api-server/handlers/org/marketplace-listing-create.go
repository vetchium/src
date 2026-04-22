package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/orgtiers"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func CreateMarketplaceListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.CreateListingRequest
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

		// Validate capability IDs exist and are active
		if err := validateCapabilityIDs(ctx, s.Global, req.Capabilities); err != nil {
			s.Logger(ctx).Debug("invalid capability ids", "error", err)
			w.WriteHeader(http.StatusUnprocessableEntity)
			json.NewEncoder(w).Encode(map[string]string{"message": err.Error()})
			return
		}

		// The org's OrgName field holds the domain (set at signup)
		orgRecord, err := s.Global.GetOrgByID(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		orgDomain := orgRecord.OrgName

		var listing regionaldb.MarketplaceListing
		var capabilities []string

		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// Assign a listing number
			listingNum, err := qtx.NextListingNumberForOrg(ctx, orgUser.OrgID)
			if err != nil {
				return err
			}

			// Create listing in draft state (no quota check at creation)
			created, err := qtx.CreateMarketplaceListing(ctx, regionaldb.CreateMarketplaceListingParams{
				OrgID:         orgUser.OrgID,
				OrgDomain:     orgDomain,
				ListingNumber: listingNum,
				Headline:      req.Headline,
				Description:   req.Description,
			})
			if err != nil {
				return err
			}
			listing = created

			// Add capability rows
			for _, capID := range req.Capabilities {
				if err := qtx.AddListingCapability(ctx, regionaldb.AddListingCapabilityParams{
					ListingID:    created.ListingID,
					CapabilityID: capID,
				}); err != nil {
					return err
				}
			}
			capabilities = req.Capabilities

			eventData, _ := json.Marshal(map[string]any{
				"listing_id":     uuidToString(created.ListingID),
				"listing_number": created.ListingNumber,
				"headline":       created.Headline,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_listing_created",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, orgtiers.ErrQuotaExceeded) {
				// Should not happen at creation (quota checked at publish), but guard anyway
				return
			}
			s.Logger(ctx).Error("failed to create listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("marketplace listing created", "listing_id", uuidToString(listing.ListingID))
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(buildListingFromRow(ctx, listing, capabilities, 0, false))
	}
}
