package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

func CompleteSetup(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		// Decode request
		var req admin.AdminCompleteSetupRequest
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

		// Get invitation token from global DB (checks expiry automatically)
		invitationTokenData, err := s.Global.GetAdminInvitationToken(ctx, string(req.InvitationToken))
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

		// Get admin user from global DB
		adminUser, err := s.Global.GetAdminUserByID(ctx, invitationTokenData.AdminUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("admin user not found")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to get admin user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check user status - must be invited
		if adminUser.Status != globaldb.AdminUserStatusInvited {
			log.Debug("user is not in invited status", "status", adminUser.Status)
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

		// Update admin user with password and full name
		err = s.Global.UpdateAdminUserSetup(ctx, globaldb.UpdateAdminUserSetupParams{
			AdminUserID:  invitationTokenData.AdminUserID,
			PasswordHash: passwordHash,
			FullName:     pgtype.Text{String: string(req.FullName), Valid: true},
		})
		if err != nil {
			log.Error("failed to update admin user setup", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update user status to active
		err = s.Global.UpdateAdminUserStatus(ctx, globaldb.UpdateAdminUserStatusParams{
			AdminUserID: invitationTokenData.AdminUserID,
			Status:      globaldb.AdminUserStatusActive,
		})
		if err != nil {
			log.Error("failed to update admin user status", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Delete invitation token (single-use)
		err = s.Global.DeleteAdminInvitationToken(ctx, string(req.InvitationToken))
		if err != nil {
			log.Error("failed to delete invitation token", "error", err)
			// Continue anyway - user setup is complete
		}

		log.Info("admin user setup completed successfully", "admin_user_id", invitationTokenData.AdminUserID)

		// Return success response
		response := admin.AdminCompleteSetupResponse{
			Message: "Account setup completed successfully. You can now log in.",
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
