package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/proxy"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

// ReportMarketplaceServiceListing handles POST /org/report-marketplace-service-listing
// Allows a buyer org to report a service listing.
// Routes to the correct region based on the org_domain's home region.
func ReportMarketplaceServiceListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		// Buffer body before decoding so we can proxy if needed
		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			log.Debug("failed to buffer request body", "error", err)
			http.Error(w, "", http.StatusBadRequest)
			return
		}

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			log.Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.ReportMarketplaceServiceListingRequest
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

		// Look up the org by domain to get org_id and region
		providerOrg, err := s.Global.GetOrgByDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Proxy to the correct region if the org's home region != current region
		if providerOrg.Region != s.CurrentRegion {
			s.ProxyToRegion(w, r, providerOrg.Region, bodyBytes)
			return
		}

		// Look up listing by org + name
		listing, err := s.Regional.GetServiceListingByOrgAndName(ctx, regionaldb.GetServiceListingByOrgAndNameParams{
			OrgID: providerOrg.OrgID,
			Name:  req.Name,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get service listing for report", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Only active listings can be reported
		if listing.State != regionaldb.ServiceListingStateActive {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// A provider cannot report their own listing
		if listing.OrgID == orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		var reasonOther pgtype.Text
		if req.ReasonOther != nil {
			reasonOther = pgtype.Text{String: *req.ReasonOther, Valid: true}
		}

		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			_, txErr := qtx.CreateServiceListingReport(ctx, regionaldb.CreateServiceListingReportParams{
				ServiceListingID:  listing.ServiceListingID,
				ReporterOrgUserID: orgUser.OrgUserID,
				ReporterOrgID:     orgUser.OrgID,
				Reason:            regionaldb.ServiceListingReportReason(req.Reason),
				ReasonOther:       reasonOther,
			})
			if txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{
				"name":       req.Name,
				"org_domain": req.OrgDomain,
				"reason":     string(req.Reason),
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "marketplace.report_service_listing",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				// Unique violation: this org user has already reported this listing
				w.WriteHeader(http.StatusConflict)
				return
			}
			log.Error("failed to create service listing report", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("service listing reported", "name", req.Name, "org_domain", req.OrgDomain)
		w.WriteHeader(http.StatusOK)
	}
}
