package admin

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

const tagFilterDefaultLimit = 50

// FilterTags handles POST /admin/filter-tags
func FilterTags(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			s.Logger(ctx).Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admin.AdminFilterTagsRequest
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

		limit := tagFilterDefaultLimit
		if req.Limit != nil {
			limit = int(*req.Limit)
		}

		query := ""
		if req.Query != nil {
			query = *req.Query
		}

		paginationKey := ""
		if req.PaginationKey != nil {
			paginationKey = *req.PaginationKey
		}

		rows, err := s.Global.FilterTagsAdmin(ctx, globaldb.FilterTagsAdminParams{
			Query:         query,
			PaginationKey: paginationKey,
			LimitCount:    int32(limit + 1),
		})
		if err != nil {
			s.Logger(ctx).Error("failed to filter tags", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}

		var nextPaginationKey *string
		if hasMore {
			key := rows[len(rows)-1].TagID
			nextPaginationKey = &key
		}

		tags := make([]admin.AdminTag, 0, len(rows))
		for _, row := range rows {
			translations, err := s.Global.GetTagTranslations(ctx, row.TagID)
			if err != nil {
				s.Logger(ctx).Error("failed to get tag translations", "error", err, "tag_id", row.TagID)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			tags = append(tags, buildAdminTagResponse(row, translations))
		}

		json.NewEncoder(w).Encode(admin.AdminFilterTagsResponse{
			Tags:              tags,
			NextPaginationKey: nextPaginationKey,
		})
	}
}
