package org

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
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
	"vetchium-api-server.gomodule/internal/email/templates"
	"vetchium-api-server.gomodule/internal/i18n"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/org"
)

func Login(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var loginRequest org.OrgLoginRequest
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

		// Look up employer by domain - must be verified
		employer, err := s.Global.GetEmployerByDomain(ctx, string(loginRequest.Domain))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("domain not found or not verified", "domain", loginRequest.Domain)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get employer by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Hash email to query global database
		emailHash := sha256.Sum256([]byte(loginRequest.Email))

		// Query global database for user by email hash + employer (composite lookup)
		globalUser, err := s.Global.GetOrgUserByEmailHashAndEmployer(ctx, globaldb.GetOrgUserByEmailHashAndEmployerParams{
			EmailAddressHash: emailHash[:],
			EmployerID:       employer.EmployerID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid credentials - user not found for this employer")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to query global DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if globalUser.Status != globaldb.OrgUserStatusActive {
			log.Debug("disabled user")
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Get the regional database for this user
		regionalDB := s.GetRegionalDB(globalUser.HomeRegion)
		if regionalDB == nil {
			log.Error("unknown region", "region", globalUser.HomeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Query regional database for password hash (composite lookup)
		regionalUser, err := regionalDB.GetOrgUserByEmailAndEmployer(ctx, regionaldb.GetOrgUserByEmailAndEmployerParams{
			EmailAddress: string(loginRequest.Email),
			EmployerID:   employer.EmployerID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid credentials - user not found in regional DB")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.Error("failed to query regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify password
		if err := bcrypt.CompareHashAndPassword(regionalUser.PasswordHash, []byte(loginRequest.Password)); err != nil {
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
		rawTFAToken := hex.EncodeToString(tfaTokenBytes)

		// Add region prefix to TFA token
		tfaToken := tokens.AddRegionPrefix(globalUser.HomeRegion, rawTFAToken)

		// Generate 6-digit TFA code
		tfaCode, err := generateTFACode()
		if err != nil {
			log.Error("failed to generate TFA code", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Store TFA token in regional database
		// Use org-specific token expiry (default 10 minutes like hub)
		tfaTokenExpiry := 10 * time.Minute
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(tfaTokenExpiry), Valid: true}
		err = regionalDB.CreateOrgTFAToken(ctx, regionaldb.CreateOrgTFATokenParams{
			TfaToken:  rawTFAToken,
			OrgUserID: regionalUser.OrgUserID,
			TfaCode:   tfaCode,
			ExpiresAt: expiresAt,
		})
		if err != nil {
			log.Error("failed to store TFA token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Enqueue TFA email in regional database
		lang := i18n.Match(globalUser.PreferredLanguage)
		err = sendOrgTFAEmail(ctx, regionalDB, regionalUser.EmailAddress, tfaCode, lang, tfaTokenExpiry)
		if err != nil {
			log.Error("failed to enqueue TFA email", "error", err)
			// Compensating transaction: delete the TFA token we just created
			if delErr := regionalDB.DeleteOrgTFAToken(ctx, rawTFAToken); delErr != nil {
				log.Error("failed to delete TFA token after email enqueue failure", "error", delErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("org user login initiated, TFA email sent", "org_user_id", globalUser.OrgUserID)

		response := org.OrgLoginResponse{
			TFAToken: org.OrgTFAToken(tfaToken),
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

func sendOrgTFAEmail(ctx context.Context, db *regionaldb.Queries, to string, tfaCode string, lang string, tfaTokenExpiry time.Duration) error {
	data := templates.OrgTFAData{
		Code:    tfaCode,
		Minutes: int(tfaTokenExpiry.Minutes()),
	}

	_, err := db.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
		EmailType:     regionaldb.EmailTemplateTypeOrgTfa,
		EmailTo:       to,
		EmailSubject:  templates.OrgTFASubject(lang),
		EmailTextBody: templates.OrgTFATextBody(lang, data),
		EmailHtmlBody: templates.OrgTFAHTMLBody(lang, data),
	})
	return err
}
