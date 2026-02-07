package hub

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/hub"
)

func ChangePassword(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req hub.HubChangePasswordRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(r.Context()).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		log := s.Logger(ctx)

		// Validate request
		if validationErrors := req.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Get authenticated user from context
		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			log.Debug("hub user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		hubSession := middleware.HubSessionFromContext(ctx)
		if hubSession.SessionToken == "" {
			log.Debug("hub session not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		region := middleware.HubRegionFromContext(ctx)
		if region == "" {
			log.Debug("hub region not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Get regional database
		regionalDB := s.GetRegionalDB(globaldb.Region(region))
		if regionalDB == nil {
			log.Error("unknown region", "region", region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get regional user to verify current password
		regionalUser, err := regionalDB.GetHubUserByGlobalID(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("regional user not found")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			log.Error("failed to query regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify current password
		if err := bcrypt.CompareHashAndPassword(regionalUser.PasswordHash, []byte(req.CurrentPassword)); err != nil {
			log.Debug("current password incorrect")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Hash new password
		newPasswordHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			log.Error("failed to hash password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update password and invalidate other sessions atomically
		regionalPool := s.GetRegionalPool(globaldb.Region(region))
		err = s.WithRegionalTx(ctx, regionalPool, func(qtx *regionaldb.Queries) error {
			txErr := qtx.UpdateHubUserPassword(ctx, regionaldb.UpdateHubUserPasswordParams{
				HubUserGlobalID: hubUser.HubUserGlobalID,
				PasswordHash:    newPasswordHash,
			})
			if txErr != nil {
				return txErr
			}
			return qtx.DeleteAllHubSessionsExceptCurrent(ctx, regionaldb.DeleteAllHubSessionsExceptCurrentParams{
				HubUserGlobalID: hubUser.HubUserGlobalID,
				SessionToken:    hubSession.SessionToken,
			})
		})
		if err != nil {
			log.Error("failed to update password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("password changed successfully", "hub_user_global_id", hubUser.HubUserGlobalID)

		// Return success (200 with empty body)
		w.WriteHeader(http.StatusOK)
	}
}
