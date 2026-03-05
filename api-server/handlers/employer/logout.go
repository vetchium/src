package employer

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

		// Delete the session and write audit log atomically
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.DeleteOrgSession(ctx, session.SessionToken); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "employer.logout",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.EmployerID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte("{}"),
			})
		}); err != nil {
			log.Error("failed to delete session", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("org user logged out", "org_user_id", session.OrgUserID)
		w.WriteHeader(http.StatusOK)
	}
}
