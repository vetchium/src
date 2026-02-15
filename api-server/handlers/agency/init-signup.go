package agency

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
	"vetchium-api-server.gomodule/internal/proxy"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/agency"
	"vetchium-api-server.typespec/common"
)

const (
	dnsRecordPrefix = "_vetchium-verify."
)

func InitSignup(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		log := s.Logger(ctx)

		var req agency.AgencyInitSignupRequest
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

		// Check if email already registered as agency user
		_, err = s.Global.GetAgencyUserByEmailHash(ctx, emailHash[:])
		if err == nil {
			log.Debug("email already registered")
			w.WriteHeader(http.StatusConflict)
			return
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to query user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if domain is already claimed by an existing agency
		_, err = s.Global.GetGlobalAgencyDomain(ctx, domain)
		if err == nil {
			log.Debug("domain already claimed by existing agency", "domain", domain)
			w.WriteHeader(http.StatusBadRequest)
			return
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to query global agency domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if domain has a pending (non-expired, non-consumed) signup
		_, err = s.Global.GetPendingAgencySignupByDomain(ctx, domain)
		if err == nil {
			log.Debug("domain has pending signup", "domain", domain)
			w.WriteHeader(http.StatusConflict)
			return
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to query pending signup by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Generate two tokens:
		// 1. DNS verification token (goes in TXT record, public)
		// 2. Email token (secret, sent only via email to prove email access)
		dnsTokenBytes := make([]byte, 32)
		if _, err := rand.Read(dnsTokenBytes); err != nil {
			log.Error("failed to generate DNS verification token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		dnsVerificationToken := hex.EncodeToString(dnsTokenBytes)

		emailTokenBytes := make([]byte, 32)
		if _, err := rand.Read(emailTokenBytes); err != nil {
			log.Error("failed to generate email token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		emailToken := hex.EncodeToString(emailTokenBytes)

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

		// Proxy to correct region if needed
		if homeRegion != s.CurrentRegion {
			s.ProxyToRegion(w, r, homeRegion, bodyBytes)
			return
		}

		// Store tokens in global DB
		tokenExpiry := s.TokenConfig.HubSignupTokenExpiry
		expiresAt := pgtype.Timestamp{Time: time.Now().Add(tokenExpiry), Valid: true}
		err = s.Global.CreateAgencySignupToken(ctx, globaldb.CreateAgencySignupTokenParams{
			SignupToken:      dnsVerificationToken,
			EmailToken:       emailToken,
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

		// Default language for signup
		lang := i18n.Match("en-US")

		// Send Email 1: DNS instructions (safe to forward)
		err = sendAgencySignupDNSEmail(ctx, s.Regional, string(req.Email), domain, dnsRecordName, dnsVerificationToken, lang, expiryHours)
		if err != nil {
			log.Error("failed to enqueue DNS instructions email", "error", err)
			// Compensating transaction: delete the signup token we just created
			if delErr := s.Global.DeleteAgencySignupToken(ctx, dnsVerificationToken); delErr != nil {
				log.Error("failed to cleanup signup token", "error", delErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Send Email 2: Signup token (private - DO NOT FORWARD)
		signupLink := fmt.Sprintf("%s/complete-signup?token=%s", s.UIConfig.AgencyURL, emailToken)
		err = sendAgencySignupTokenEmail(ctx, s.Regional, string(req.Email), domain, emailToken, signupLink, lang, expiryHours)
		if err != nil {
			log.Error("failed to enqueue signup token email", "error", err)
			// Compensating transaction: delete the signup token we just created
			if delErr := s.Global.DeleteAgencySignupToken(ctx, dnsVerificationToken); delErr != nil {
				log.Error("failed to cleanup signup token", "error", delErr)
			}
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("agency signup emails sent (DNS + token)", "email_hash", hex.EncodeToString(emailHash[:]), "domain", domain)

		// Calculate expiry timestamp
		tokenExpiresAt := time.Now().Add(tokenExpiry).Format(time.RFC3339)

		// Note: dns_record_value is NOT returned - it's only sent via email
		// This prevents attackers from seeing the DNS token in the API response
		response := agency.AgencyInitSignupResponse{
			Domain:         common.DomainName(domain),
			DNSRecordName:  dnsRecordName,
			TokenExpiresAt: tokenExpiresAt,
			Message:        fmt.Sprintf("Please check your email for DNS setup instructions and signup link. The verification token expires in %d hours.", expiryHours),
		}

		json.NewEncoder(w).Encode(response)
	}
}

// sendAgencySignupDNSEmail sends the DNS instructions email (safe to forward to IT team)
func sendAgencySignupDNSEmail(ctx context.Context, db *regionaldb.Queries, to string, domain string, dnsRecordName string, dnsRecordValue string, lang string, expiryHours int) error {
	data := templates.AgencySignupData{
		Domain:         domain,
		DNSRecordName:  dnsRecordName,
		DNSRecordValue: dnsRecordValue,
		Hours:          expiryHours,
	}

	_, err := db.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
		EmailType:     regionaldb.EmailTemplateTypeAgencySignupVerification,
		EmailTo:       to,
		EmailSubject:  templates.AgencySignupSubject(lang),
		EmailTextBody: templates.AgencySignupTextBody(lang, data),
		EmailHtmlBody: templates.AgencySignupHTMLBody(lang, data),
	})
	return err
}

// sendAgencySignupTokenEmail sends the secret signup token email (DO NOT FORWARD)
func sendAgencySignupTokenEmail(ctx context.Context, db *regionaldb.Queries, to string, domain string, signupToken string, signupLink string, lang string, expiryHours int) error {
	data := templates.AgencySignupTokenData{
		Domain:      domain,
		SignupToken: signupToken,
		SignupLink:  signupLink,
		Hours:       expiryHours,
	}

	_, err := db.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
		EmailType:     regionaldb.EmailTemplateTypeAgencySignupToken,
		EmailTo:       to,
		EmailSubject:  templates.AgencySignupTokenSubject(lang),
		EmailTextBody: templates.AgencySignupTokenTextBody(lang, data),
		EmailHtmlBody: templates.AgencySignupTokenHTMLBody(lang, data),
	})
	return err
}
