package hub

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/i18n"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/hub"
)

func RequestPasswordReset(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req hub.HubRequestPasswordResetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(r.Context()).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		log := s.Logger(ctx)

		// Validate request
		if validationErrors := req.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Hash email to query global database
		emailHash := sha256.Sum256([]byte(req.EmailAddress))

		// Query global database for user status and home region
		globalUser, err := s.Global.GetHubUserByEmailHash(ctx, emailHash[:])
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Return generic success message to prevent account enumeration
				log.Debug("user not found - returning generic success")
				sendGenericSuccessResponse(w, log)
				return
			}

			log.Error("failed to query global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if user is active
		if globalUser.Status != globaldb.HubUserStatusActive {
			// Return generic success message to prevent account enumeration
			log.Debug("user not active - returning generic success", "status", globalUser.Status)
			sendGenericSuccessResponse(w, log)
			return
		}

		// Get the regional database for this user
		regionalDB := s.GetRegionalDB(globalUser.HomeRegion)
		if regionalDB == nil {
			log.Error("unknown region", "region", globalUser.HomeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get regional user for email address
		regionalUser, err := regionalDB.GetHubUserByEmail(ctx, string(req.EmailAddress))
		if errors.Is(err, pgx.ErrNoRows) {
			// Should not happen since global user exists, but handle gracefully
			log.Error("regional user not found but global user exists", "hub_user_global_id", globalUser.HubUserGlobalID)
			sendGenericSuccessResponse(w, log)
			return
		}
		if err != nil {
			log.Error("failed to query regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate password reset token
		resetTokenBytes := make([]byte, 32)
		if _, err := rand.Read(resetTokenBytes); err != nil {
			log.Error("failed to generate reset token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		rawResetToken := hex.EncodeToString(resetTokenBytes)

		// Add region prefix to reset token
		resetToken := tokens.AddRegionPrefix(globalUser.HomeRegion, rawResetToken)

		// Store reset token in regional database
		resetTokenExpiry := s.TokenConfig.PasswordResetTokenExpiry
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(resetTokenExpiry), Valid: true}
		err = regionalDB.CreateHubPasswordResetToken(ctx, regionaldb.CreateHubPasswordResetTokenParams{
			ResetToken:      rawResetToken,
			HubUserGlobalID: regionalUser.HubUserGlobalID,
			ExpiresAt:       expiresAt,
		})
		if err != nil {
			log.Error("failed to store password reset token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Enqueue password reset email
		lang := i18n.Match(globalUser.PreferredLanguage)
		err = sendPasswordResetEmail(ctx, regionalDB, regionalUser.EmailAddress, resetToken, lang, resetTokenExpiry)
		if err != nil {
			log.Error("failed to enqueue password reset email", "error", err)
			// Compensating transaction: delete the reset token we just created
			if delErr := regionalDB.DeleteHubPasswordResetToken(ctx, rawResetToken); delErr != nil {
				log.Error("failed to delete reset token after email enqueue failure", "error", delErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("password reset email sent", "hub_user_global_id", globalUser.HubUserGlobalID)

		sendGenericSuccessResponse(w, log)
	}
}

func sendGenericSuccessResponse(w http.ResponseWriter, log *slog.Logger) {
	response := hub.HubRequestPasswordResetResponse{
		Message: "If an account exists with that email address, we will send a password reset link.",
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Error("JSON encoding error", "error", err)
		http.Error(w, "", http.StatusInternalServerError)
		return
	}
}

func sendPasswordResetEmail(ctx context.Context, db *regionaldb.Queries, to string, resetToken string, lang string, tokenExpiry time.Duration) error {
	data := templates.HubPasswordResetData{
		ResetToken: resetToken,
		Hours:      int(tokenExpiry.Hours()),
	}

	_, err := db.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
		EmailType:     regionaldb.EmailTemplateTypeHubPasswordReset,
		EmailTo:       to,
		EmailSubject:  templates.HubPasswordResetSubject(lang),
		EmailTextBody: templates.HubPasswordResetTextBody(lang, data),
		EmailHtmlBody: templates.HubPasswordResetHTMLBody(lang, data),
	})
	return err
}
