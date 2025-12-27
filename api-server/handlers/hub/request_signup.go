package hub

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/i18n"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/hub"
)

const (
	signupTokenExpiry = 24 * time.Hour
)

func RequestSignup(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		var req hub.RequestSignupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Extract domain from email
		parts := strings.Split(string(req.EmailAddress), "@")
		if len(parts) != 2 {
			log.Debug("invalid email format")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		domain := strings.ToLower(parts[1])

		// Check if domain is approved
		_, err := s.Global.GetActiveDomainByName(ctx, domain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("domain not approved", "domain", domain)
				w.WriteHeader(http.StatusForbidden)
				return
			}
			log.Error("failed to query domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Hash email
		emailHash := sha256.Sum256([]byte(req.EmailAddress))

		// Check if email already registered
		_, err = s.Global.GetHubUserByEmailHash(ctx, emailHash[:])
		if err == nil {
			log.Debug("email already registered")
			w.WriteHeader(http.StatusConflict)
			return
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to query user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate signup token
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			log.Error("failed to generate token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		signupToken := hex.EncodeToString(tokenBytes)

		// Get regional DB for current region
		regionalDB := s.GetCurrentRegionalDB()
		if regionalDB == nil {
			log.Error("no regional database available")
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Store token in global DB
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(signupTokenExpiry), Valid: true}
		err = s.Global.CreateHubSignupToken(ctx, globaldb.CreateHubSignupTokenParams{
			SignupToken:      signupToken,
			EmailAddress:     string(req.EmailAddress),
			EmailAddressHash: emailHash[:],
			HashingAlgorithm: globaldb.EmailAddressHashingAlgorithmSHA256,
			ExpiresAt:        expiresAt,
		})
		if err != nil {
			log.Error("failed to store signup token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Send verification email
		lang := i18n.Match("en-US") // Default language for signup
		signupLink := fmt.Sprintf("https://hub.vetchium.com/signup/verify?token=%s", signupToken)
		err = sendSignupEmail(ctx, regionalDB, string(req.EmailAddress), signupLink, lang)
		if err != nil {
			log.Error("failed to enqueue signup email", "error", err)
			// Compensating transaction: delete signup token
			if delErr := s.Global.DeleteExpiredHubSignupTokens(ctx); delErr != nil {
				log.Error("failed to cleanup signup token", "error", delErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("signup verification email sent", "email_hash", hex.EncodeToString(emailHash[:]))

		response := hub.RequestSignupResponse{
			Message: "Verification email sent. Please check your inbox.",
		}

		json.NewEncoder(w).Encode(response)
	}
}

func sendSignupEmail(ctx context.Context, db *regionaldb.Queries, to string, signupLink string, lang string) error {
	data := templates.HubSignupData{
		SignupLink: signupLink,
		Hours:      24,
	}

	_, err := db.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
		EmailType:     regionaldb.EmailTemplateTypeHubSignupVerification,
		EmailTo:       to,
		EmailSubject:  templates.HubSignupSubject(lang),
		EmailTextBody: templates.HubSignupTextBody(lang, data),
		EmailHtmlBody: templates.HubSignupHTMLBody(lang, data),
	})
	return err
}
