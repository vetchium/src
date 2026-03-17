package admin

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

func SetLanguage(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		// Extract session from context (set by middleware)
		session := middleware.AdminSessionFromContext(ctx)
		if session.SessionToken == "" {
			s.Logger(ctx).Debug("session not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var request admin.AdminSetLanguageRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			s.Logger(ctx).Debug("failed to decode set-language request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if validationErrors := request.Validate(); len(validationErrors) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				s.Logger(ctx).Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Update preferred language and write audit log atomically
		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			if err := qtx.UpdateAdminPreferredLanguage(ctx, globaldb.UpdateAdminPreferredLanguageParams{
				AdminUserID:       session.AdminUserID,
				PreferredLanguage: string(request.Language),
			}); err != nil {
				return err
			}
			eventData, _ := json.Marshal(map[string]any{"language": string(request.Language)})
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.set_language",
				ActorUserID: session.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to update preferred language", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("admin language updated", "admin_user_id", session.AdminUserID, "language", request.Language)
		w.WriteHeader(http.StatusOK)
	}
}
