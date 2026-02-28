package admin

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

const tagFilterDefaultLimit = 25

// FilterTags handles POST /admin/filter-tags
func FilterTags(s *server.GlobalServer) http.HandlerFunc {
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

		var req admin.FilterTagsAdminRequest
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

		rows, err := s.Global.FilterTagsAdmin(ctx, globaldb.FilterTagsAdminParams{
			Query:         req.Query,
			PaginationKey: req.PaginationKey,
			LimitCount:    int32(tagFilterDefaultLimit + 1),
		})
		if err != nil {
			log.Error("failed to filter tags", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > tagFilterDefaultLimit
		if hasMore {
			rows = rows[:tagFilterDefaultLimit]
		}

		var nextPaginationKey string
		if hasMore && len(rows) > 0 {
			nextPaginationKey = rows[len(rows)-1].TagID
		}

		tags := make([]admin.AdminTag, 0, len(rows))
		for _, row := range rows {
			translations, err := s.Global.GetTagTranslations(ctx, row.TagID)
			if err != nil {
				log.Error("failed to get tag translations", "error", err, "tag_id", row.TagID)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			tags = append(tags, buildAdminTagResponse(row, translations))
		}

		json.NewEncoder(w).Encode(admin.FilterTagsAdminResponse{
			Tags:          tags,
			PaginationKey: nextPaginationKey,
		})
	}
}
