package admin

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
	"vetchium-api-server.typespec/common"
)

const (
	defaultLimit = 50
	maxLimit     = 100
)

// AddApprovedDomain handles POST /admin/add-approved-domain
func AddApprovedDomain(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			s.Logger(ctx).Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var request admin.AddApprovedDomainRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Normalize domain name to lowercase before validation
		request.DomainName = common.DomainName(strings.ToLower(string(request.DomainName)))

		if validationErrors := request.Validate(); len(validationErrors) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(validationErrors)
			return
		}

		domainName := string(request.DomainName)

		var domain globaldb.ApprovedDomain
		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			var txErr error
			domain, txErr = qtx.CreateApprovedDomain(ctx, globaldb.CreateApprovedDomainParams{
				DomainName:       domainName,
				CreatedByAdminID: adminUser.AdminUserID,
			})
			if txErr != nil {
				if server.IsUniqueViolation(txErr) {
					return server.ErrConflict
				}
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{
				"domain": domainName,
				"reason": request.Reason,
			})
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.add_approved_domain",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, server.ErrConflict) {
				s.Logger(ctx).Debug("domain already exists", "domain_name", domainName)
				w.WriteHeader(http.StatusConflict)
				return
			}
			s.Logger(ctx).Error("failed to create approved domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("approved domain created", "domain_name", domainName, "admin_user_id", adminUser.AdminUserID)

		w.WriteHeader(http.StatusCreated)
		response := admin.ApprovedDomain{
			DomainName:          common.DomainName(domainName),
			CreatedByAdminEmail: common.EmailAddress(adminUser.EmailAddress),
			Status:              admin.DomainStatus(domain.Status),
			CreatedAt:           domain.CreatedAt.Time.UTC().Format(time.RFC3339),
			UpdatedAt:           domain.UpdatedAt.Time.UTC().Format(time.RFC3339),
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("failed to encode response", "error", err)
		}
	}
}

// ListApprovedDomains handles POST /admin/list-approved-domains
func ListApprovedDomains(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			s.Logger(ctx).Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var request admin.ListApprovedDomainsRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if validationErrors := request.Validate(); len(validationErrors) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(validationErrors)
			return
		}

		search := ""
		if request.Search != nil {
			search = *request.Search
		}

		filter := admin.DomainFilterActive
		if request.Filter != nil {
			filter = *request.Filter
		}

		limit := defaultLimit
		if request.Limit != nil {
			limit = int(*request.Limit)
		}

		cursor := ""
		if request.PaginationKey != nil {
			cursor = *request.PaginationKey
		}

		var domainResponses []admin.ApprovedDomain
		var nextPaginationKey string
		var hasMore bool
		var err error

		if search != "" {
			domainResponses, nextPaginationKey, hasMore, err = listDomainsWithSearch(ctx, s, search, filter, limit, cursor)
		} else {
			domainResponses, nextPaginationKey, hasMore, err = listDomainsWithoutSearch(ctx, s, filter, limit, cursor)
		}

		if err != nil {
			if err.Error() == "invalid cursor format" {
				s.Logger(ctx).Debug("invalid cursor format", "error", err)
				http.Error(w, "invalid cursor format", http.StatusBadRequest)
				return
			}
			s.Logger(ctx).Error("failed to query approved domains", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		response := admin.ApprovedDomainListResponse{
			Domains:           domainResponses,
			NextPaginationKey: nextPaginationKey,
			HasMore:           hasMore,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("failed to encode response", "error", err)
		}
	}
}

func listDomainsWithoutSearch(ctx context.Context, s *server.GlobalServer, filter admin.DomainFilter, limit int, cursor string) ([]admin.ApprovedDomain, string, bool, error) {
	type DomainRow struct {
		DomainID         pgtype.UUID
		DomainName       string
		CreatedByAdminID pgtype.UUID
		CreatedAt        pgtype.Timestamptz
		UpdatedAt        pgtype.Timestamptz
		Status           globaldb.DomainStatus
		AdminEmail       string
	}

	var rows []DomainRow

	if cursor == "" {
		switch filter {
		case admin.DomainFilterActive:
			dbRows, err := s.Global.ListApprovedDomainsActiveFirstPage(ctx, int32(limit+1))
			if err != nil {
				return nil, "", false, err
			}
			for _, r := range dbRows {
				rows = append(rows, DomainRow{
					DomainID:         r.DomainID,
					DomainName:       r.DomainName,
					CreatedByAdminID: r.CreatedByAdminID,
					CreatedAt:        r.CreatedAt,
					UpdatedAt:        r.UpdatedAt,
					Status:           r.Status,
					AdminEmail:       r.AdminEmail,
				})
			}
		case admin.DomainFilterInactive:
			dbRows, err := s.Global.ListApprovedDomainsInactiveFirstPage(ctx, int32(limit+1))
			if err != nil {
				return nil, "", false, err
			}
			for _, r := range dbRows {
				rows = append(rows, DomainRow{
					DomainID:         r.DomainID,
					DomainName:       r.DomainName,
					CreatedByAdminID: r.CreatedByAdminID,
					CreatedAt:        r.CreatedAt,
					UpdatedAt:        r.UpdatedAt,
					Status:           r.Status,
					AdminEmail:       r.AdminEmail,
				})
			}
		case admin.DomainFilterAll:
			dbRows, err := s.Global.ListApprovedDomainsAllFirstPage(ctx, int32(limit+1))
			if err != nil {
				return nil, "", false, err
			}
			for _, r := range dbRows {
				rows = append(rows, DomainRow{
					DomainID:         r.DomainID,
					DomainName:       r.DomainName,
					CreatedByAdminID: r.CreatedByAdminID,
					CreatedAt:        r.CreatedAt,
					UpdatedAt:        r.UpdatedAt,
					Status:           r.Status,
					AdminEmail:       r.AdminEmail,
				})
			}
		}
	} else {
		cursorDomain, err := decodeDomainCursor(cursor)
		if err != nil {
			return nil, "", false, err
		}

		switch filter {
		case admin.DomainFilterActive:
			dbRows, err := s.Global.ListApprovedDomainsActiveAfterCursor(ctx, globaldb.ListApprovedDomainsActiveAfterCursorParams{
				DomainName: cursorDomain,
				Limit:      int32(limit + 1),
			})
			if err != nil {
				return nil, "", false, err
			}
			for _, r := range dbRows {
				rows = append(rows, DomainRow{
					DomainID:         r.DomainID,
					DomainName:       r.DomainName,
					CreatedByAdminID: r.CreatedByAdminID,
					CreatedAt:        r.CreatedAt,
					UpdatedAt:        r.UpdatedAt,
					Status:           r.Status,
					AdminEmail:       r.AdminEmail,
				})
			}
		case admin.DomainFilterInactive:
			dbRows, err := s.Global.ListApprovedDomainsInactiveAfterCursor(ctx, globaldb.ListApprovedDomainsInactiveAfterCursorParams{
				DomainName: cursorDomain,
				Limit:      int32(limit + 1),
			})
			if err != nil {
				return nil, "", false, err
			}
			for _, r := range dbRows {
				rows = append(rows, DomainRow{
					DomainID:         r.DomainID,
					DomainName:       r.DomainName,
					CreatedByAdminID: r.CreatedByAdminID,
					CreatedAt:        r.CreatedAt,
					UpdatedAt:        r.UpdatedAt,
					Status:           r.Status,
					AdminEmail:       r.AdminEmail,
				})
			}
		case admin.DomainFilterAll:
			dbRows, err := s.Global.ListApprovedDomainsAllAfterCursor(ctx, globaldb.ListApprovedDomainsAllAfterCursorParams{
				DomainName: cursorDomain,
				Limit:      int32(limit + 1),
			})
			if err != nil {
				return nil, "", false, err
			}
			for _, r := range dbRows {
				rows = append(rows, DomainRow{
					DomainID:         r.DomainID,
					DomainName:       r.DomainName,
					CreatedByAdminID: r.CreatedByAdminID,
					CreatedAt:        r.CreatedAt,
					UpdatedAt:        r.UpdatedAt,
					Status:           r.Status,
					AdminEmail:       r.AdminEmail,
				})
			}
		}
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	var nextPaginationKey string
	if hasMore && len(rows) > 0 {
		lastRow := rows[len(rows)-1]
		nextPaginationKey = encodeDomainCursor(lastRow.DomainName)
	}

	domainResponses := make([]admin.ApprovedDomain, len(rows))
	for i, r := range rows {
		domainResponses[i] = admin.ApprovedDomain{
			DomainName:          common.DomainName(r.DomainName),
			CreatedByAdminEmail: common.EmailAddress(r.AdminEmail),
			Status:              admin.DomainStatus(r.Status),
			CreatedAt:           r.CreatedAt.Time.UTC().Format(time.RFC3339),
			UpdatedAt:           r.UpdatedAt.Time.UTC().Format(time.RFC3339),
		}
	}

	return domainResponses, nextPaginationKey, hasMore, nil
}

func listDomainsWithSearch(ctx context.Context, s *server.GlobalServer, search string, filter admin.DomainFilter, limit int, cursor string) ([]admin.ApprovedDomain, string, bool, error) {
	type SearchRow struct {
		DomainID         pgtype.UUID
		DomainName       string
		CreatedByAdminID pgtype.UUID
		CreatedAt        pgtype.Timestamptz
		UpdatedAt        pgtype.Timestamptz
		Status           globaldb.DomainStatus
		AdminEmail       string
		SimScore         float32
	}

	var rows []SearchRow

	if cursor == "" {
		switch filter {
		case admin.DomainFilterActive:
			dbRows, err := s.Global.SearchApprovedDomainsActiveFirstPage(ctx, globaldb.SearchApprovedDomainsActiveFirstPageParams{
				SearchTerm: search,
				LimitCount: int32(limit + 1),
			})
			if err != nil {
				return nil, "", false, err
			}
			for _, r := range dbRows {
				rows = append(rows, SearchRow{
					DomainID:         r.DomainID,
					DomainName:       r.DomainName,
					CreatedByAdminID: r.CreatedByAdminID,
					CreatedAt:        r.CreatedAt,
					UpdatedAt:        r.UpdatedAt,
					Status:           r.Status,
					AdminEmail:       r.AdminEmail,
					SimScore:         r.SimScore,
				})
			}
		case admin.DomainFilterInactive:
			dbRows, err := s.Global.SearchApprovedDomainsInactiveFirstPage(ctx, globaldb.SearchApprovedDomainsInactiveFirstPageParams{
				SearchTerm: search,
				LimitCount: int32(limit + 1),
			})
			if err != nil {
				return nil, "", false, err
			}
			for _, r := range dbRows {
				rows = append(rows, SearchRow{
					DomainID:         r.DomainID,
					DomainName:       r.DomainName,
					CreatedByAdminID: r.CreatedByAdminID,
					CreatedAt:        r.CreatedAt,
					UpdatedAt:        r.UpdatedAt,
					Status:           r.Status,
					AdminEmail:       r.AdminEmail,
					SimScore:         r.SimScore,
				})
			}
		case admin.DomainFilterAll:
			dbRows, err := s.Global.SearchApprovedDomainsAllFirstPage(ctx, globaldb.SearchApprovedDomainsAllFirstPageParams{
				SearchTerm: search,
				LimitCount: int32(limit + 1),
			})
			if err != nil {
				return nil, "", false, err
			}
			for _, r := range dbRows {
				rows = append(rows, SearchRow{
					DomainID:         r.DomainID,
					DomainName:       r.DomainName,
					CreatedByAdminID: r.CreatedByAdminID,
					CreatedAt:        r.CreatedAt,
					UpdatedAt:        r.UpdatedAt,
					Status:           r.Status,
					AdminEmail:       r.AdminEmail,
					SimScore:         r.SimScore,
				})
			}
		}
	} else {
		cursorScore, cursorDomain, err := decodeSearchCursor(cursor)
		if err != nil {
			return nil, "", false, err
		}

		switch filter {
		case admin.DomainFilterActive:
			dbRows, err := s.Global.SearchApprovedDomainsActiveAfterCursor(ctx, globaldb.SearchApprovedDomainsActiveAfterCursorParams{
				SearchTerm:   search,
				CursorScore:  cursorScore,
				CursorDomain: cursorDomain,
				LimitCount:   int32(limit + 1),
			})
			if err != nil {
				return nil, "", false, err
			}
			for _, r := range dbRows {
				rows = append(rows, SearchRow{
					DomainID:         r.DomainID,
					DomainName:       r.DomainName,
					CreatedByAdminID: r.CreatedByAdminID,
					CreatedAt:        r.CreatedAt,
					UpdatedAt:        r.UpdatedAt,
					Status:           r.Status,
					AdminEmail:       r.AdminEmail,
					SimScore:         r.SimScore,
				})
			}
		case admin.DomainFilterInactive:
			dbRows, err := s.Global.SearchApprovedDomainsInactiveAfterCursor(ctx, globaldb.SearchApprovedDomainsInactiveAfterCursorParams{
				SearchTerm:   search,
				CursorScore:  cursorScore,
				CursorDomain: cursorDomain,
				LimitCount:   int32(limit + 1),
			})
			if err != nil {
				return nil, "", false, err
			}
			for _, r := range dbRows {
				rows = append(rows, SearchRow{
					DomainID:         r.DomainID,
					DomainName:       r.DomainName,
					CreatedByAdminID: r.CreatedByAdminID,
					CreatedAt:        r.CreatedAt,
					UpdatedAt:        r.UpdatedAt,
					Status:           r.Status,
					AdminEmail:       r.AdminEmail,
					SimScore:         r.SimScore,
				})
			}
		case admin.DomainFilterAll:
			dbRows, err := s.Global.SearchApprovedDomainsAllAfterCursor(ctx, globaldb.SearchApprovedDomainsAllAfterCursorParams{
				SearchTerm:   search,
				CursorScore:  cursorScore,
				CursorDomain: cursorDomain,
				LimitCount:   int32(limit + 1),
			})
			if err != nil {
				return nil, "", false, err
			}
			for _, r := range dbRows {
				rows = append(rows, SearchRow{
					DomainID:         r.DomainID,
					DomainName:       r.DomainName,
					CreatedByAdminID: r.CreatedByAdminID,
					CreatedAt:        r.CreatedAt,
					UpdatedAt:        r.UpdatedAt,
					Status:           r.Status,
					AdminEmail:       r.AdminEmail,
					SimScore:         r.SimScore,
				})
			}
		}
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	var nextPaginationKey string
	if hasMore && len(rows) > 0 {
		lastRow := rows[len(rows)-1]
		nextPaginationKey = encodeSearchCursor(lastRow.SimScore, lastRow.DomainName)
	}

	domainResponses := make([]admin.ApprovedDomain, len(rows))
	for i, r := range rows {
		domainResponses[i] = admin.ApprovedDomain{
			DomainName:          common.DomainName(r.DomainName),
			CreatedByAdminEmail: common.EmailAddress(r.AdminEmail),
			Status:              admin.DomainStatus(r.Status),
			CreatedAt:           r.CreatedAt.Time.UTC().Format(time.RFC3339),
			UpdatedAt:           r.UpdatedAt.Time.UTC().Format(time.RFC3339),
		}
	}

	return domainResponses, nextPaginationKey, hasMore, nil
}

// GetApprovedDomain handles POST /admin/get-approved-domain
func GetApprovedDomain(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			s.Logger(ctx).Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var request admin.GetApprovedDomainRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if validationErrors := request.Validate(); len(validationErrors) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(validationErrors)
			return
		}

		domainName := string(request.DomainName)

		domain, err := s.Global.GetApprovedDomainWithAdminByName(ctx, domainName)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("domain not found", "domain_name", domainName)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get approved domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		domainResponse := admin.ApprovedDomain{
			DomainName:          common.DomainName(domain.DomainName),
			CreatedByAdminEmail: common.EmailAddress(domain.AdminEmail),
			Status:              admin.DomainStatus(domain.Status),
			CreatedAt:           domain.CreatedAt.Time.UTC().Format(time.RFC3339),
			UpdatedAt:           domain.UpdatedAt.Time.UTC().Format(time.RFC3339),
		}

		response := admin.ApprovedDomainDetailResponse{
			Domain: domainResponse,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("failed to encode response", "error", err)
		}
	}
}

// DisableApprovedDomain handles POST /admin/disable-approved-domain
func DisableApprovedDomain(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			s.Logger(ctx).Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var request admin.DisableApprovedDomainRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if validationErrors := request.Validate(); len(validationErrors) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(validationErrors)
			return
		}

		domainName := string(request.DomainName)

		var disabledDomain globaldb.ApprovedDomain
		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			domain, txErr := qtx.GetApprovedDomainByName(ctx, domainName)
			if txErr != nil {
				if errors.Is(txErr, pgx.ErrNoRows) {
					return server.ErrNotFound
				}
				return txErr
			}
			if domain.Status == globaldb.DomainStatusInactive {
				return server.ErrInvalidState
			}
			disabledDomain, txErr = qtx.DisableApprovedDomain(ctx, domain.DomainID)
			if txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{
				"domain": domainName,
				"reason": request.Reason,
			})
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.disable_approved_domain",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, server.ErrNotFound) {
				s.Logger(ctx).Debug("domain not found", "domain_name", domainName)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				s.Logger(ctx).Debug("domain already inactive", "domain_name", domainName)
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			s.Logger(ctx).Error("failed to disable approved domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("approved domain disabled", "domain_name", domainName, "admin_user_id", adminUser.AdminUserID)

		w.WriteHeader(http.StatusOK)
		response := admin.ApprovedDomain{
			DomainName:          common.DomainName(domainName),
			CreatedByAdminEmail: common.EmailAddress(adminUser.EmailAddress),
			Status:              admin.DomainStatus(disabledDomain.Status),
			CreatedAt:           disabledDomain.CreatedAt.Time.UTC().Format(time.RFC3339),
			UpdatedAt:           disabledDomain.UpdatedAt.Time.UTC().Format(time.RFC3339),
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("failed to encode response", "error", err)
		}
	}
}

// EnableApprovedDomain handles POST /admin/enable-approved-domain
func EnableApprovedDomain(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			s.Logger(ctx).Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var request admin.EnableApprovedDomainRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if validationErrors := request.Validate(); len(validationErrors) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(validationErrors)
			return
		}

		domainName := string(request.DomainName)

		var enabledDomain globaldb.ApprovedDomain
		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			domain, txErr := qtx.GetApprovedDomainByName(ctx, domainName)
			if txErr != nil {
				if errors.Is(txErr, pgx.ErrNoRows) {
					return server.ErrNotFound
				}
				return txErr
			}
			if domain.Status == globaldb.DomainStatusActive {
				return server.ErrInvalidState
			}
			enabledDomain, txErr = qtx.EnableApprovedDomain(ctx, domain.DomainID)
			if txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{
				"domain": domainName,
				"reason": request.Reason,
			})
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.enable_approved_domain",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, server.ErrNotFound) {
				s.Logger(ctx).Debug("domain not found", "domain_name", domainName)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				s.Logger(ctx).Debug("domain already active", "domain_name", domainName)
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			s.Logger(ctx).Error("failed to enable approved domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("approved domain enabled", "domain_name", domainName, "admin_user_id", adminUser.AdminUserID)

		w.WriteHeader(http.StatusOK)
		response := admin.ApprovedDomain{
			DomainName:          common.DomainName(domainName),
			CreatedByAdminEmail: common.EmailAddress(adminUser.EmailAddress),
			Status:              admin.DomainStatus(enabledDomain.Status),
			CreatedAt:           enabledDomain.CreatedAt.Time.UTC().Format(time.RFC3339),
			UpdatedAt:           enabledDomain.UpdatedAt.Time.UTC().Format(time.RFC3339),
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("failed to encode response", "error", err)
		}
	}
}

// Cursor encoding/decoding functions

func encodeDomainCursor(domainName string) string {
	return base64.URLEncoding.EncodeToString([]byte(domainName))
}

func decodeDomainCursor(cursor string) (string, error) {
	decoded, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return "", fmt.Errorf("invalid cursor format")
	}
	return string(decoded), nil
}

func encodeSearchCursor(score float32, domainName string) string {
	data := fmt.Sprintf("%.9g|%s", score, domainName)
	return base64.URLEncoding.EncodeToString([]byte(data))
}

func decodeSearchCursor(cursor string) (float32, string, error) {
	decoded, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return 0, "", fmt.Errorf("invalid cursor format")
	}
	parts := strings.SplitN(string(decoded), "|", 2)
	if len(parts) != 2 {
		return 0, "", fmt.Errorf("invalid cursor format")
	}
	score, err := strconv.ParseFloat(parts[0], 32)
	if err != nil {
		return 0, "", fmt.Errorf("invalid cursor format")
	}
	return float32(score), parts[1], nil
}
