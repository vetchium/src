package hub

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/hub"
)

func CompleteEmailChange(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req hub.HubCompleteEmailChangeRequest
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

		// Parse region from token
		region, rawToken, err := tokens.ExtractRegionFromToken(string(req.VerificationToken))
		if err != nil {
			log.Debug("invalid token format", "error", err)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Get regional database
		regionalDB := s.GetRegionalDB(region)
		if regionalDB == nil {
			log.Debug("unknown region from token", "region", region)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Get verification token from regional DB
		tokenRecord, err := regionalDB.GetHubEmailVerificationToken(ctx, rawToken)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("verification token not found or expired")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to get verification token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get hub user from global DB
		globalUser, err := s.Global.GetHubUserByGlobalID(ctx, tokenRecord.HubUserGlobalID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("hub user not found")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to get hub user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check user status
		if globalUser.Status != globaldb.HubUserStatusActive {
			log.Debug("user account not active", "status", globalUser.Status)
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Check if new email is still available (race condition check)
		newEmailHash := sha256.Sum256([]byte(tokenRecord.NewEmailAddress))

		existingUser, err := s.Global.GetHubUserByEmailHash(ctx, newEmailHash[:])
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to check email availability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if existingUser.HubUserGlobalID.String() != "" &&
			existingUser.HubUserGlobalID != tokenRecord.HubUserGlobalID &&
			existingUser.Status == globaldb.HubUserStatusActive {
			log.Debug("email became unavailable")
			w.WriteHeader(http.StatusConflict)
			return
		}

		// Update email address in regional DB
		err = regionalDB.UpdateHubUserEmailAddress(ctx, regionaldb.UpdateHubUserEmailAddressParams{
			HubUserGlobalID: tokenRecord.HubUserGlobalID,
			EmailAddress:    tokenRecord.NewEmailAddress,
		})
		if err != nil {
			log.Error("failed to update email in regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update email hash in global DB
		err = s.Global.UpdateHubUserEmailHash(ctx, globaldb.UpdateHubUserEmailHashParams{
			HubUserGlobalID:  tokenRecord.HubUserGlobalID,
			EmailAddressHash: newEmailHash[:],
		})
		if err != nil {
			log.Error("failed to update email hash in global DB", "error", err)
			// This is a critical error - email is inconsistent between DBs
			// In production, this would need manual intervention
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Delete verification token
		err = regionalDB.DeleteHubEmailVerificationToken(ctx, rawToken)
		if err != nil {
			log.Error("failed to delete verification token", "error", err)
			// Don't fail the request - email was already updated
		}

		// Invalidate all sessions for the user
		err = regionalDB.DeleteAllHubSessionsForUser(ctx, tokenRecord.HubUserGlobalID)
		if err != nil {
			log.Error("failed to invalidate sessions", "error", err)
			// Don't fail the request - email was already updated
		}

		log.Info("email changed successfully", "hub_user_global_id", tokenRecord.HubUserGlobalID, "new_email_hash", hex.EncodeToString(newEmailHash[:]))

		// Return success (200 with empty body)
		w.WriteHeader(http.StatusOK)
	}
}
