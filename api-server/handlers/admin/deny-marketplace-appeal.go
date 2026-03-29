package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	admintypes "vetchium-api-server.typespec/admin"
)

// DenyMarketplaceAppeal handles POST /admin/deny-marketplace-appeal
// Denies an appeal for a service listing in 'appealing' state, setting it to 'suspended' with appeal_exhausted=true.
func DenyMarketplaceAppeal(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminDenyMarketplaceAppealRequest
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

		// Look up org by domain to get org_id and region
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

		// Look up listing in regional DB to get its ID
		rdb := s.GetRegionalDB(org.Region)
		if rdb == nil {
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		listing, err := rdb.GetServiceListingByOrgAndName(ctx, regionaldb.GetServiceListingByOrgAndNameParams{
			OrgID: org.OrgID,
			Name:  req.Name,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get service listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var updatedListing regionaldb.MarketplaceServiceListing
		err = s.WithRegionalTx(ctx, org.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			updatedListing, txErr = qtx.AdminDenyAppeal(ctx, regionaldb.AdminDenyAppealParams{
				AdminNote:        pgtype.Text{String: req.AdminVerificationNote, Valid: true},
				ServiceListingID: listing.ServiceListingID,
			})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to deny appeal for service listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		eventData, _ := json.Marshal(map[string]any{
			"org_domain": req.OrgDomain,
			"name":       req.Name,
		})
		auditErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.deny_marketplace_appeal",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write audit log after successful marketplace appeal denial",
				"error", auditErr, "org_domain", req.OrgDomain, "name", req.Name)
		}

		log.Info("marketplace appeal denied", "org_domain", req.OrgDomain, "name", req.Name, "admin_id", uuidToString(adminUser.AdminUserID))

		if err := json.NewEncoder(w).Encode(adminDbServiceListingToAPI(updatedListing, req.OrgDomain)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
