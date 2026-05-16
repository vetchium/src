package org

import (
	"encoding/json"
	"net/http"
	"time"

	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgdomains "vetchium-api-server.typespec/org-domains"
)

const domainPageSize = 20

func ListDomains(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgdomains.ListDomainStatusRequest
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

		// One regional round-trip: all domains for this org.
		domains, err := s.RegionalForCtx(ctx).GetOrgDomainsByOrg(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get org domains", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// One global round-trip: is_primary flags for all domains.
		globalDomains, err := s.Global.GetGlobalOrgDomainsByOrg(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get global org domains", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		primarySet := make(map[string]bool, len(globalDomains))
		for _, gd := range globalDomains {
			if gd.IsPrimary {
				primarySet[gd.Domain] = true
			}
		}

		// Apply cursor filtering.
		startIdx := 0
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			for i, d := range domains {
				if d.Domain == *req.PaginationKey {
					startIdx = i + 1
					break
				}
			}
		}

		cooldown := time.Duration(orgdomains.ManualVerificationCooldown) * time.Minute
		items := make([]orgdomains.ListDomainStatusItem, 0, domainPageSize)
		for i := startIdx; i < len(domains) && len(items) < domainPageSize; i++ {
			d := domains[i]

			lastActivity := d.LastVerificationRequestedAt
			if d.LastVerifiedAt.Valid && (!lastActivity.Valid || d.LastVerifiedAt.Time.After(lastActivity.Time)) {
				lastActivity = d.LastVerifiedAt
			}
			canRequest := !lastActivity.Valid || time.Since(lastActivity.Time) >= cooldown

			item := orgdomains.ListDomainStatusItem{
				Domain:                 d.Domain,
				Status:                 orgdomains.DomainVerificationStatus(d.Status),
				IsPrimary:              primarySet[d.Domain],
				CanRequestVerification: canRequest,
			}

			if d.LastVerificationRequestedAt.Valid {
				t := d.LastVerificationRequestedAt.Time
				item.LastAttemptedAt = &t
			}

			if !canRequest {
				nextAllowed := lastActivity.Time.Add(cooldown)
				item.NextVerificationAllowedAt = &nextAllowed
			}

			if d.Status == regionaldb.DomainVerificationStatusPENDING ||
				d.Status == regionaldb.DomainVerificationStatusFAILING {
				token := orgdomains.DomainVerificationToken(d.VerificationToken)
				item.VerificationToken = &token
				if d.TokenExpiresAt.Valid {
					item.ExpiresAt = &d.TokenExpiresAt.Time
				}
			}

			if d.Status == regionaldb.DomainVerificationStatusFAILING && d.FailingSince.Valid {
				t := d.FailingSince.Time
				item.FailingSince = &t
			}

			if d.Status == regionaldb.DomainVerificationStatusVERIFIED {
				if d.LastVerifiedAt.Valid {
					item.LastVerifiedAt = &d.LastVerifiedAt.Time
				}
			}

			items = append(items, item)
		}

		var nextKey *string
		if startIdx+domainPageSize < len(domains) {
			key := items[len(items)-1].Domain
			nextKey = &key
		}

		response := orgdomains.ListDomainStatusResponse{
			DomainStatuses:    items,
			NextPaginationKey: nextKey,
		}

		json.NewEncoder(w).Encode(response)
	}
}
