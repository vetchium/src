package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

// GetTag handles POST /admin/get-tag
func GetTag(s *server.GlobalServer) http.HandlerFunc {
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

		var req admin.GetTagRequest
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

		tag, err := s.Global.GetTag(ctx, req.TagID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("tag not found", "tag_id", req.TagID)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get tag", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		translations, err := s.Global.GetTagTranslations(ctx, req.TagID)
		if err != nil {
			log.Error("failed to get tag translations", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(buildAdminTagResponse(tag, translations))
	}
}
