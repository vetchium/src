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
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

// RequestPasswordReset handles POST /admin/request-password-reset
// Always returns 200 to prevent email enumeration attacks
func RequestPasswordReset(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		// Decode request
		var req admin.AdminRequestPasswordResetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if validationErrors := req.Validate(); len(validationErrors) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				s.Logger(ctx).Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Generic success response (sent even if email doesn't exist - prevents enumeration)
		genericResponse := admin.AdminRequestPasswordResetResponse{
			Message: "If an account exists with this email address, a password reset link has been sent.",
		}

		// Lookup admin user
		adminUser, err := s.Global.GetAdminUserByEmail(ctx, string(req.EmailAddress))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// User doesn't exist - return generic success to prevent enumeration
				s.Logger(ctx).Debug("password reset requested for non-existent email")
				w.WriteHeader(http.StatusOK)
				if err := json.NewEncoder(w).Encode(genericResponse); err != nil {
					s.Logger(ctx).Error("failed to encode response", "error", err)
				}
				return
			}

			s.Logger(ctx).Error("failed to query admin user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate reset token (32 bytes = 64 hex characters)
		resetTokenBytes := make([]byte, 32)
		if _, err := rand.Read(resetTokenBytes); err != nil {
			s.Logger(ctx).Error("failed to generate reset token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		resetToken := hex.EncodeToString(resetTokenBytes)

		// Token expires in 1 hour
		expiresAt := time.Now().UTC().Add(1 * time.Hour)

		// Store reset token, enqueue email, and write audit log atomically
		lang := adminUser.PreferredLanguage
		if lang == "" {
			lang = "en-US"
		}
		emailData := templates.AdminPasswordResetData{
			ResetToken: resetToken,
			Hours:      1,
			BaseURL:    s.UIConfig.AdminURL,
		}
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			if err := qtx.CreateAdminPasswordResetToken(ctx, globaldb.CreateAdminPasswordResetTokenParams{
				ResetToken:  resetToken,
				AdminUserID: adminUser.AdminUserID,
				ExpiresAt:   pgtype.Timestamp{Time: expiresAt, Valid: true},
			}); err != nil {
				return err
			}
			if _, err := qtx.EnqueueGlobalEmail(ctx, globaldb.EnqueueGlobalEmailParams{
				EmailType:     globaldb.EmailTemplateTypeAdminPasswordReset,
				EmailTo:       string(req.EmailAddress),
				EmailSubject:  templates.AdminPasswordResetSubject(lang),
				EmailTextBody: templates.AdminPasswordResetTextBody(lang, emailData),
				EmailHtmlBody: templates.AdminPasswordResetHTMLBody(lang, emailData),
			}); err != nil {
				return err
			}
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:    "admin.request_password_reset",
				TargetUserID: adminUser.AdminUserID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    []byte("{}"),
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to process password reset request", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("password reset requested", "admin_user_id", adminUser.AdminUserID)

		// Return generic success response
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(genericResponse); err != nil {
			s.Logger(ctx).Error("failed to encode response", "error", err)
		}
	}
}
