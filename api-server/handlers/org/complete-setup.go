package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/org"
)

func CompleteSetup(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		// Decode request
		var req org.OrgCompleteSetupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Extract region from invitation token
		region, rawToken, err := tokens.ExtractRegionFromToken(string(req.InvitationToken))
		if err != nil {
			if errors.Is(err, tokens.ErrMissingPrefix) || errors.Is(err, tokens.ErrInvalidTokenFormat) {
				s.Logger(ctx).Debug("invalid invitation token format", "error", err)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if errors.Is(err, tokens.ErrUnknownRegion) {
				s.Logger(ctx).Debug("unknown region in invitation token", "error", err)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			s.Logger(ctx).Error("failed to extract region from invitation token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Select the home region's DB queries. No proxy.
		homeDB := s.GetRegionalDB(region)
		if homeDB == nil {
			s.Logger(ctx).Error("no regional pool for home region", "region", region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get invitation token from regional DB (checks expiry automatically)
		invitationTokenData, err := homeDB.GetOrgInvitationToken(ctx, rawToken)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("invalid or expired invitation token")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			s.Logger(ctx).Error("failed to get invitation token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get org user from regional DB to check status
		regionalUser, err := homeDB.GetOrgUserByID(ctx, invitationTokenData.OrgUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("org user not found in regional DB")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			s.Logger(ctx).Error("failed to get org user from regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check user status - must be invited
		if regionalUser.Status != regionaldb.OrgUserStatusInvited {
			s.Logger(ctx).Debug("user is not in invited status", "status", regionalUser.Status)
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Hash password
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			s.Logger(ctx).Error("failed to hash password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Determine preferred language
		preferredLang := ""
		if req.PreferredLanguage != "" {
			preferredLang = string(req.PreferredLanguage)
		}

		// Update org user, delete invitation token, and write audit log atomically
		err = s.WithRegionalTxFor(ctx, region, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.UpdateOrgUserSetup(ctx, regionaldb.UpdateOrgUserSetupParams{
				OrgUserID:          invitationTokenData.OrgUserID,
				PasswordHash:       passwordHash,
				FullName:           pgtype.Text{String: string(req.FullName), Valid: true},
				AuthenticationType: regionaldb.AuthenticationTypeEmailPassword,
				Status:             regionaldb.OrgUserStatusActive,
				PreferredLanguage:  preferredLang,
			}); txErr != nil {
				return txErr
			}
			if txErr := qtx.DeleteOrgInvitationToken(ctx, rawToken); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:    "org.complete_setup",
				TargetUserID: invitationTokenData.OrgUserID,
				OrgID:        invitationTokenData.OrgID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    []byte("{}"),
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to complete org user setup", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("org user setup completed successfully", "org_user_id", invitationTokenData.OrgUserID)

		// Return success response
		response := org.OrgCompleteSetupResponse{
			Message: "Account setup completed successfully. You can now log in.",
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("failed to encode response", "error", err)
		}
	}
}
