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
	"vetchium-api-server.typespec/common"
	"vetchium-api-server.typespec/org"
)

const (
	dnsRecordPrefix = "_vetchium-verify."
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

		// Extract domain from email
		parts := strings.Split(string(req.Email), "@")
		if len(parts) != 2 {
			log.Debug("invalid email format")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		domain := strings.ToLower(parts[1])

		// Hash email
		emailHash := sha256.Sum256([]byte(req.Email))

		// Check if email already registered as org user
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

		// Check if domain is already claimed by an existing employer
		_, err = s.Global.GetGlobalEmployerDomain(ctx, domain)
		if err == nil {
			log.Debug("domain already claimed by existing employer", "domain", domain)
			w.WriteHeader(http.StatusConflict)
			return
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to query global employer domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if domain has a pending (non-expired, non-consumed) signup
		_, err = s.Global.GetPendingSignupByDomain(ctx, domain)
		if err == nil {
			log.Debug("domain has pending signup", "domain", domain)
			w.WriteHeader(http.StatusConflict)
			return
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to query pending signup by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate verification token (will be used as DNS TXT value)
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			log.Error("failed to generate token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		verificationToken := hex.EncodeToString(tokenBytes)

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
		tokenExpiry := s.TokenConfig.HubSignupTokenExpiry
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(tokenExpiry), Valid: true}
		err = s.Global.CreateOrgSignupToken(ctx, globaldb.CreateOrgSignupTokenParams{
			SignupToken:      verificationToken,
			EmailAddress:     string(req.Email),
			EmailAddressHash: emailHash[:],
			HashingAlgorithm: globaldb.EmailAddressHashingAlgorithmSHA256,
			ExpiresAt:        expiresAt,
			HomeRegion:       homeRegion,
			Domain:           domain,
		})
		if err != nil {
			log.Error("failed to store signup token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Prepare DNS record info
		dnsRecordName := dnsRecordPrefix + domain
		expiryHours := int(tokenExpiry.Hours())

		// Send verification email with DNS instructions
		lang := i18n.Match("en-US") // Default language for signup
		err = sendOrgSignupEmail(ctx, regionalDB, string(req.Email), domain, dnsRecordName, verificationToken, lang, expiryHours)
		if err != nil {
			log.Error("failed to enqueue signup email", "error", err)
			// Compensating transaction: delete the signup token we just created
			if delErr := s.Global.DeleteOrgSignupToken(ctx, verificationToken); delErr != nil {
				log.Error("failed to cleanup signup token", "error", delErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("org signup DNS verification email sent", "email_hash", hex.EncodeToString(emailHash[:]), "domain", domain)

		// Calculate expiry timestamp
		tokenExpiresAt := time.Now().Add(tokenExpiry).Format(time.RFC3339)

		response := org.OrgInitSignupResponse{
			Domain:         common.DomainName(domain),
			DNSRecordName:  dnsRecordName,
			DNSRecordValue: org.DNSVerificationToken(verificationToken),
			TokenExpiresAt: tokenExpiresAt,
			Message:        fmt.Sprintf("Please add a TXT record to your DNS settings. The verification token expires in %d hours.", expiryHours),
		}

		json.NewEncoder(w).Encode(response)
	}
}

func sendOrgSignupEmail(ctx context.Context, db *regionaldb.Queries, to string, domain string, dnsRecordName string, dnsRecordValue string, lang string, expiryHours int) error {
	data := templates.OrgSignupData{
		Domain:         domain,
		DNSRecordName:  dnsRecordName,
		DNSRecordValue: dnsRecordValue,
		Hours:          expiryHours,
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
