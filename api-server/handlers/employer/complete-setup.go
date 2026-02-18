package employer

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/proxy"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/employer"
)

func CompleteSetup(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		log := s.Logger(ctx)

		// Decode request
		var req employer.OrgCompleteSetupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Extract region from invitation token
		region, rawToken, err := tokens.ExtractRegionFromToken(string(req.InvitationToken))
		if err != nil {
			if errors.Is(err, tokens.ErrMissingPrefix) || errors.Is(err, tokens.ErrInvalidTokenFormat) {
				log.Debug("invalid invitation token format", "error", err)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if errors.Is(err, tokens.ErrUnknownRegion) {
				log.Debug("unknown region in invitation token", "error", err)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to extract region from invitation token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Proxy to correct region if needed
		if region != s.CurrentRegion {
			s.ProxyToRegion(w, r, region, bodyBytes)
			return
		}

		// Get invitation token from regional DB (checks expiry automatically)
		invitationTokenData, err := s.Regional.GetOrgInvitationToken(ctx, rawToken)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid or expired invitation token")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to get invitation token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get org user from regional DB to check status
		regionalUser, err := s.Regional.GetOrgUserByID(ctx, invitationTokenData.OrgUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("org user not found in regional DB")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to get org user from regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check user status - must be invited
		if regionalUser.Status != regionaldb.OrgUserStatusInvited {
			log.Debug("user is not in invited status", "status", regionalUser.Status)
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Hash password
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			log.Error("failed to hash password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Determine preferred language
		preferredLang := ""
		if req.PreferredLanguage != "" {
			preferredLang = string(req.PreferredLanguage)
		}

		// Update org user in regional DB with password, full name, status, and language
		err = s.Regional.UpdateOrgUserSetup(ctx, regionaldb.UpdateOrgUserSetupParams{
			OrgUserID:          invitationTokenData.OrgUserID,
			PasswordHash:       passwordHash,
			FullName:           pgtype.Text{String: string(req.FullName), Valid: true},
			AuthenticationType: regionaldb.AuthenticationTypeEmailPassword,
			Status:             regionaldb.OrgUserStatusActive,
			PreferredLanguage:  preferredLang,
		})
		if err != nil {
			log.Error("failed to update org user in regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Delete invitation token (single-use)
		err = s.Regional.DeleteOrgInvitationToken(ctx, rawToken)
		if err != nil {
			log.Error("failed to delete invitation token", "error", err)
			// Continue anyway - user setup is complete
		}

		log.Info("org user setup completed successfully", "org_user_id", invitationTokenData.OrgUserID)

		// Return success response
		response := employer.OrgCompleteSetupResponse{
			Message: "Account setup completed successfully. You can now log in.",
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
