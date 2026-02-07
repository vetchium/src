package agency

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/agency"
)

func CompletePasswordReset(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		var req agency.AgencyCompletePasswordResetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if validationErrors := req.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Extract region from token (format: REGION-{64-char-hex})
		tokenParts := strings.SplitN(string(req.ResetToken), "-", 2)
		if len(tokenParts) != 2 {
			log.Debug("invalid reset token format")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		region := globaldb.Region(strings.ToLower(tokenParts[0]))

		// Get regional DB
		regionalDB := s.GetRegionalDB(region)
		if regionalDB == nil {
			log.Debug("invalid region in token", "region", region)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Look up reset token (includes expiry check)
		resetTokenRecord, err := regionalDB.GetAgencyPasswordResetToken(ctx, string(req.ResetToken))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("reset token not found or expired")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to get reset token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Hash new password
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			log.Error("failed to hash password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update password, delete token, and invalidate sessions atomically
		regionalPool := s.GetRegionalPool(region)
		err = s.WithRegionalTx(ctx, regionalPool, func(qtx *regionaldb.Queries) error {
			txErr := qtx.UpdateAgencyUserPassword(ctx, regionaldb.UpdateAgencyUserPasswordParams{
				AgencyUserID: resetTokenRecord.AgencyUserGlobalID,
				PasswordHash: passwordHash,
			})
			if txErr != nil {
				return txErr
			}
			txErr = qtx.DeleteAgencyPasswordResetToken(ctx, string(req.ResetToken))
			if txErr != nil {
				return txErr
			}
			return qtx.DeleteAllAgencySessionsForUser(ctx, resetTokenRecord.AgencyUserGlobalID)
		})
		if err != nil {
			log.Error("failed to complete password reset", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("password reset completed", "agency_user_id", resetTokenRecord.AgencyUserGlobalID)

		w.WriteHeader(http.StatusOK)
	}
}
