package agency

import (
	"encoding/json"
	"net/http"
	"time"

	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	agencydomains "vetchium-api-server.typespec/agency-domains"
)

const agencyDomainPageSize = 20

func ListDomains(s *server.Server) http.HandlerFunc {
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

		var req agencydomains.AgencyListDomainStatusRequest
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

		domains, err := s.Regional.GetAgencyDomainsByAgency(ctx, agencyUser.AgencyID)
		if err != nil {
			log.Error("failed to get agency domains", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Apply cursor filtering
		startIdx := 0
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			for i, d := range domains {
				if d.Domain == *req.PaginationKey {
					startIdx = i + 1
					break
				}
			}
		}

		cooldown := time.Duration(agencydomains.AgencyVerificationCooldownMinutes) * time.Minute

		items := make([]agencydomains.AgencyListDomainStatusItem, 0, agencyDomainPageSize)
		for i := startIdx; i < len(domains) && len(items) < agencyDomainPageSize; i++ {
			d := domains[i]
			item := agencydomains.AgencyListDomainStatusItem{
				Domain: d.Domain,
				Status: agencydomains.AgencyDomainVerificationStatus(d.Status),
			}

			if d.Status == regionaldb.DomainVerificationStatusPENDING ||
				d.Status == regionaldb.DomainVerificationStatusFAILING {
				token := agencydomains.AgencyDomainVerificationToken(d.VerificationToken)
				item.VerificationToken = &token
				if d.TokenExpiresAt.Valid {
					item.ExpiresAt = &d.TokenExpiresAt.Time
				}
			}

			if d.Status == regionaldb.DomainVerificationStatusVERIFIED {
				if d.LastVerifiedAt.Valid {
					item.LastVerifiedAt = &d.LastVerifiedAt.Time
				}
			}

			// Compute can_request_verification using the more recent of
			// last_verification_requested_at and last_verified_at as the cooldown baseline.
			// This ensures signup-verified domains don't show the button immediately.
			lastActivity := d.LastVerificationRequestedAt
			if d.LastVerifiedAt.Valid && (!lastActivity.Valid || d.LastVerifiedAt.Time.After(lastActivity.Time)) {
				lastActivity = d.LastVerifiedAt
			}
			canRequest := !lastActivity.Valid || time.Since(lastActivity.Time) >= cooldown
			item.CanRequestVerification = canRequest

			if d.LastVerificationRequestedAt.Valid {
				t := d.LastVerificationRequestedAt.Time
				item.LastAttemptedAt = &t
			}

			if !canRequest {
				nextAllowed := lastActivity.Time.Add(cooldown)
				item.NextVerificationAllowedAt = &nextAllowed
			}

			items = append(items, item)
		}

		var nextKey *string
		if startIdx+agencyDomainPageSize < len(domains) {
			key := items[len(items)-1].Domain
			nextKey = &key
		}

		response := agencydomains.AgencyListDomainStatusResponse{
			Items:             items,
			NextPaginationKey: nextKey,
		}

		json.NewEncoder(w).Encode(response)
	}
}
