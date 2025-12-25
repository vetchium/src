package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

func UpdatePreferences(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var request admin.UpdatePreferencesRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			s.Logger(r.Context()).Debug("failed to decode preferences request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		log := s.Logger(ctx)

		// Validate request
		if validationErrors := request.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Verify session is valid
		session, err := s.Global.GetAdminSession(ctx, string(request.SessionToken))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid or expired session token")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			log.Error("failed to query session", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update preferred language
		err = s.Global.UpdateAdminPreferredLanguage(ctx, globaldb.UpdateAdminPreferredLanguageParams{
			AdminUserID:       session.AdminUserID,
			PreferredLanguage: string(request.PreferredLanguage),
		})
		if err != nil {
			log.Error("failed to update preferred language", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("admin preferences updated", "admin_user_id", session.AdminUserID, "preferred_language", request.PreferredLanguage)

		w.WriteHeader(http.StatusOK)
	}
}
