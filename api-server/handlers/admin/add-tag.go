package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
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

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			s.Logger(ctx).Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admin.CreateTagRequest
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

		var newTag globaldb.Tag
		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			var txErr error
			newTag, txErr = qtx.CreateTag(ctx, req.TagID)
			if txErr != nil {
				if server.IsUniqueViolation(txErr) {
					return server.ErrConflict
				}
				return txErr
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
			eventData, _ := json.Marshal(map[string]any{"tag_id": req.TagID})
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.add_tag",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, server.ErrConflict) {
				s.Logger(ctx).Debug("tag already exists", "tag_id", req.TagID)
				w.WriteHeader(http.StatusConflict)
				return
			}
			s.Logger(ctx).Error("failed to create tag", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		translationsForResponse := make([]globaldb.GetTagTranslationsRow, len(req.Translations))
		for i, t := range req.Translations {
			translationsForResponse[i] = globaldb.GetTagTranslationsRow{
				Locale:      t.Locale,
				DisplayName: t.DisplayName,
			}
			if t.Description != nil {
				translationsForResponse[i].Description = pgtype.Text{String: *t.Description, Valid: true}
			}
		}

		s.Logger(ctx).Info("tag created", "tag_id", req.TagID)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(buildAdminTagResponse(newTag, translationsForResponse))
	}
}
