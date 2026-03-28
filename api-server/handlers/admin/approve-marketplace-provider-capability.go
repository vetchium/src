package admin

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	admintypes "vetchium-api-server.typespec/admin"
)

// ApproveMarketplaceProviderCapability handles POST /admin/approve-marketplace-provider-capability
func ApproveMarketplaceProviderCapability(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.ApproveMarketplaceProviderCapabilityRequest
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

		// Parse org_id
		var orgID pgtype.UUID
		if err := orgID.Scan(req.OrgID); err != nil {
			log.Debug("invalid org_id", "error", err)
			http.Error(w, "invalid org_id", http.StatusBadRequest)
			return
		}

		// Look up org to get region
		org, err := s.Global.GetOrgByID(ctx, orgID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		expiresAt := pgtype.Timestamptz{
			Time:  time.Now().UTC().Add(time.Duration(req.SubscriptionPeriodDays) * 24 * time.Hour),
			Valid: true,
		}

		var subPrice pgtype.Numeric
		if err := subPrice.Scan(fmt.Sprintf("%.10f", req.SubscriptionPrice)); err != nil {
			log.Error("failed to parse subscription_price", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Perform regional write
		var updatedCap regionaldb.OrgCapability
		err = s.WithRegionalTx(ctx, org.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			updatedCap, txErr = qtx.AdminApproveOrgCapability(ctx, regionaldb.AdminApproveOrgCapabilityParams{
				AdminID:           adminUser.AdminUserID,
				SubscriptionPrice: subPrice,
				Currency:          pgtype.Text{String: req.Currency, Valid: true},
				ExpiresAt:         expiresAt,
				OrgID:             orgID,
				Capability:        "marketplace_provider",
			})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Check if capability exists at all
				rdb := s.GetRegionalDB(org.Region)
				if rdb == nil {
					http.Error(w, "", http.StatusInternalServerError)
					return
				}
				_, checkErr := rdb.GetOrgCapability(ctx, regionaldb.GetOrgCapabilityParams{
					OrgID:      orgID,
					Capability: "marketplace_provider",
				})
				if errors.Is(checkErr, pgx.ErrNoRows) {
					w.WriteHeader(http.StatusNotFound)
				} else {
					w.WriteHeader(http.StatusUnprocessableEntity)
				}
				return
			}
			log.Error("failed to approve org capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Write audit log in a separate global transaction
		eventData, _ := json.Marshal(map[string]any{
			"org_id":                   req.OrgID,
			"capability":               "marketplace_provider",
			"subscription_period_days": req.SubscriptionPeriodDays,
			"currency":                 req.Currency,
		})
		auditErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.approve_marketplace_provider_capability",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write audit log after successful regional capability approval",
				"error", auditErr, "org_id", req.OrgID)
		}

		log.Info("marketplace provider capability approved", "org_id", req.OrgID, "admin_id", uuidToString(adminUser.AdminUserID))

		if err := json.NewEncoder(w).Encode(dbOrgCapabilityToAPI(updatedCap)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
