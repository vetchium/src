package admin

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

const (
	tfaTokenExpiry = 10 * time.Minute
)

func Login(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var loginRequest admin.AdminLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&loginRequest); err != nil {
			s.Logger(r.Context()).Debug("failed to decode login request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		log := s.Logger(ctx)

		// Validate request
		if validationErrors := loginRequest.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Query global database for admin user
		adminUser, err := s.Global.GetAdminUserByEmail(ctx, string(loginRequest.EmailAddress))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid credentials - user not found")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			log.Error("failed to query global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if adminUser.Status != globaldb.AdminUserStatusActive {
			log.Debug("disabled admin user")
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Verify password
		if err := bcrypt.CompareHashAndPassword(adminUser.PasswordHash, []byte(loginRequest.Password)); err != nil {
			log.Debug("invalid credentials - password mismatch")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Generate TFA token
		tfaTokenBytes := make([]byte, 32)
		if _, err := rand.Read(tfaTokenBytes); err != nil {
			log.Error("failed to generate TFA token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		tfaToken := hex.EncodeToString(tfaTokenBytes)

		// Generate 6-digit TFA code
		tfaCode, err := generateTFACode()
		if err != nil {
			log.Error("failed to generate TFA code", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get regional DB for email sending (check early to fail fast)
		regionalDB := s.GetCurrentRegionalDB()
		if regionalDB == nil {
			log.Error("no regional database available for email sending")
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Store TFA token in global database
		// NOTE: This spans two databases (global for token, regional for email).
		// We cannot use a single transaction. Instead, we use a compensating
		// transaction: if email enqueue fails, we delete the TFA token.
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(tfaTokenExpiry), Valid: true}
		err = s.Global.CreateAdminTFAToken(ctx, globaldb.CreateAdminTFATokenParams{
			TfaToken:    tfaToken,
			AdminUserID: adminUser.AdminUserID,
			TfaCode:     tfaCode,
			ExpiresAt:   expiresAt,
		})
		if err != nil {
			log.Error("failed to store TFA token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Enqueue TFA email in regional database
		err = sendTFAEmail(ctx, regionalDB, adminUser.EmailAddress, tfaCode)
		if err != nil {
			log.Error("failed to enqueue TFA email", "error", err)
			// Compensating transaction: delete the TFA token we just created
			if delErr := s.Global.DeleteAdminTFAToken(ctx, tfaToken); delErr != nil {
				log.Error("failed to delete TFA token after email enqueue failure", "error", delErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("admin login initiated, TFA email sent", "admin_user_id", adminUser.AdminUserID)

		response := admin.AdminLoginResponse{
			TFAToken: admin.AdminTFAToken(tfaToken),
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}

func generateTFACode() (string, error) {
	// Generate a random 6-digit code
	max := big.NewInt(1000000)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func sendTFAEmail(ctx context.Context, db *regionaldb.Queries, to string, tfaCode string) error {
	subject := "Vetchium Admin - Login Verification Code"
	textBody := fmt.Sprintf("Your verification code is: %s\n\nThis code will expire in 10 minutes.\n\nIf you did not request this code, please ignore this email.", tfaCode)
	htmlBody := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head><title>Login Verification</title></head>
<body>
<h2>Vetchium Admin - Login Verification</h2>
<p>Your verification code is: <strong>%s</strong></p>
<p>This code will expire in 10 minutes.</p>
<p>If you did not request this code, please ignore this email.</p>
</body>
</html>`, tfaCode)

	_, err := db.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
		EmailType:     regionaldb.EmailTemplateTypeAdminTfa,
		EmailTo:       to,
		EmailSubject:  subject,
		EmailTextBody: textBody,
		EmailHtmlBody: htmlBody,
	})
	return err
}
