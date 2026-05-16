package org

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
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/orgtiers"
	"vetchium-api-server.gomodule/internal/server"
	orgdomains "vetchium-api-server.typespec/org-domains"
)

func VerifyDomain(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		// Get authenticated org user from context
		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgdomains.VerifyDomainRequest
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

		// Normalize domain to lowercase
		domain := strings.ToLower(string(req.Domain))

		// Get domain record from regional DB, ensuring it belongs to this org
		domainRecord, err := s.RegionalForCtx(ctx).GetOrgDomainByOrgAndDomain(ctx, regionaldb.GetOrgDomainByOrgAndDomainParams{
			Domain: domain,
			OrgID:  orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("domain not found or not owned by org", "domain", domain)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get domain record", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Rate limit: check cooldown period between verification requests
		cooldown := time.Duration(orgdomains.VerificationCooldownMinutes) * time.Minute
		if domainRecord.LastVerificationRequestedAt.Valid &&
			time.Since(domainRecord.LastVerificationRequestedAt.Time) < cooldown {
			s.Logger(ctx).Debug("verification rate limited", "domain", domain)
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}

		// If token has expired, regenerate it before performing the DNS check
		if domainRecord.TokenExpiresAt.Valid && domainRecord.TokenExpiresAt.Time.Before(time.Now()) {
			s.Logger(ctx).Debug("verification token expired, regenerating", "domain", domain)
			tokenBytes := make([]byte, 32)
			if _, err := rand.Read(tokenBytes); err != nil {
				s.Logger(ctx).Error("failed to generate verification token", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			newToken := hex.EncodeToString(tokenBytes)
			newExpiresAt := time.Now().AddDate(0, 0, orgdomains.TokenExpiryDays)

			err = s.RegionalForCtx(ctx).UpdateOrgDomainTokenAndVerificationRequested(ctx, regionaldb.UpdateOrgDomainTokenAndVerificationRequestedParams{
				Domain:            domain,
				VerificationToken: newToken,
				TokenExpiresAt:    pgtype.Timestamptz{Time: newExpiresAt, Valid: true},
			})
			if err != nil {
				s.Logger(ctx).Error("failed to regenerate verification token", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			// Reload domain record with fresh token
			domainRecord, err = s.RegionalForCtx(ctx).GetOrgDomainByOrgAndDomain(ctx, regionaldb.GetOrgDomainByOrgAndDomainParams{
				Domain: domain,
				OrgID:  orgUser.OrgID,
			})
			if err != nil {
				s.Logger(ctx).Error("failed to reload domain record after token regeneration", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
		} else {
			// Mark that a verification has been requested (rate limit tracking)
			if err := s.RegionalForCtx(ctx).UpdateOrgDomainVerificationRequested(ctx, domain); err != nil {
				s.Logger(ctx).Error("failed to update verification requested timestamp", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
		}

		// Perform DNS lookup
		dnsName := fmt.Sprintf("_vetchium-verify.%s", domain)
		txtRecords, err := net.LookupTXT(dnsName)
		if err != nil {
			s.Logger(ctx).Debug("DNS lookup failed", "domain", domain, "error", err)
			// DNS lookup failed - increment failure count
			err = handleVerificationFailure(ctx, s.RegionalForCtx(ctx), domain, domainRecord)
			if err != nil {
				s.Logger(ctx).Error("failed to handle verification failure", "error", err)
			}

			message := "DNS lookup failed. Please ensure the TXT record is properly configured."
			response := orgdomains.VerifyDomainResponse{
				Status:  orgdomains.DomainVerificationStatus(domainRecord.Status),
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
			s.Logger(ctx).Debug("verification token not found in DNS", "domain", domain)
			// Token not found - increment failure count
			err = handleVerificationFailure(ctx, s.RegionalForCtx(ctx), domain, domainRecord)
			if err != nil {
				s.Logger(ctx).Error("failed to handle verification failure", "error", err)
			}

			message := "Verification token not found in DNS TXT records. Please ensure the TXT record is correctly configured."
			response := orgdomains.VerifyDomainResponse{
				Status:  orgdomains.DomainVerificationStatus(domainRecord.Status),
				Message: &message,
			}
			json.NewEncoder(w).Encode(response)
			return
		}

		// Quota check: only enforce for PENDING→VERIFIED transitions.
		// A FAILING domain recovering to VERIFIED was already counted in the quota when
		// it was first verified, so re-checking would incorrectly block recovery.
		if domainRecord.Status == regionaldb.DomainVerificationStatusPENDING {
			quotaPayload, quotaErr := orgtiers.EnforceQuota(ctx, orgtiers.QuotaDomainsVerified, orgUser.OrgID, s.Global, s.RegionalForCtx(ctx))
			if quotaErr != nil {
				if errors.Is(quotaErr, orgtiers.ErrQuotaExceeded) {
					orgtiers.WriteQuotaError(w, quotaPayload)
					return
				}
				s.Logger(ctx).Error("failed to check domains_verified quota", "error", quotaErr)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
		}

		// Verification successful!
		now := time.Now()
		eventData, _ := json.Marshal(map[string]any{"domain": domain})
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.UpdateOrgDomainStatus(ctx, regionaldb.UpdateOrgDomainStatusParams{
				Domain:              domain,
				Status:              regionaldb.DomainVerificationStatusVERIFIED,
				LastVerifiedAt:      pgtype.Timestamptz{Time: now, Valid: true},
				ConsecutiveFailures: 0,
				FailingSince:        pgtype.Timestamptz{Valid: false}, // clear on recovery
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.verify_domain",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to update regional domain status", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("domain verified successfully", "domain", domain, "org_id", orgUser.OrgID)

		message := "Domain verified successfully!"
		response := orgdomains.VerifyDomainResponse{
			Status:     orgdomains.DomainVerificationStatusVerified,
			VerifiedAt: &now,
			Message:    &message,
		}
		json.NewEncoder(w).Encode(response)
	}
}

func handleVerificationFailure(ctx context.Context, regionalDB *regionaldb.Queries, domain string, domainRecord regionaldb.OrgDomain) error {
	newFailures := domainRecord.ConsecutiveFailures + 1

	var newStatus regionaldb.DomainVerificationStatus
	var failingSince pgtype.Timestamptz

	if newFailures >= orgdomains.FailureThreshold && domainRecord.Status == regionaldb.DomainVerificationStatusVERIFIED {
		newStatus = regionaldb.DomainVerificationStatusFAILING
		// Record when the failure streak began; don't overwrite if already set.
		if domainRecord.FailingSince.Valid {
			failingSince = domainRecord.FailingSince
		} else {
			failingSince = pgtype.Timestamptz{Time: time.Now(), Valid: true}
		}
	} else {
		newStatus = domainRecord.Status
		failingSince = domainRecord.FailingSince // preserve existing value
	}

	return regionalDB.UpdateOrgDomainStatus(ctx, regionaldb.UpdateOrgDomainStatusParams{
		Domain:              domain,
		Status:              newStatus,
		LastVerifiedAt:      domainRecord.LastVerifiedAt,
		ConsecutiveFailures: newFailures,
		FailingSince:        failingSince,
	})
}
