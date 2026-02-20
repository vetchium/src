package agency

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	agencydomains "vetchium-api-server.typespec/agency-domains"
)

func GetDomainStatus(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		agencyUser := middleware.AgencyUserFromContext(ctx)
		if agencyUser == nil {
			log.Debug("agency user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req agencydomains.AgencyGetDomainStatusRequest
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

		// Get domain record from regional DB, ensuring it belongs to this agency
		domainRecord, err := s.Regional.GetAgencyDomainByAgencyAndDomain(ctx, regionaldb.GetAgencyDomainByAgencyAndDomainParams{
			Domain:   domain,
			AgencyID: agencyUser.AgencyID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("domain not found or not owned by agency", "domain", domain)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get domain record", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Build response
		response := agencydomains.AgencyGetDomainStatusResponse{
			Domain: domain,
			Status: agencydomains.AgencyDomainVerificationStatus(domainRecord.Status),
		}

		// Include verification token for PENDING or FAILING status
		if domainRecord.Status == regionaldb.DomainVerificationStatusPENDING ||
			domainRecord.Status == regionaldb.DomainVerificationStatusFAILING {
			token := agencydomains.AgencyDomainVerificationToken(domainRecord.VerificationToken)
			response.VerificationToken = &token
		}

		// Include expiry for PENDING or FAILING status
		if domainRecord.TokenExpiresAt.Valid {
			response.ExpiresAt = &domainRecord.TokenExpiresAt.Time
		}

		// Include last verified time for VERIFIED status
		if domainRecord.Status == regionaldb.DomainVerificationStatusVERIFIED {
			if domainRecord.LastVerifiedAt.Valid {
				response.LastVerifiedAt = &domainRecord.LastVerifiedAt.Time
			}
		}

		// Compute can_request_verification using the more recent of
		// last_verification_requested_at and last_verified_at as the cooldown baseline.
		cooldown := time.Duration(agencydomains.AgencyVerificationCooldownMinutes) * time.Minute
		lastActivity := domainRecord.LastVerificationRequestedAt
		if domainRecord.LastVerifiedAt.Valid && (!lastActivity.Valid || domainRecord.LastVerifiedAt.Time.After(lastActivity.Time)) {
			lastActivity = domainRecord.LastVerifiedAt
		}
		canRequest := !lastActivity.Valid || time.Since(lastActivity.Time) >= cooldown
		response.CanRequestVerification = canRequest

		if domainRecord.LastVerificationRequestedAt.Valid {
			t := domainRecord.LastVerificationRequestedAt.Time
			response.LastAttemptedAt = &t
		}

		if !canRequest {
			nextAllowed := lastActivity.Time.Add(cooldown)
			response.NextVerificationAllowedAt = &nextAllowed
		}

		json.NewEncoder(w).Encode(response)
	}
}
