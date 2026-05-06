package admin

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	admintypes "vetchium-api-server.typespec/admin"
)

const (
	blockedDomainDefaultLimit = 25
	blockedDomainMaxLimit     = 100
)

// ListBlockedPersonalDomains handles POST /admin/list-blocked-personal-domains
func ListBlockedPersonalDomains(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminListBlockedDomainsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		limit := int32(blockedDomainDefaultLimit)
		if req.Limit != nil && *req.Limit > 0 {
			limit = *req.Limit
			if limit > blockedDomainMaxLimit {
				limit = blockedDomainMaxLimit
			}
		}

		params := globaldb.ListBlockedPersonalDomainsParams{
			LimitCount: limit + 1,
		}
		if req.FilterDomainPrefix != nil && *req.FilterDomainPrefix != "" {
			params.FilterPrefix = pgtype.Text{String: *req.FilterDomainPrefix, Valid: true}
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			params.CursorDomain = pgtype.Text{String: *req.PaginationKey, Valid: true}
		}

		rows, err := s.Global.ListBlockedPersonalDomains(ctx, params)
		if err != nil {
			log.Error("failed to list blocked personal domains", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			k := rows[len(rows)-1].Domain
			nextKey = &k
		}

		domains := make([]admintypes.BlockedPersonalDomain, len(rows))
		for i, row := range rows {
			domains[i] = admintypes.BlockedPersonalDomain{
				Domain:    row.Domain,
				CreatedAt: row.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
			}
		}

		json.NewEncoder(w).Encode(admintypes.AdminListBlockedDomainsResponse{
			Domains:           domains,
			NextPaginationKey: nextKey,
		})
	}
}

// AddBlockedPersonalDomain handles POST /admin/add-blocked-personal-domain
func AddBlockedPersonalDomain(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminAddBlockedDomainRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		domain := strings.ToLower(strings.TrimSpace(req.Domain))

		var created globaldb.PersonalDomainBlocklist
		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			var txErr error
			created, txErr = qtx.AddBlockedPersonalDomain(ctx, globaldb.AddBlockedPersonalDomainParams{
				Domain:      domain,
				AdminUserID: adminUser.AdminUserID,
			})
			if txErr != nil {
				return txErr
			}

			auditData, _ := json.Marshal(map[string]any{
				"domain": domain,
			})
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.add_blocked_personal_domain",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})
		if err != nil {
			if isUniqueViolation(err) {
				w.WriteHeader(http.StatusConflict)
				return
			}
			log.Error("failed to add blocked personal domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(admintypes.BlockedPersonalDomain{
			Domain:    created.Domain,
			CreatedAt: created.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
		})
	}
}

// RemoveBlockedPersonalDomain handles POST /admin/remove-blocked-personal-domain
func RemoveBlockedPersonalDomain(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminRemoveBlockedDomainRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		domain := strings.ToLower(strings.TrimSpace(req.Domain))

		// Check existence first
		_, err := s.Global.GetBlockedPersonalDomain(ctx, domain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to check domain existence", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		txErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			if err := qtx.RemoveBlockedPersonalDomain(ctx, domain); err != nil {
				return err
			}

			auditData, _ := json.Marshal(map[string]any{
				"domain": domain,
			})
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.remove_blocked_personal_domain",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})
		if txErr != nil {
			log.Error("failed to remove blocked personal domain", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "unique")
}
