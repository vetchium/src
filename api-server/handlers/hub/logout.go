package hub

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/hub"
)

func Logout(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var logoutRequest hub.HubLogoutRequest
		if err := json.NewDecoder(r.Body).Decode(&logoutRequest); err != nil {
			s.Logger(r.Context()).Debug("failed to decode logout request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		log := s.Logger(ctx)

		// Validate request
		if validationErrors := logoutRequest.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Verify session exists before deleting
		session, err := s.Global.GetHubSession(ctx, string(logoutRequest.SessionToken))
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

		// Delete the session
		if err := s.Global.DeleteHubSession(ctx, string(logoutRequest.SessionToken)); err != nil {
			log.Error("failed to delete session", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("hub user logged out", "hub_user_global_id", session.HubUserGlobalID)

		w.WriteHeader(http.StatusOK)
	}
}
