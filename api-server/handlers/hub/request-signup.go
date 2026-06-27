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

func RequestSignup(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		var req hub.RequestSignupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Validate home region. Verify enum membership in Go BEFORE any DB call;
		// casting an unknown value to the Postgres `region` enum errors with 22P02
		// (a *pgconn.PgError, not pgx.ErrNoRows) and would otherwise fall through
		// to a 500. Mirrors org's init-signup.go.
		homeRegion := globaldb.Region(strings.ToLower(req.HomeRegion))
		switch homeRegion {
		case globaldb.RegionInd1, globaldb.RegionUsa1, globaldb.RegionDeu1:
			// Valid region
		default:
			s.Logger(ctx).Debug("invalid home region", "region", req.HomeRegion)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode([]map[string]string{{"field": "home_region", "message": "invalid region"}})
			return
		}

		// home region is now a known-valid enum, so the cast won't error.
		region, err := s.Global.GetRegionByCode(ctx, homeRegion)
		if err != nil {
			s.Logger(ctx).Error("failed to query region", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if !region.IsActive {
			s.Logger(ctx).Debug("region not active", "region", req.HomeRegion)
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		// Select the home region's DB for the email queue.
		homeDB := s.GetRegionalDB(homeRegion)
		if homeDB == nil {
			s.Logger(ctx).Error("no regional pool for home region", "region", homeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Extract domain from email
		parts := strings.Split(string(req.EmailAddress), "@")
		if len(parts) != 2 {
			s.Logger(ctx).Debug("invalid email format")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		domain := strings.ToLower(parts[1])

		// Check if domain is approved
		_, err = s.Global.GetActiveDomainByName(ctx, domain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("domain not approved", "domain", domain)
				w.WriteHeader(http.StatusForbidden)
				return
			}
			s.Logger(ctx).Error("failed to query domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Hash email
		emailHash := sha256.Sum256([]byte(req.EmailAddress))

		// Check if email already registered
		_, err = s.Global.GetHubUserByEmailHash(ctx, emailHash[:])
		if err == nil {
			s.Logger(ctx).Debug("email already registered")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "email already registered"})
			return
		} else if !errors.Is(err, pgx.ErrNoRows) {
			s.Logger(ctx).Error("failed to query user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate signup token
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			s.Logger(ctx).Error("failed to generate token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		signupToken := hex.EncodeToString(tokenBytes)

		// Store token in global DB (includes home_region so Stage 2 can read it from the token).
		expiresAt := pgtype.Timestamptz{Time: time.Now().Add(s.TokenConfig.HubSignupTokenExpiry), Valid: true}
		err = s.Global.CreateHubSignupToken(ctx, globaldb.CreateHubSignupTokenParams{
			SignupToken:      signupToken,
			EmailAddress:     string(req.EmailAddress),
			EmailAddressHash: emailHash[:],
			HashingAlgorithm: globaldb.EmailAddressHashingAlgorithmSHA256,
			ExpiresAt:        expiresAt,
			HomeRegion:       homeRegion,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to store signup token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Send verification email via the chosen region's DB queue (mirrors org).
		lang := i18n.Match("en-US") // Default language for signup
		signupLink := fmt.Sprintf("%s/signup/verify?token=%s", s.UIConfig.HubURL, signupToken)
		expiryHours := int(s.TokenConfig.HubSignupTokenExpiry.Hours())
		err = sendSignupEmail(ctx, homeDB, string(req.EmailAddress), signupLink, lang, expiryHours)
		if err != nil {
			s.Logger(ctx).Error("failed to enqueue signup email", "error", err)
			// Compensating transaction: delete the signup token we just created
			if delErr := s.Global.DeleteHubSignupToken(ctx, signupToken); delErr != nil {
				s.Logger(ctx).Error("failed to cleanup signup token", "error", delErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("signup verification email sent", "email_hash", hex.EncodeToString(emailHash[:]))

		response := hub.RequestSignupResponse{
			Message: "Verification email sent. Please check your inbox.",
		}

		json.NewEncoder(w).Encode(response)
	}
}

func sendSignupEmail(ctx context.Context, db *regionaldb.Queries, to string, signupLink string, lang string, expiryHours int) error {
	data := templates.HubSignupData{
		SignupLink: signupLink,
		Hours:      expiryHours,
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
