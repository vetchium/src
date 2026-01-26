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
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

// RequestPasswordReset handles POST /admin/request-password-reset
// Always returns 200 to prevent email enumeration attacks
func RequestPasswordReset(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		// Decode request
		var req admin.AdminRequestPasswordResetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if validationErrors := req.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
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
				log.Debug("password reset requested for non-existent email")
				w.WriteHeader(http.StatusOK)
				if err := json.NewEncoder(w).Encode(genericResponse); err != nil {
					log.Error("failed to encode response", "error", err)
				}
				return
			}

			log.Error("failed to query admin user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate reset token (32 bytes = 64 hex characters)
		resetTokenBytes := make([]byte, 32)
		if _, err := rand.Read(resetTokenBytes); err != nil {
			log.Error("failed to generate reset token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		resetToken := hex.EncodeToString(resetTokenBytes)

		// Get regional DB for email sending
		regionalDB := s.GetCurrentRegionalDB()
		if regionalDB == nil {
			log.Error("no regional database available for email sending")
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Token expires in 1 hour
		expiresAt := time.Now().UTC().Add(1 * time.Hour)

		// Store reset token in global database
		err = s.Global.CreateAdminPasswordResetToken(ctx, globaldb.CreateAdminPasswordResetTokenParams{
			ResetToken:  resetToken,
			AdminUserID: adminUser.AdminUserID,
			ExpiresAt: pgtype.Timestamp{
				Time:  expiresAt,
				Valid: true,
			},
		})
		if err != nil {
			log.Error("failed to create password reset token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get user's preferred language (fallback to en-US)
		lang := adminUser.PreferredLanguage
		if lang == "" {
			lang = "en-US"
		}

		// Send password reset email
		emailData := templates.AdminPasswordResetData{
			ResetToken: resetToken,
			Hours:      1,
			BaseURL:    s.UIConfig.AdminURL,
		}

		_, err = regionalDB.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
			EmailType:     regionaldb.EmailTemplateTypeAdminPasswordReset,
			EmailTo:       string(req.EmailAddress),
			EmailSubject:  templates.AdminPasswordResetSubject(lang),
			EmailTextBody: templates.AdminPasswordResetTextBody(lang, emailData),
			EmailHtmlBody: templates.AdminPasswordResetHTMLBody(lang, emailData),
		})
		if err != nil {
			log.Error("failed to enqueue password reset email", "error", err)
			// Don't compensate by deleting token - user can retry if email fails
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("password reset requested", "admin_user_id", adminUser.AdminUserID)

		// Return generic success response
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(genericResponse); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
