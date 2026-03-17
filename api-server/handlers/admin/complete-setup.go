package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

func CompleteSetup(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		// Decode request
		var req admin.AdminCompleteSetupRequest
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

		// Get invitation token from global DB (checks expiry automatically)
		invitationTokenData, err := s.Global.GetAdminInvitationToken(ctx, string(req.InvitationToken))
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

		// Get admin user from global DB
		adminUser, err := s.Global.GetAdminUserByID(ctx, invitationTokenData.AdminUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("admin user not found")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			s.Logger(ctx).Error("failed to get admin user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check user status - must be invited
		if adminUser.Status != globaldb.AdminUserStatusInvited {
			s.Logger(ctx).Debug("user is not in invited status", "status", adminUser.Status)
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

		// Update admin user, activate, delete token, and write audit log atomically
		preferredLang := ""
		if req.PreferredLanguage != "" {
			preferredLang = string(req.PreferredLanguage)
		}
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			if err := qtx.UpdateAdminUserSetup(ctx, globaldb.UpdateAdminUserSetupParams{
				AdminUserID:       invitationTokenData.AdminUserID,
				PasswordHash:      passwordHash,
				FullName:          pgtype.Text{String: string(req.FullName), Valid: true},
				PreferredLanguage: preferredLang,
			}); err != nil {
				return err
			}
			if err := qtx.UpdateAdminUserStatus(ctx, globaldb.UpdateAdminUserStatusParams{
				AdminUserID: invitationTokenData.AdminUserID,
				Status:      globaldb.AdminUserStatusActive,
			}); err != nil {
				return err
			}
			if err := qtx.DeleteAdminInvitationToken(ctx, string(req.InvitationToken)); err != nil {
				return err
			}
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:    "admin.complete_setup",
				TargetUserID: invitationTokenData.AdminUserID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    []byte("{}"),
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to complete admin user setup", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("admin user setup completed successfully", "admin_user_id", invitationTokenData.AdminUserID)

		// Return success response
		response := admin.AdminCompleteSetupResponse{
			Message: "Account setup completed successfully. You can now log in.",
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("failed to encode response", "error", err)
		}
	}
}
