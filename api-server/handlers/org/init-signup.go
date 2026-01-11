package org

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
	"vetchium-api-server.typespec/org"
)

func InitSignup(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		var req org.OrgInitSignupRequest
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

		// Hash email
		emailHash := sha256.Sum256([]byte(req.Email))

		// Check if email already registered
		_, err := s.Global.GetOrgUserByEmailHash(ctx, emailHash[:])
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

		// Validate and get regional DB for selected region
		homeRegion := globaldb.Region(strings.ToLower(req.HomeRegion))
		switch homeRegion {
		case globaldb.RegionInd1, globaldb.RegionUsa1, globaldb.RegionDeu1:
			// Valid region
		default:
			log.Debug("invalid home region", "region", req.HomeRegion)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode([]map[string]string{{"field": "home_region", "message": "invalid region"}})
			return
		}
		regionalDB := s.GetRegionalDB(homeRegion)
		if regionalDB == nil {
			log.Error("regional database not available", "region", homeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Store token in global DB
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(s.TokenConfig.HubSignupTokenExpiry), Valid: true}
		err = s.Global.CreateOrgSignupToken(ctx, globaldb.CreateOrgSignupTokenParams{
			SignupToken:      signupToken,
			EmailAddress:     string(req.Email),
			EmailAddressHash: emailHash[:],
			HashingAlgorithm: globaldb.EmailAddressHashingAlgorithmSHA256,
			ExpiresAt:        expiresAt,
			HomeRegion:       homeRegion,
		})
		if err != nil {
			log.Error("failed to store signup token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Send verification email
		lang := i18n.Match("en-US") // Default language for signup
		signupLink := fmt.Sprintf("https://org.vetchium.com/signup/verify?token=%s", signupToken)
		expiryHours := int(s.TokenConfig.HubSignupTokenExpiry.Hours())
		err = sendOrgSignupEmail(ctx, regionalDB, string(req.Email), signupLink, lang, expiryHours)
		if err != nil {
			log.Error("failed to enqueue signup email", "error", err)
			// Compensating transaction: delete the signup token we just created
			if delErr := s.Global.DeleteOrgSignupToken(ctx, signupToken); delErr != nil {
				log.Error("failed to cleanup signup token", "error", delErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("org signup verification email sent", "email_hash", hex.EncodeToString(emailHash[:]))

		response := org.OrgInitSignupResponse{
			Message: "Verification email sent. Please check your inbox.",
		}

		json.NewEncoder(w).Encode(response)
	}
}

func sendOrgSignupEmail(ctx context.Context, db *regionaldb.Queries, to string, signupLink string, lang string, expiryHours int) error {
	data := templates.OrgSignupData{
		SignupLink: signupLink,
		Hours:      expiryHours,
	}

	_, err := db.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
		EmailType:     regionaldb.EmailTemplateTypeOrgSignupVerification,
		EmailTo:       to,
		EmailSubject:  templates.OrgSignupSubject(lang),
		EmailTextBody: templates.OrgSignupTextBody(lang, data),
		EmailHtmlBody: templates.OrgSignupHTMLBody(lang, data),
	})
	return err
}
