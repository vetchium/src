package employer

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	employerdomains "vetchium-api-server.typespec/employer-domains"
)

// TODO: Consider adding domain_verification_events audit log (see specs/Ideas.md)

func VerifyDomain(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		// Get authenticated org user from context
		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			log.Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req employerdomains.VerifyDomainRequest
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

		// Normalize domain to lowercase
		domain := strings.ToLower(string(req.Domain))

		// Get domain record from regional DB, ensuring it belongs to this employer
		domainRecord, err := s.Regional.GetEmployerDomainByEmployerAndDomain(ctx, regionaldb.GetEmployerDomainByEmployerAndDomainParams{
			Domain:     domain,
			EmployerID: orgUser.EmployerID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("domain not found or not owned by employer", "domain", domain)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get domain record", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Rate limit: check cooldown period between verification requests
		cooldown := time.Duration(employerdomains.VerificationCooldownMinutes) * time.Minute
		if domainRecord.LastVerificationRequestedAt.Valid &&
			time.Since(domainRecord.LastVerificationRequestedAt.Time) < cooldown {
			log.Debug("verification rate limited", "domain", domain)
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}

		// If token has expired, regenerate it before performing the DNS check
		if domainRecord.TokenExpiresAt.Valid && domainRecord.TokenExpiresAt.Time.Before(time.Now()) {
			log.Debug("verification token expired, regenerating", "domain", domain)
			tokenBytes := make([]byte, 32)
			if _, err := rand.Read(tokenBytes); err != nil {
				log.Error("failed to generate verification token", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			newToken := hex.EncodeToString(tokenBytes)
			newExpiresAt := time.Now().AddDate(0, 0, employerdomains.TokenExpiryDays)

			err = s.Regional.UpdateEmployerDomainTokenAndVerificationRequested(ctx, regionaldb.UpdateEmployerDomainTokenAndVerificationRequestedParams{
				Domain:            domain,
				VerificationToken: newToken,
				TokenExpiresAt:    pgtype.Timestamp{Time: newExpiresAt, Valid: true},
			})
			if err != nil {
				log.Error("failed to regenerate verification token", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			// Reload domain record with fresh token
			domainRecord, err = s.Regional.GetEmployerDomainByEmployerAndDomain(ctx, regionaldb.GetEmployerDomainByEmployerAndDomainParams{
				Domain:     domain,
				EmployerID: orgUser.EmployerID,
			})
			if err != nil {
				log.Error("failed to reload domain record after token regeneration", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
		} else {
			// Mark that a verification has been requested (rate limit tracking)
			if err := s.Regional.UpdateEmployerDomainVerificationRequested(ctx, domain); err != nil {
				log.Error("failed to update verification requested timestamp", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
		}

		// Perform DNS lookup
		dnsName := fmt.Sprintf("_vetchium-verify.%s", domain)
		txtRecords, err := net.LookupTXT(dnsName)
		if err != nil {
			log.Debug("DNS lookup failed", "domain", domain, "error", err)
			// DNS lookup failed - increment failure count
			err = handleVerificationFailure(ctx, s.Regional, domain, domainRecord)
			if err != nil {
				log.Error("failed to handle verification failure", "error", err)
			}

			message := "DNS lookup failed. Please ensure the TXT record is properly configured."
			response := employerdomains.VerifyDomainResponse{
				Status:  employerdomains.DomainVerificationStatus(domainRecord.Status),
				Message: &message,
			}
			json.NewEncoder(w).Encode(response)
			return
		}

		// Check if verification token is in any of the TXT records
		expectedToken := domainRecord.VerificationToken
		tokenFound := false
		for _, record := range txtRecords {
			if strings.TrimSpace(record) == expectedToken {
				tokenFound = true
				break
			}
		}

		if !tokenFound {
			log.Debug("verification token not found in DNS", "domain", domain)
			// Token not found - increment failure count
			err = handleVerificationFailure(ctx, s.Regional, domain, domainRecord)
			if err != nil {
				log.Error("failed to handle verification failure", "error", err)
			}

			message := "Verification token not found in DNS TXT records. Please ensure the TXT record is correctly configured."
			response := employerdomains.VerifyDomainResponse{
				Status:  employerdomains.DomainVerificationStatus(domainRecord.Status),
				Message: &message,
			}
			json.NewEncoder(w).Encode(response)
			return
		}

		// Verification successful!
		now := time.Now()
		err = s.Regional.UpdateEmployerDomainStatus(ctx, regionaldb.UpdateEmployerDomainStatusParams{
			Domain:              domain,
			Status:              regionaldb.DomainVerificationStatusVERIFIED,
			LastVerifiedAt:      pgtype.Timestamp{Time: now, Valid: true},
			ConsecutiveFailures: 0,
		})
		if err != nil {
			log.Error("failed to update regional domain status", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("domain verified successfully", "domain", domain, "employer_id", orgUser.EmployerID)

		message := "Domain verified successfully!"
		response := employerdomains.VerifyDomainResponse{
			Status:     employerdomains.DomainVerificationStatusVerified,
			VerifiedAt: &now,
			Message:    &message,
		}
		json.NewEncoder(w).Encode(response)
	}
}

func handleVerificationFailure(ctx context.Context, regionalDB *regionaldb.Queries, domain string, domainRecord regionaldb.EmployerDomain) error {
	newFailures := domainRecord.ConsecutiveFailures + 1

	// Check if we should transition to FAILING status
	var newStatus regionaldb.DomainVerificationStatus
	if newFailures >= employerdomains.MaxConsecutiveFailures && domainRecord.Status == regionaldb.DomainVerificationStatusVERIFIED {
		newStatus = regionaldb.DomainVerificationStatusFAILING
	} else {
		newStatus = domainRecord.Status
	}

	// Update regional DB
	err := regionalDB.UpdateEmployerDomainStatus(ctx, regionaldb.UpdateEmployerDomainStatusParams{
		Domain:              domain,
		Status:              newStatus,
		LastVerifiedAt:      domainRecord.LastVerifiedAt, // Keep existing
		ConsecutiveFailures: newFailures,
	})
	if err != nil {
		return err
	}

	return nil
}
