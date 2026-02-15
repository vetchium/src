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
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/i18n"
	"vetchium-api-server.gomodule/internal/proxy"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/hub"
)

func RequestPasswordReset(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
			return
		}

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

		// Proxy to correct region if needed
		if globalUser.HomeRegion != s.CurrentRegion {
			s.ProxyToRegion(w, r, globalUser.HomeRegion, bodyBytes)
			return
		}

		// Get regional user for email address and status check
		regionalUser, err := s.Regional.GetHubUserByEmail(ctx, string(req.EmailAddress))
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

		// Check if user is active (status is in regional DB)
		if regionalUser.Status != regionaldb.HubUserStatusActive {
			// Return generic success message to prevent account enumeration
			log.Debug("user not active - returning generic success", "status", regionalUser.Status)
			sendGenericSuccessResponse(w, log)
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

		// Create reset token and enqueue email atomically in regional DB
		resetTokenExpiry := s.TokenConfig.PasswordResetTokenExpiry
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(resetTokenExpiry), Valid: true}
		lang := i18n.Match(regionalUser.PreferredLanguage)
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			txErr := qtx.CreateHubPasswordResetToken(ctx, regionaldb.CreateHubPasswordResetTokenParams{
				ResetToken:      rawResetToken,
				HubUserGlobalID: regionalUser.HubUserGlobalID,
				ExpiresAt:       expiresAt,
			})
			if txErr != nil {
				return txErr
			}
			return sendPasswordResetEmail(ctx, qtx, regionalUser.EmailAddress, resetToken, lang, resetTokenExpiry, s.UIConfig.HubURL)
		})
		if err != nil {
			log.Error("failed to create reset token and enqueue email", "error", err)
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

func sendPasswordResetEmail(ctx context.Context, db *regionaldb.Queries, to string, resetToken string, lang string, tokenExpiry time.Duration, baseURL string) error {
	data := templates.HubPasswordResetData{
		ResetToken: resetToken,
		Hours:      int(tokenExpiry.Hours()),
		BaseURL:    baseURL,
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
