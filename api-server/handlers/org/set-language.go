package org

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/org"
)

func SetLanguage(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		session := middleware.OrgSessionFromContext(ctx)
		if session.SessionToken == "" {
			log.Debug("session not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			log.Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var request org.OrgSetLanguageRequest
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

		// Get region from context
		region := middleware.OrgRegionFromContext(ctx)
		if region == "" {
			log.Error("region not found in context")
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get regional DB
		regionalDB := s.GetRegionalDB(globaldb.Region(region))
		if regionalDB == nil {
			log.Error("regional database not available", "region", region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		err := regionalDB.UpdateOrgUserPreferredLanguage(ctx, regionaldb.UpdateOrgUserPreferredLanguageParams{
			OrgUserID:         orgUser.OrgUserID,
			PreferredLanguage: string(request.Language),
		})
		if err != nil {
			log.Error("failed to update preferred language", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("org user language updated", "org_user_id", orgUser.OrgUserID, "language", request.Language)
		w.WriteHeader(http.StatusOK)
	}
}
