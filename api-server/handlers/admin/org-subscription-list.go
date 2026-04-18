package admin

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

// ListOrgSubscriptions returns all org subscriptions with optional tier filter.
// Requires admin:view_org_subscriptions or admin:manage_org_subscriptions.
func ListOrgSubscriptions(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.AdminListOrgSubscriptionsRequest
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

		var filterTierID pgtype.Text
		if req.FilterTierID != nil && *req.FilterTierID != "" {
			filterTierID = pgtype.Text{String: *req.FilterTierID, Valid: true}
		}

		var paginationKey pgtype.UUID
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			if err := paginationKey.Scan(*req.PaginationKey); err != nil {
				http.Error(w, "invalid pagination_key", http.StatusBadRequest)
				return
			}
		}

		rows, err := s.Global.AdminListOrgSubscriptions(ctx, globaldb.AdminListOrgSubscriptionsParams{
			FilterTierID:  filterTierID,
			PaginationKey: paginationKey,
			RowLimit:      rowLimit + 1,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to list org subscriptions", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var nextPaginationKey *string
		if int32(len(rows)) > rowLimit {
			rows = rows[:rowLimit]
			last := uuidToString(rows[len(rows)-1].OrgID)
			nextPaginationKey = &last
		}

		items := make([]orgtypes.OrgSubscription, 0, len(rows))
		for _, row := range rows {
			domain := ""
			if row.OrgDomain.Valid {
				domain = row.OrgDomain.String
			}

			sub, err := s.Global.GetOrgSubscription(ctx, row.OrgID)
			if err != nil {
				s.Logger(ctx).Error("failed to get subscription detail", "error", err, "org_id", uuidToString(row.OrgID))
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Determine the region for this org to get regional counts
			org, err := s.Global.GetOrgByID(ctx, row.OrgID)
			if err != nil {
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

			tier := buildOrgTier(sub)

			items = append(items, orgtypes.OrgSubscription{
				OrgID:       uuidToString(row.OrgID),
				OrgDomain:   domain,
				CurrentTier: tier,
				Usage: orgtypes.OrgTierUsage{
					OrgUsers:            orgUsers,
					DomainsVerified:     domainsVerified,
					Suborgs:             suborgs,
					MarketplaceListings: 0, // Phase 2
				},
				UpdatedAt: sub.UpdatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
				Note:      sub.Note,
			})
		}

		json.NewEncoder(w).Encode(orgtypes.AdminListOrgSubscriptionsResponse{
			Items:             items,
			NextPaginationKey: nextPaginationKey,
		})
	}
}
