package agency

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/agency"
)

func SetLanguage(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		session := middleware.AgencySessionFromContext(ctx)
		if session.SessionToken == "" {
			log.Debug("session not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		agencyUser := middleware.AgencyUserFromContext(ctx)
		if agencyUser == nil {
			log.Debug("agency user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var request agency.AgencySetLanguageRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			log.Debug("failed to decode set language request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if validationErrors := request.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
			}
			return
		}

		err := s.Global.UpdateAgencyUserPreferredLanguage(ctx, globaldb.UpdateAgencyUserPreferredLanguageParams{
			AgencyUserID:      agencyUser.AgencyUserID,
			PreferredLanguage: string(request.Language),
		})
		if err != nil {
			log.Error("failed to update preferred language", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("agency user language updated", "agency_user_id", agencyUser.AgencyUserID, "language", request.Language)
		w.WriteHeader(http.StatusOK)
	}
}
