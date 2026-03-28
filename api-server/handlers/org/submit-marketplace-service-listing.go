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

// SubmitMarketplaceServiceListing handles POST /org/submit-marketplace-service-listing
func SubmitMarketplaceServiceListing(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.SubmitMarketplaceServiceListingRequest
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

		// Check that org capability is active
		cap, err := s.Regional.GetOrgCapability(ctx, regionaldb.GetOrgCapabilityParams{
			OrgID:      orgUser.OrgID,
			Capability: "marketplace_provider",
		})
		if err != nil || cap.Status != regionaldb.OrgCapabilityStatusActive {
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				log.Error("failed to get org capability", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusForbidden)
			return
		}

		var listingID pgtype.UUID
		if err := listingID.Scan(req.ServiceListingID); err != nil {
			log.Debug("invalid service_listing_id", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			_, txErr := qtx.SubmitServiceListingForReview(ctx, regionaldb.SubmitServiceListingForReviewParams{
				ServiceListingID: listingID,
				OrgID:            orgUser.OrgID,
			})
			if txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{
				"service_listing_id": req.ServiceListingID,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "marketplace.submit_service_listing",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// SubmitServiceListingForReview works for draft, and for rejected only
				// when changed_since_rejection=true. Check listing to determine response.
				listing, getErr := s.Regional.GetServiceListingByIDAndOrg(ctx, regionaldb.GetServiceListingByIDAndOrgParams{
					ServiceListingID: listingID,
					OrgID:            orgUser.OrgID,
				})
				if getErr != nil {
					if errors.Is(getErr, pgx.ErrNoRows) {
						w.WriteHeader(http.StatusNotFound)
						return
					}
					log.Error("failed to get service listing for state check", "error", getErr)
					http.Error(w, "", http.StatusInternalServerError)
					return
				}
				// Listing exists; distinguish between wrong state and no-changes cases.
				if listing.State == regionaldb.ServiceListingStateRejected && !listing.ChangedSinceRejection {
					log.Debug("rejected listing has no changes since rejection, cannot submit")
					w.WriteHeader(http.StatusUnprocessableEntity)
					return
				}
				log.Debug("service listing is in wrong state for submit", "state", listing.State)
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to submit service listing for review", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("service listing submitted for review", "service_listing_id", req.ServiceListingID)
		w.WriteHeader(http.StatusOK)
	}
}
