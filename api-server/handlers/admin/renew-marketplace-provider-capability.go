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

// RenewMarketplaceProviderCapability handles POST /admin/renew-marketplace-provider-capability
// Renews a capability that is currently active or expired (WHERE status IN ('active', 'expired')).
func RenewMarketplaceProviderCapability(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.RenewMarketplaceProviderCapabilityRequest
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

		now := time.Now().UTC()
		grantedAt := pgtype.Timestamptz{Time: now, Valid: true}
		expiresAt := pgtype.Timestamptz{
			Time:  now.Add(time.Duration(req.SubscriptionPeriodDays) * 24 * time.Hour),
			Valid: true,
		}

		var subPrice pgtype.Numeric
		if err := subPrice.Scan(fmt.Sprintf("%.10f", req.SubscriptionPrice)); err != nil {
			log.Error("failed to parse subscription_price", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var updatedCap regionaldb.OrgCapability
		err = s.WithRegionalTx(ctx, org.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			updatedCap, txErr = qtx.AdminRenewOrgCapability(ctx, regionaldb.AdminRenewOrgCapabilityParams{
				AdminID:           adminUser.AdminUserID,
				SubscriptionPrice: subPrice,
				Currency:          pgtype.Text{String: req.Currency, Valid: true},
				GrantedAt:         grantedAt,
				ExpiresAt:         expiresAt,
				OrgID:             org.OrgID,
				Capability:        "marketplace_provider",
			})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				rdb := s.GetRegionalDB(org.Region)
				if rdb == nil {
					http.Error(w, "", http.StatusInternalServerError)
					return
				}
				_, checkErr := rdb.GetOrgCapability(ctx, regionaldb.GetOrgCapabilityParams{
					OrgID:      org.OrgID,
					Capability: "marketplace_provider",
				})
				if errors.Is(checkErr, pgx.ErrNoRows) {
					w.WriteHeader(http.StatusNotFound)
				} else {
					w.WriteHeader(http.StatusUnprocessableEntity)
				}
				return
			}
			log.Error("failed to renew org capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		eventData, _ := json.Marshal(map[string]any{
			"org_domain":     req.OrgDomain,
			"capability":     "marketplace_provider",
			"price":          fmt.Sprintf("%.2f", req.SubscriptionPrice),
			"currency":       req.Currency,
			"new_expires_at": expiresAt.Time.Format(time.RFC3339),
		})
		auditErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.renew_marketplace_provider_capability",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write audit log after successful regional capability renewal",
				"error", auditErr, "org_domain", req.OrgDomain)
		}

		log.Info("marketplace provider capability renewed", "org_domain", req.OrgDomain, "admin_id", uuidToString(adminUser.AdminUserID))

		if err := json.NewEncoder(w).Encode(dbOrgCapabilityToAPI(updatedCap)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
