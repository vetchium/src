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
	"vetchium-api-server.gomodule/internal/proxy"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/hub"
)

func CompleteEmailChange(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
			return
		}

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

		// Proxy to correct region if needed
		if region != s.CurrentRegion {
			s.ProxyToRegion(w, r, region, bodyBytes)
			return
		}

		// Get verification token from regional DB
		tokenRecord, err := s.Regional.GetHubEmailVerificationToken(ctx, rawToken)
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

		// Get hub user from global DB (need old email hash for compensation)
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

		// Check user status from regional DB
		regionalUser, err := s.Regional.GetHubUserByGlobalID(ctx, tokenRecord.HubUserGlobalID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("regional user not found")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to get regional user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if regionalUser.Status != regionaldb.HubUserStatusActive {
			log.Debug("user account not active", "status", regionalUser.Status)
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

		if existingUser.HubUserGlobalID.Valid &&
			existingUser.HubUserGlobalID != tokenRecord.HubUserGlobalID {
			log.Debug("email became unavailable")
			w.WriteHeader(http.StatusConflict)
			return
		}

		// Update global hash FIRST (routing change).
		// If regional update subsequently fails, we can revert the global hash
		// to the old value. Updating global first is safer because if regional
		// fails, the old email still works for login (global routes to correct
		// region, and regional still has the old email that matches).
		oldEmailHash := globalUser.EmailAddressHash
		err = s.Global.UpdateHubUserEmailHash(ctx, globaldb.UpdateHubUserEmailHashParams{
			HubUserGlobalID:  tokenRecord.HubUserGlobalID,
			EmailAddressHash: newEmailHash[:],
		})
		if err != nil {
			log.Error("failed to update email hash in global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update email address in regional DB
		err = s.Regional.UpdateHubUserEmailAddress(ctx, regionaldb.UpdateHubUserEmailAddressParams{
			HubUserGlobalID: tokenRecord.HubUserGlobalID,
			EmailAddress:    tokenRecord.NewEmailAddress,
		})
		if err != nil {
			log.Error("failed to update email in regional DB", "error", err)
			// Compensating transaction: revert global hash to old value
			if revertErr := s.Global.UpdateHubUserEmailHash(ctx, globaldb.UpdateHubUserEmailHashParams{
				HubUserGlobalID:  tokenRecord.HubUserGlobalID,
				EmailAddressHash: oldEmailHash,
			}); revertErr != nil {
				log.Error("CONSISTENCY_ALERT: failed to revert global email hash",
					"entity_type", "hub_user",
					"entity_id", tokenRecord.HubUserGlobalID,
					"intended_action", "revert_email_hash",
					"error", revertErr,
				)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Delete verification token
		err = s.Regional.DeleteHubEmailVerificationToken(ctx, rawToken)
		if err != nil {
			log.Error("failed to delete verification token", "error", err)
			// Don't fail the request - email was already updated
		}

		// Invalidate all sessions for the user
		err = s.Regional.DeleteAllHubSessionsForUser(ctx, tokenRecord.HubUserGlobalID)
		if err != nil {
			log.Error("failed to invalidate sessions", "error", err)
			// Don't fail the request - email was already updated
		}

		log.Info("email changed successfully", "hub_user_global_id", tokenRecord.HubUserGlobalID, "new_email_hash", hex.EncodeToString(newEmailHash[:]))

		// Return success (200 with empty body)
		w.WriteHeader(http.StatusOK)
	}
}
