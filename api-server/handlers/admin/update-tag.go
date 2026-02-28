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
	"vetchium-api-server.typespec/admin"
)

// UpdateTag handles POST /admin/update-tag
func UpdateTag(s *server.GlobalServer) http.HandlerFunc {
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

		var req admin.UpdateTagRequest
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

		// Check tag exists
		_, err := s.Global.GetTag(ctx, req.TagID)
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

		// Replace all translations in a transaction
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			if err := qtx.DeleteTagTranslations(ctx, req.TagID); err != nil {
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
			log.Error("failed to update tag", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		tag, err := s.Global.GetTag(ctx, req.TagID)
		if err != nil {
			log.Error("failed to get updated tag", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		translations, err := s.Global.GetTagTranslations(ctx, req.TagID)
		if err != nil {
			log.Error("failed to get tag translations", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("tag updated", "tag_id", req.TagID)
		json.NewEncoder(w).Encode(buildAdminTagResponse(tag, translations))
	}
}
