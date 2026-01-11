package org

import (
	"net/http"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

func Logout(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		// Extract session from context (set by middleware)
		session := middleware.OrgSessionFromContext(ctx)
		if session.SessionToken == "" {
			log.Debug("session not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Get region from context
		region := middleware.OrgRegionFromContext(ctx)
		if region == "" {
			log.Error("region not found in context")
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get regional database
		regionalDB := s.GetRegionalDB(globaldb.Region(region))
		if regionalDB == nil {
			log.Error("regional database not available", "region", region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Delete the session from regional database
		if err := regionalDB.DeleteOrgSession(ctx, session.SessionToken); err != nil {
			log.Error("failed to delete session", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("org user logged out", "org_user_id", session.OrgUserID, "region", region)
		w.WriteHeader(http.StatusOK)
	}
}
