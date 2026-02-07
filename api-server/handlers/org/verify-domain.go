package org

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/orgdomains"
)

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

		var req orgdomains.VerifyDomainRequest
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

		// Get region from context
		region := middleware.OrgRegionFromContext(ctx)
		if region == "" {
			log.Error("region not found in context")
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get regional DB
		regionalDB := s.GetRegionalDB(globaldb.Region(region))
		if regionalDB == nil {
			log.Error("regional database not available", "region", region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get domain record from regional DB, ensuring it belongs to this employer
		domainRecord, err := regionalDB.GetEmployerDomainByEmployerAndDomain(ctx, regionaldb.GetEmployerDomainByEmployerAndDomainParams{
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

		// Perform DNS lookup
		dnsName := fmt.Sprintf("_vetchium-verify.%s", domain)
		txtRecords, err := net.LookupTXT(dnsName)
		if err != nil {
			log.Debug("DNS lookup failed", "domain", domain, "error", err)
			// DNS lookup failed - increment failure count
			err = handleVerificationFailure(ctx, regionalDB, domain, domainRecord)
			if err != nil {
				log.Error("failed to handle verification failure", "error", err)
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
			log.Debug("verification token not found in DNS", "domain", domain)
			// Token not found - increment failure count
			err = handleVerificationFailure(ctx, regionalDB, domain, domainRecord)
			if err != nil {
				log.Error("failed to handle verification failure", "error", err)
			}

			message := "Verification token not found in DNS TXT records. Please ensure the TXT record is correctly configured."
			response := orgdomains.VerifyDomainResponse{
				Status:  orgdomains.DomainVerificationStatus(domainRecord.Status),
				Message: &message,
			}
			json.NewEncoder(w).Encode(response)
			return
		}

		// Verification successful!
		now := time.Now()
		err = regionalDB.UpdateEmployerDomainStatus(ctx, regionaldb.UpdateEmployerDomainStatusParams{
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
		response := orgdomains.VerifyDomainResponse{
			Status:     orgdomains.DomainVerificationStatusVerified,
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
	if newFailures >= orgdomains.MaxConsecutiveFailures && domainRecord.Status == regionaldb.DomainVerificationStatusVERIFIED {
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
