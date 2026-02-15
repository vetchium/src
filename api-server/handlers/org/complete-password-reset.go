package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/proxy"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/org"
)

func CompletePasswordReset(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		log := s.Logger(ctx)

		var req org.OrgCompletePasswordResetRequest
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

		// Extract region from token
		region, _, err := tokens.ExtractRegionFromToken(string(req.ResetToken))
		if err != nil {
			log.Debug("invalid reset token format", "error", err)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Proxy to correct region if needed
		if region != s.CurrentRegion {
			s.ProxyToRegion(w, r, region, bodyBytes)
			return
		}

		// Look up reset token (includes expiry check)
		resetTokenRecord, err := s.Regional.GetOrgPasswordResetToken(ctx, string(req.ResetToken))
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
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			txErr := qtx.UpdateOrgUserPassword(ctx, regionaldb.UpdateOrgUserPasswordParams{
				OrgUserID:    resetTokenRecord.OrgUserGlobalID,
				PasswordHash: passwordHash,
			})
			if txErr != nil {
				return txErr
			}
			txErr = qtx.DeleteOrgPasswordResetToken(ctx, string(req.ResetToken))
			if txErr != nil {
				return txErr
			}
			return qtx.DeleteAllOrgSessionsForUser(ctx, resetTokenRecord.OrgUserGlobalID)
		})
		if err != nil {
			log.Error("failed to complete password reset", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("password reset completed", "org_user_id", resetTokenRecord.OrgUserGlobalID)

		w.WriteHeader(http.StatusOK)
	}
}
