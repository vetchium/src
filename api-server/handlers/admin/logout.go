package admin

import (
	"net/http"

	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

func Logout(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		// Extract session from context (set by middleware)
		session := middleware.AdminSessionFromContext(ctx)
		if session.SessionToken == "" {
			log.Debug("session not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Delete session and write audit log atomically
		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			if err := qtx.DeleteAdminSession(ctx, session.SessionToken); err != nil {
				return err
			}
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.logout",
				ActorUserID: session.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte("{}"),
			})
		})
		if err != nil {
			log.Error("failed to logout", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("admin logged out", "admin_user_id", session.AdminUserID)
		w.WriteHeader(http.StatusOK)
	}
}
