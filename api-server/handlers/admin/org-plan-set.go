package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

// SetOrgPlan allows an admin to set any org's plan.
// Requires admin:manage_org_plans.
// Returns 409 if downgrading when current usage exceeds the target plan caps.
func SetOrgPlan(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.AdminSetOrgPlanRequest
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

		var orgID pgtype.UUID
		if err := orgID.Scan(req.OrgID); err != nil {
			http.Error(w, "invalid org_id", http.StatusBadRequest)
			return
		}

		// Look up org (verify exists + get region for usage counts)
		org, err := s.Global.GetOrgByID(ctx, orgID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get target plan
		targetPlan, err := s.Global.GetPlan(ctx, req.PlanID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get target plan", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get current plan
		sub, err := s.Global.GetOrgPlan(ctx, orgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get org plan", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// For downgrades, check if current usage fits in the target plan caps
		if targetPlan.DisplayOrder < sub.DisplayOrder {
			regionalDB := s.GetRegionalDB(org.Region)

			type usageBlock struct {
				resource string
				current  int32
				cap      int32
			}
			var blocked []usageBlock

			orgUsersCount, err := s.Global.CountOrgUsers(ctx, orgID)
			if err != nil {
				s.Logger(ctx).Error("failed to count org users", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			if targetPlan.OrgUsersCap.Valid && orgUsersCount > targetPlan.OrgUsersCap.Int32 {
				blocked = append(blocked, usageBlock{"org_users", orgUsersCount, targetPlan.OrgUsersCap.Int32})
			}

			if regionalDB != nil {
				domains, err := regionalDB.CountVerifiedDomainsForOrg(ctx, orgID)
				if err != nil {
					s.Logger(ctx).Error("failed to count verified domains", "error", err)
					http.Error(w, "", http.StatusInternalServerError)
					return
				}
				if targetPlan.DomainsVerifiedCap.Valid && domains > targetPlan.DomainsVerifiedCap.Int32 {
					blocked = append(blocked, usageBlock{"domains_verified", domains, targetPlan.DomainsVerifiedCap.Int32})
				}

				suborgs, err := regionalDB.CountSubOrgsForOrg(ctx, orgID)
				if err != nil {
					s.Logger(ctx).Error("failed to count suborgs", "error", err)
					http.Error(w, "", http.StatusInternalServerError)
					return
				}
				if targetPlan.SuborgsCap.Valid && suborgs > targetPlan.SuborgsCap.Int32 {
					blocked = append(blocked, usageBlock{"suborgs", suborgs, targetPlan.SuborgsCap.Int32})
				}
			}

			if len(blocked) > 0 {
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(blocked)
				return
			}
		}

		fromPlanID := sub.CurrentPlanID

		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			if txErr := qtx.UpdateOrgPlan(ctx, globaldb.UpdateOrgPlanParams{
				CurrentPlanID:      req.PlanID,
				UpdatedByAdminID:   adminUser.AdminUserID,
				UpdatedByOrgUserID: pgtype.UUID{Valid: false},
				Note:               req.Reason,
				OrgID:              orgID,
			}); txErr != nil {
				return txErr
			}

			if txErr := qtx.InsertOrgPlanHistory(ctx, globaldb.InsertOrgPlanHistoryParams{
				OrgID:              orgID,
				FromPlanID:         pgtype.Text{String: fromPlanID, Valid: true},
				ToPlanID:           req.PlanID,
				ChangedByAdminID:   adminUser.AdminUserID,
				ChangedByOrgUserID: pgtype.UUID{Valid: false},
				Reason:             req.Reason,
			}); txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{
				"org_id":       req.OrgID,
				"from_plan_id": fromPlanID,
				"to_plan_id":   req.PlanID,
				"reason":       req.Reason,
			})
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:    "admin.org_plan_granted",
				ActorUserID:  adminUser.AdminUserID,
				TargetUserID: pgtype.UUID{Valid: false},
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    eventData,
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to set org plan", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Fetch updated plan for response
		updatedSub, err := s.Global.GetOrgPlan(ctx, orgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get updated plan", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Build usage counts for response
		regionalDB := s.GetRegionalDB(org.Region)
		orgUsersCount, _ := s.Global.CountOrgUsers(ctx, orgID)
		var domainsVerified, suborgs int32
		if regionalDB != nil {
			domainsVerified, _ = regionalDB.CountVerifiedDomainsForOrg(ctx, orgID)
			suborgs, _ = regionalDB.CountSubOrgsForOrg(ctx, orgID)
		}

		plan := buildPlan(updatedSub)
		resp := orgtypes.OrgPlan{
			OrgID:       req.OrgID,
			OrgDomain:   org.OrgName,
			CurrentPlan: plan,
			Usage: orgtypes.PlanUsage{
				OrgUsers:            orgUsersCount,
				DomainsVerified:     domainsVerified,
				Suborgs:             suborgs,
				MarketplaceListings: 0, // Phase 2
			},
			UpdatedAt: updatedSub.UpdatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
			Note:      updatedSub.Note,
		}

		json.NewEncoder(w).Encode(resp)
	}
}
