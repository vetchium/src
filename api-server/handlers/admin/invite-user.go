package admin

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/i18n"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

func InviteUser(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		// Get authenticated admin user from context
		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			s.Logger(ctx).Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Decode request
		var req admin.AdminInviteUserRequest
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

		// Check if user already exists
		_, err := s.Global.GetAdminUserByEmail(ctx, string(req.EmailAddress))
		if err == nil {
			// User already exists
			s.Logger(ctx).Debug("admin user already exists", "email", req.EmailAddress)
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "User with this email already exists",
			})
			return
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			s.Logger(ctx).Error("failed to check if user exists", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate new admin user ID
		var uuidBytes [16]byte
		if _, err := rand.Read(uuidBytes[:]); err != nil {
			s.Logger(ctx).Error("failed to generate UUID", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		newAdminUserID := pgtype.UUID{
			Bytes: uuidBytes,
			Valid: true,
		}

		// Generate invitation token
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			s.Logger(ctx).Error("failed to generate invitation token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		invitationToken := hex.EncodeToString(tokenBytes)
		invitationExpiry := s.TokenConfig.AdminInvitationTokenExpiry
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(invitationExpiry), Valid: true}

		emailLanguage := adminUser.PreferredLanguage
		if req.InviteEmailLanguage != "" {
			emailLanguage = string(req.InviteEmailLanguage)
		}
		lang := i18n.Match(emailLanguage)
		inviterName := adminUser.FullName.String
		if inviterName == "" {
			inviterName = adminUser.EmailAddress
		}
		emailData := templates.AdminInvitationData{
			InvitationToken: invitationToken,
			InviterName:     inviterName,
			Days:            int(invitationExpiry.Hours() / 24),
			BaseURL:         s.UIConfig.AdminURL,
		}

		// Create user, token, email, and audit log atomically
		var createdUserID pgtype.UUID
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			createdUser, err := qtx.CreateAdminUser(ctx, globaldb.CreateAdminUserParams{
				AdminUserID:       newAdminUserID,
				EmailAddress:      string(req.EmailAddress),
				FullName:          pgtype.Text{Valid: false},
				Status:            globaldb.AdminUserStatusInvited,
				PreferredLanguage: "en-US",
			})
			if err != nil {
				return err
			}
			createdUserID = createdUser.AdminUserID
			if err := qtx.CreateAdminInvitationToken(ctx, globaldb.CreateAdminInvitationTokenParams{
				InvitationToken: invitationToken,
				AdminUserID:     createdUser.AdminUserID,
				ExpiresAt:       expiresAt,
			}); err != nil {
				return err
			}
			if _, err := qtx.EnqueueGlobalEmail(ctx, globaldb.EnqueueGlobalEmailParams{
				EmailType:     globaldb.EmailTemplateTypeAdminInvitation,
				EmailTo:       string(req.EmailAddress),
				EmailSubject:  templates.AdminInvitationSubject(lang, emailData),
				EmailTextBody: templates.AdminInvitationTextBody(lang, emailData),
				EmailHtmlBody: templates.AdminInvitationHTMLBody(lang, emailData),
			}); err != nil {
				return err
			}
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:    "admin.invite_user",
				ActorUserID:  adminUser.AdminUserID,
				TargetUserID: createdUser.AdminUserID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    []byte("{}"),
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to invite admin user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("admin user invited successfully", "admin_user_id", createdUserID, "inviter_id", adminUser.AdminUserID)

		// Return response
		response := admin.AdminInviteUserResponse{
			InvitationID: createdUserID.String(),
			ExpiresAt:    expiresAt.Time.Format(time.RFC3339),
		}

		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("failed to encode response", "error", err)
		}
	}
}
