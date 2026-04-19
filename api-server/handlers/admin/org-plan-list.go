package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

// ListOrgPlans returns all org plans with optional plan filter.
// Requires admin:view_org_plans or admin:manage_org_plans.
func ListOrgPlans(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.AdminListOrgPlansRequest
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

		rowLimit := int32(20)
		if req.Limit != nil {
			rowLimit = *req.Limit
		}

		var filterPlanID pgtype.Text
		if req.FilterPlanID != nil && *req.FilterPlanID != "" {
			filterPlanID = pgtype.Text{String: *req.FilterPlanID, Valid: true}
		}

		var filterDomain pgtype.Text
		if req.FilterDomain != nil && *req.FilterDomain != "" {
			filterDomain = pgtype.Text{String: *req.FilterDomain, Valid: true}
		}

		var paginationKey pgtype.UUID
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			if err := paginationKey.Scan(*req.PaginationKey); err != nil {
				http.Error(w, "invalid pagination_key", http.StatusBadRequest)
				return
			}
		}

		rows, err := s.Global.AdminListOrgPlans(ctx, globaldb.AdminListOrgPlansParams{
			FilterPlanID:  filterPlanID,
			FilterDomain:  filterDomain,
			PaginationKey: paginationKey,
			RowLimit:      rowLimit + 1,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to list org plans", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var nextPaginationKey *string
		if int32(len(rows)) > rowLimit {
			rows = rows[:rowLimit]
			last := uuidToString(rows[len(rows)-1].OrgID)
			nextPaginationKey = &last
		}

		items := make([]orgtypes.OrgPlan, 0, len(rows))
		for _, row := range rows {
			domain := row.OrgDomain

			sub, err := s.Global.GetOrgPlan(ctx, row.OrgID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					s.Logger(ctx).Debug("org plan row disappeared mid-list", "org_id", uuidToString(row.OrgID))
					continue
				}
				s.Logger(ctx).Error("failed to get plan detail", "error", err, "org_id", uuidToString(row.OrgID))
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Determine the region for this org to get regional counts
			org, err := s.Global.GetOrgByID(ctx, row.OrgID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					s.Logger(ctx).Debug("org row disappeared mid-list", "org_id", uuidToString(row.OrgID))
					continue
				}
				s.Logger(ctx).Error("failed to get org", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			regionalDB := s.GetRegionalDB(org.Region)

			orgUsers, err := s.Global.CountOrgUsers(ctx, row.OrgID)
			if err != nil {
				s.Logger(ctx).Error("failed to count org users", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			var domainsVerified, suborgs int32
			if regionalDB != nil {
				domainsVerified, err = regionalDB.CountVerifiedDomainsForOrg(ctx, row.OrgID)
				if err != nil {
					s.Logger(ctx).Error("failed to count verified domains", "error", err)
					http.Error(w, "", http.StatusInternalServerError)
					return
				}
				suborgs, err = regionalDB.CountSubOrgsForOrg(ctx, row.OrgID)
				if err != nil {
					s.Logger(ctx).Error("failed to count suborgs", "error", err)
					http.Error(w, "", http.StatusInternalServerError)
					return
				}
			}

			plan := buildPlan(sub)

			items = append(items, orgtypes.OrgPlan{
				OrgID:       uuidToString(row.OrgID),
				OrgDomain:   domain,
				CurrentPlan: plan,
				Usage: orgtypes.PlanUsage{
					OrgUsers:            orgUsers,
					DomainsVerified:     domainsVerified,
					Suborgs:             suborgs,
					MarketplaceListings: 0, // Phase 2
				},
				UpdatedAt: sub.UpdatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
				Note:      sub.Note,
			})
		}

		json.NewEncoder(w).Encode(orgtypes.AdminListOrgPlansResponse{
			Items:             items,
			NextPaginationKey: nextPaginationKey,
		})
	}
}
