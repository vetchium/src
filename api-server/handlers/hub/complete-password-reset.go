package hub

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/hub"
)

func CompletePasswordReset(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req hub.HubCompletePasswordResetRequest
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

		// Extract region from reset token
		region, rawToken, err := tokens.ExtractRegionFromToken(string(req.ResetToken))
		if err != nil {
			log.Debug("invalid reset token format", "error", err)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Get the regional database
		regionalDB := s.GetRegionalDB(region)
		if regionalDB == nil {
			log.Debug("unknown region from token", "region", region)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Validate reset token
		tokenRecord, err := regionalDB.GetHubPasswordResetToken(ctx, rawToken)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid or expired reset token")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			log.Error("failed to query reset token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get regional user to check status
		regionalUser, err := regionalDB.GetHubUserByGlobalID(ctx, tokenRecord.HubUserGlobalID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("user not found")
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}

			log.Error("failed to query regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if user is active
		if regionalUser.Status != regionaldb.HubUserStatusActive {
			log.Debug("user not active", "status", regionalUser.Status)
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Hash the new password
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			log.Error("failed to hash password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update password, delete token, and invalidate sessions atomically
		err = s.WithRegionalTx(ctx, s.GetRegionalPool(region), func(qtx *regionaldb.Queries) error {
			txErr := qtx.UpdateHubUserPassword(ctx, regionaldb.UpdateHubUserPasswordParams{
				HubUserGlobalID: tokenRecord.HubUserGlobalID,
				PasswordHash:    passwordHash,
			})
			if txErr != nil {
				return txErr
			}
			txErr = qtx.DeleteHubPasswordResetToken(ctx, rawToken)
			if txErr != nil {
				return txErr
			}
			return qtx.DeleteAllHubSessionsForUser(ctx, tokenRecord.HubUserGlobalID)
		})
		if err != nil {
			log.Error("failed to complete password reset", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("password reset completed", "hub_user_global_id", tokenRecord.HubUserGlobalID)

		// Return success (200 with empty body)
		w.WriteHeader(http.StatusOK)
	}
}
