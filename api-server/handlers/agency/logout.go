package agency

import (
	"net/http"

	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

func Logout(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		// Extract session from context (set by middleware)
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

		// Delete the session and write audit log atomically
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.DeleteAgencySession(ctx, session.SessionToken); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "agency.logout",
				ActorUserID: agencyUser.AgencyUserID,
				OrgID:       agencyUser.AgencyID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte("{}"),
			})
		}); err != nil {
			log.Error("failed to delete session", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("agency user logged out", "agency_user_id", session.AgencyUserID)
		w.WriteHeader(http.StatusOK)
	}
}
