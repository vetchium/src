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
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/i18n"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

func InviteUser(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		// Get authenticated admin user from context
		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Decode request
		var req admin.AdminInviteUserRequest
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

		// Check if user already exists
		_, err := s.Global.GetAdminUserByEmail(ctx, string(req.EmailAddress))
		if err == nil {
			// User already exists
			log.Debug("admin user already exists", "email", req.EmailAddress)
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "User with this email already exists",
			})
			return
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to check if user exists", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate new admin user ID
		var uuidBytes [16]byte
		if _, err := rand.Read(uuidBytes[:]); err != nil {
			log.Error("failed to generate UUID", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		newAdminUserID := pgtype.UUID{
			Bytes: uuidBytes,
			Valid: true,
		}

		// Create admin user in global DB with status='invited'
		// Don't set full_name or preferred_language - user will set these during complete-setup
		createdUser, err := s.Global.CreateAdminUser(ctx, globaldb.CreateAdminUserParams{
			AdminUserID:       newAdminUserID,
			EmailAddress:      string(req.EmailAddress),
			FullName:          pgtype.Text{Valid: false}, // User will provide during complete-setup
			Status:            globaldb.AdminUserStatusInvited,
			PreferredLanguage: "en-US", // Default, user will override during complete-setup
		})
		if err != nil {
			log.Error("failed to create admin user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate invitation token
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			log.Error("failed to generate invitation token", "error", err)
			// Compensating transaction: delete the user we just created
			s.Global.DeleteAdminUser(ctx, createdUser.AdminUserID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		invitationToken := hex.EncodeToString(tokenBytes)

		// Create invitation token in global DB
		invitationExpiry := s.TokenConfig.AdminInvitationTokenExpiry
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(invitationExpiry), Valid: true}
		err = s.Global.CreateAdminInvitationToken(ctx, globaldb.CreateAdminInvitationTokenParams{
			InvitationToken: invitationToken,
			AdminUserID:     createdUser.AdminUserID,
			ExpiresAt:       expiresAt,
		})
		if err != nil {
			log.Error("failed to create invitation token", "error", err)
			// Compensating transaction: delete the user we just created
			s.Global.DeleteAdminUser(ctx, createdUser.AdminUserID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Send invitation email
		// Determine email language: use invite_email_language if provided, otherwise inviter's preferred_language
		emailLanguage := adminUser.PreferredLanguage
		if req.InviteEmailLanguage != "" {
			emailLanguage = string(req.InviteEmailLanguage)
		}
		lang := i18n.Match(emailLanguage)
		inviterName := adminUser.FullName.String
		if inviterName == "" {
			inviterName = adminUser.EmailAddress // Fallback to email if no full name
		}

		emailData := templates.AdminInvitationData{
			InvitationToken: invitationToken,
			InviterName:     inviterName,
			Days:            int(invitationExpiry.Hours() / 24),
			BaseURL:         s.UIConfig.AdminURL,
		}

		// Get the current region's DB for email queueing
		currentRegionalDB := s.GetCurrentRegionalDB()
		if currentRegionalDB == nil {
			log.Error("current regional database not available")
			// Compensating transaction: delete everything
			s.Global.DeleteAdminInvitationToken(ctx, invitationToken)
			s.Global.DeleteAdminUser(ctx, createdUser.AdminUserID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		_, err = currentRegionalDB.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
			EmailType:     regionaldb.EmailTemplateTypeAdminInvitation,
			EmailTo:       string(req.EmailAddress),
			EmailSubject:  templates.AdminInvitationSubject(lang, emailData),
			EmailTextBody: templates.AdminInvitationTextBody(lang, emailData),
			EmailHtmlBody: templates.AdminInvitationHTMLBody(lang, emailData),
		})
		if err != nil {
			log.Error("failed to enqueue invitation email", "error", err)
			// Compensating transaction: delete everything
			s.Global.DeleteAdminInvitationToken(ctx, invitationToken)
			s.Global.DeleteAdminUser(ctx, createdUser.AdminUserID)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("admin user invited successfully", "admin_user_id", createdUser.AdminUserID, "inviter_id", adminUser.AdminUserID)

		// Return response
		response := admin.AdminInviteUserResponse{
			InvitationID: createdUser.AdminUserID.String(),
			ExpiresAt:    expiresAt.Time.Format(time.RFC3339),
		}

		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
