package employer

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
	employerdomains "vetchium-api-server.typespec/employer-domains"
)

func GetDomainStatus(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			log.Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req employerdomains.GetDomainStatusRequest
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

		domain := strings.ToLower(string(req.Domain))

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

		// Use the more recent of last_verification_requested_at and last_verified_at
		// so that domains verified at signup (last_verified_at set, last_verification_requested_at NULL)
		// also respect the cooldown.
		cooldown := time.Duration(employerdomains.VerificationCooldownMinutes) * time.Minute
		lastActivity := domainRecord.LastVerificationRequestedAt
		if domainRecord.LastVerifiedAt.Valid && (!lastActivity.Valid || domainRecord.LastVerifiedAt.Time.After(lastActivity.Time)) {
			lastActivity = domainRecord.LastVerifiedAt
		}
		canRequest := !lastActivity.Valid || time.Since(lastActivity.Time) >= cooldown

		response := employerdomains.GetDomainStatusResponse{
			Domain:                 domain,
			Status:                 employerdomains.DomainVerificationStatus(domainRecord.Status),
			CanRequestVerification: canRequest,
		}

		// Expose when verification was last requested (for UX: "last tried X ago")
		if domainRecord.LastVerificationRequestedAt.Valid {
			t := domainRecord.LastVerificationRequestedAt.Time
			response.LastAttemptedAt = &t
		}

		// When rate-limited, tell the client exactly when they can retry
		if !canRequest {
			nextAllowed := lastActivity.Time.Add(cooldown)
			response.NextVerificationAllowedAt = &nextAllowed
		}

		if domainRecord.Status == regionaldb.DomainVerificationStatusPENDING ||
			domainRecord.Status == regionaldb.DomainVerificationStatusFAILING {
			token := employerdomains.DomainVerificationToken(domainRecord.VerificationToken)
			response.VerificationToken = &token
		}

		if domainRecord.Status == regionaldb.DomainVerificationStatusPENDING {
			if domainRecord.TokenExpiresAt.Valid {
				response.ExpiresAt = &domainRecord.TokenExpiresAt.Time
			}
		}

		if domainRecord.Status == regionaldb.DomainVerificationStatusVERIFIED {
			if domainRecord.LastVerifiedAt.Valid {
				response.LastVerifiedAt = &domainRecord.LastVerifiedAt.Time
			}
		}

		json.NewEncoder(w).Encode(response)
	}
}
