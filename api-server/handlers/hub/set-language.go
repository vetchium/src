package hub

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/hub"
)

func SetLanguage(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		session := middleware.HubSessionFromContext(ctx)
		if session.SessionToken == "" {
			s.Logger(ctx).Debug("session not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			s.Logger(ctx).Debug("hub user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var request hub.HubSetLanguageRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			s.Logger(ctx).Debug("failed to decode set language request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if validationErrors := request.Validate(); len(validationErrors) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				s.Logger(ctx).Error("failed to encode validation errors", "error", err)
			}
			return
		}

		eventData, _ := json.Marshal(map[string]any{"language": string(request.Language)})
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.UpdateHubUserPreferredLanguage(ctx, regionaldb.UpdateHubUserPreferredLanguageParams{
				HubUserGlobalID:   hubUser.HubUserGlobalID,
				PreferredLanguage: string(request.Language),
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.set_language",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to update preferred language", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("hub language updated", "hub_user_global_id", hubUser.HubUserGlobalID, "language", request.Language)
		w.WriteHeader(http.StatusOK)
	}
}
