package employer

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	employerdomains "vetchium-api-server.typespec/employer-domains"
)

const domainPageSize = 20

func ListDomains(s *server.Server) http.HandlerFunc {
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

		var req employerdomains.ListDomainStatusRequest
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

		domains, err := s.Regional.GetEmployerDomainsByEmployer(ctx, orgUser.EmployerID)
		if err != nil {
			log.Error("failed to get employer domains", "error", err)
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

		items := make([]employerdomains.ListDomainStatusItem, 0, domainPageSize)
		for i := startIdx; i < len(domains) && len(items) < domainPageSize; i++ {
			d := domains[i]
			item := employerdomains.ListDomainStatusItem{
				Domain: d.Domain,
				Status: employerdomains.DomainVerificationStatus(d.Status),
			}

			if d.Status == regionaldb.DomainVerificationStatusPENDING ||
				d.Status == regionaldb.DomainVerificationStatusFAILING {
				token := employerdomains.DomainVerificationToken(d.VerificationToken)
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

			items = append(items, item)
		}

		var nextKey *string
		if startIdx+domainPageSize < len(domains) {
			key := items[len(items)-1].Domain
			nextKey = &key
		}

		response := employerdomains.ListDomainStatusResponse{
			Items:             items,
			NextPaginationKey: nextKey,
		}

		json.NewEncoder(w).Encode(response)
	}
}
