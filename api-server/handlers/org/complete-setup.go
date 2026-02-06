package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/org"
)

func CompleteSetup(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		// Decode request
		var req org.OrgCompleteSetupRequest
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

		// Get regional database
		regionalDB := s.GetRegionalDB(region)
		if regionalDB == nil {
			log.Error("regional database not available", "region", region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get invitation token from regional DB (checks expiry automatically)
		invitationTokenData, err := regionalDB.GetOrgInvitationToken(ctx, rawToken)
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

		// Get org user from global DB
		globalUser, err := s.Global.GetOrgUserByID(ctx, invitationTokenData.OrgUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("org user not found in global DB")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to get org user from global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check user status - must be invited
		if globalUser.Status != globaldb.OrgUserStatusInvited {
			log.Debug("user is not in invited status", "status", globalUser.Status)
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

		// Update org user in regional DB with password and full name
		err = regionalDB.UpdateOrgUserSetup(ctx, regionaldb.UpdateOrgUserSetupParams{
			OrgUserID:          invitationTokenData.OrgUserID,
			PasswordHash:       passwordHash,
			FullName:           pgtype.Text{String: string(req.FullName), Valid: true},
			AuthenticationType: regionaldb.AuthenticationTypeEmailPassword,
		})
		if err != nil {
			log.Error("failed to update org user in regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update full name and preferred language in global DB
		preferredLang := ""
		if req.PreferredLanguage != "" {
			preferredLang = string(req.PreferredLanguage)
		}
		err = s.Global.UpdateOrgUserFullName(ctx, globaldb.UpdateOrgUserFullNameParams{
			OrgUserID:         invitationTokenData.OrgUserID,
			FullName:          pgtype.Text{String: string(req.FullName), Valid: true},
			PreferredLanguage: preferredLang,
		})
		if err != nil {
			log.Error("failed to update full name in global DB", "error", err)
			// Note: Regional DB already updated, but we continue since this is not critical
		}

		// Update user status to active in global DB
		err = s.Global.UpdateOrgUserStatus(ctx, globaldb.UpdateOrgUserStatusParams{
			OrgUserID: invitationTokenData.OrgUserID,
			Status:    globaldb.OrgUserStatusActive,
		})
		if err != nil {
			log.Error("failed to update user status in global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Delete invitation token (single-use)
		err = regionalDB.DeleteOrgInvitationToken(ctx, rawToken)
		if err != nil {
			log.Error("failed to delete invitation token", "error", err)
			// Continue anyway - user setup is complete
		}

		log.Info("org user setup completed successfully", "org_user_id", invitationTokenData.OrgUserID)

		// Return success response
		response := org.OrgCompleteSetupResponse{
			Message: "Account setup completed successfully. You can now log in.",
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
