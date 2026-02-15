package org

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/orgdomains"
)

func GetDomainStatus(s *server.Server) http.HandlerFunc {
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

		var req orgdomains.GetDomainStatusRequest
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

		// Build response
		response := orgdomains.GetDomainStatusResponse{
			Domain: domain,
			Status: orgdomains.DomainVerificationStatus(domainRecord.Status),
		}

		// Include verification token for PENDING or FAILING status
		if domainRecord.Status == regionaldb.DomainVerificationStatusPENDING ||
			domainRecord.Status == regionaldb.DomainVerificationStatusFAILING {
			token := orgdomains.DomainVerificationToken(domainRecord.VerificationToken)
			response.VerificationToken = &token
		}

		// Include expiry for PENDING status
		if domainRecord.Status == regionaldb.DomainVerificationStatusPENDING {
			if domainRecord.TokenExpiresAt.Valid {
				response.ExpiresAt = &domainRecord.TokenExpiresAt.Time
			}
		}

		// Include last verified time for VERIFIED status
		if domainRecord.Status == regionaldb.DomainVerificationStatusVERIFIED {
			if domainRecord.LastVerifiedAt.Valid {
				response.LastVerifiedAt = &domainRecord.LastVerifiedAt.Time
			}
		}

		json.NewEncoder(w).Encode(response)
	}
}
