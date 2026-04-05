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

// GetProviderOffer handles POST /org/marketplace/provider-offers/get
func GetProviderOffer(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.GetProviderOfferRequest
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

		offer, err := s.Regional.GetMarketplaceOfferByOrgAndCapability(ctx,
			regionaldb.GetMarketplaceOfferByOrgAndCapabilityParams{
				OrgID:          orgUser.OrgID,
				CapabilitySlug: req.CapabilitySlug,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get provider offer", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if err := json.NewEncoder(w).Encode(dbOfferToAPI(offer)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// CreateProviderOffer handles POST /org/marketplace/provider-offers/create
func CreateProviderOffer(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.CreateProviderOfferRequest
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

		// Verify enrollment exists and is approved
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
			log.Error("failed to get enrollment for offer creation", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if enrollment.Status != regionaldb.MarketplaceEnrollmentStatusApproved {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		pricingHint := pgtype.Text{}
		if req.PricingHint != nil {
			pricingHint = pgtype.Text{String: *req.PricingHint, Valid: true}
		}

		params := regionaldb.CreateMarketplaceOfferParams{
			EnrollmentID:   enrollment.ID,
			OrgID:          orgUser.OrgID,
			CapabilitySlug: req.CapabilitySlug,
			Headline:       req.Headline,
			Summary:        req.Summary,
			Description:    req.Description,
			RegionsServed:  req.RegionsServed,
			PricingHint:    pricingHint,
			ContactMode:    string(req.ContactMode),
			ContactValue:   req.ContactValue,
		}

		var offer regionaldb.MarketplaceOffer
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			offer, txErr = qtx.CreateMarketplaceOffer(ctx, params)
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_offer_created",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"capability_slug":"` + req.CapabilitySlug + `"}`),
			})
		})
		if err != nil {
			log.Error("failed to create provider offer", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(dbOfferToAPI(offer)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// UpdateProviderOffer handles POST /org/marketplace/provider-offers/update
func UpdateProviderOffer(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.UpdateProviderOfferRequest
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

		// Verify offer exists and is in draft status
		existing, err := s.Regional.GetMarketplaceOfferByOrgAndCapability(ctx,
			regionaldb.GetMarketplaceOfferByOrgAndCapabilityParams{
				OrgID:          orgUser.OrgID,
				CapabilitySlug: req.CapabilitySlug,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get offer for update", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if existing.Status != regionaldb.MarketplaceOfferStatusDraft {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		pricingHint := pgtype.Text{}
		if req.PricingHint != nil {
			pricingHint = pgtype.Text{String: *req.PricingHint, Valid: true}
		}

		var offer regionaldb.MarketplaceOffer
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			offer, txErr = qtx.UpdateMarketplaceOffer(ctx, regionaldb.UpdateMarketplaceOfferParams{
				OrgID:          orgUser.OrgID,
				CapabilitySlug: req.CapabilitySlug,
				Headline:       req.Headline,
				Summary:        req.Summary,
				Description:    req.Description,
				RegionsServed:  req.RegionsServed,
				PricingHint:    pricingHint,
				ContactMode:    string(req.ContactMode),
				ContactValue:   req.ContactValue,
			})
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_offer_updated",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"capability_slug":"` + req.CapabilitySlug + `"}`),
			})
		})
		if err != nil {
			log.Error("failed to update provider offer", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if err := json.NewEncoder(w).Encode(dbOfferToAPI(offer)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// SubmitProviderOffer handles POST /org/marketplace/provider-offers/submit
func SubmitProviderOffer(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.SubmitProviderOfferRequest
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

		// Look up the capability for offer_review mode
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

		var offer regionaldb.MarketplaceOffer
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			if cap.OfferReview == "auto" {
				offer, txErr = qtx.SubmitMarketplaceOfferAutoApprove(ctx,
					regionaldb.SubmitMarketplaceOfferAutoApproveParams{
						OrgID:          orgUser.OrgID,
						CapabilitySlug: req.CapabilitySlug,
					})
			} else {
				offer, txErr = qtx.SubmitMarketplaceOfferForReview(ctx,
					regionaldb.SubmitMarketplaceOfferForReviewParams{
						OrgID:          orgUser.OrgID,
						CapabilitySlug: req.CapabilitySlug,
					})
			}
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_offer_submitted",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"capability_slug":"` + req.CapabilitySlug + `"}`),
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to submit provider offer", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// If auto-approved, mirror to the global offer catalog as a compensating write.
		if cap.OfferReview == "auto" {
			domains, domErr := s.Global.GetGlobalOrgDomainsByOrg(ctx, orgUser.OrgID)
			if domErr != nil || len(domains) == 0 {
				log.Error("CONSISTENCY_ALERT: failed to get org domain for offer catalog", "error", domErr)
			} else {
				pricingHint := pgtype.Text{}
				if offer.PricingHint.Valid {
					pricingHint = offer.PricingHint
				}
				if _, catErr := s.Global.UpsertMarketplaceOfferCatalog(ctx, globalOfferCatalogParams(orgUser.OrgID, domains[0].Domain, offer, pricingHint, string(s.CurrentRegion))); catErr != nil {
					log.Error("CONSISTENCY_ALERT: failed to upsert offer catalog", "error", catErr)
				}
			}
		}

		if err := json.NewEncoder(w).Encode(dbOfferToAPI(offer)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// ArchiveProviderOffer handles POST /org/marketplace/provider-offers/archive
func ArchiveProviderOffer(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.ArchiveProviderOfferRequest
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

		var offer regionaldb.MarketplaceOffer
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			offer, txErr = qtx.ArchiveMarketplaceOffer(ctx, regionaldb.ArchiveMarketplaceOfferParams{
				OrgID:          orgUser.OrgID,
				CapabilitySlug: req.CapabilitySlug,
			})
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_offer_archived",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"capability_slug":"` + req.CapabilitySlug + `"}`),
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to archive provider offer", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if err := json.NewEncoder(w).Encode(dbOfferToAPI(offer)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
