package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

// AddTag handles POST /admin/add-tag
func AddTag(s *server.GlobalServer) http.HandlerFunc {
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

		var req admin.CreateTagRequest
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

		// Create tag and translations in a transaction
		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			if err := qtx.CreateTag(ctx, req.TagID); err != nil {
				if server.IsUniqueViolation(err) {
					return server.ErrConflict
				}
				return err
			}
			for _, t := range req.Translations {
				upsertParams := globaldb.UpsertTagTranslationParams{
					TagID:       req.TagID,
					Locale:      t.Locale,
					DisplayName: t.DisplayName,
				}
				if t.Description != nil {
					upsertParams.Description = pgtype.Text{String: *t.Description, Valid: true}
				}
				if err := qtx.UpsertTagTranslation(ctx, upsertParams); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			if errors.Is(err, server.ErrConflict) {
				log.Debug("tag already exists", "tag_id", req.TagID)
				w.WriteHeader(http.StatusConflict)
				return
			}
			log.Error("failed to create tag", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Fetch back to return full response
		tag, err := s.Global.GetTag(ctx, req.TagID)
		if err != nil {
			log.Error("failed to get created tag", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		translations, err := s.Global.GetTagTranslations(ctx, req.TagID)
		if err != nil {
			log.Error("failed to get tag translations", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("tag created", "tag_id", req.TagID)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(buildAdminTagResponse(tag, translations))
	}
}
