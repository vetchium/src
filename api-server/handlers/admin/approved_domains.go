package admin

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
	"vetchium-api-server.typespec/common"
)

const (
	defaultLimit = 50
	maxLimit    = 100
)

// CreateApprovedDomain handles POST /admin/approved-domains
func CreateApprovedDomain(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()
		log := s.Logger(ctx)

		// Get admin user from auth middleware context
		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Decode request
		var request admin.CreateApprovedDomainRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if validationErrors := request.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(validationErrors)
			return
		}

		domainName := string(request.DomainName)

		// Check if domain already exists
		_, err := s.Global.GetApprovedDomainByName(ctx, domainName)
		if err == nil {
			log.Debug("domain already exists", "domain_name", domainName)
			w.WriteHeader(http.StatusConflict)
			return
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to check existing domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Create domain
		domain, err := s.Global.CreateApprovedDomain(ctx, globaldb.CreateApprovedDomainParams{
			DomainName:       domainName,
			CreatedByAdminID: adminUser.AdminUserID,
		})
		if err != nil {
			log.Error("failed to create approved domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Create audit log
		createAuditLog(ctx, s, adminUser.AdminUserID, adminUser.EmailAddress, "created", &domain.DomainID, &domainName, nil, domainToJSON(domain), r)

		log.Info("approved domain created", "domain_name", domainName, "admin_user_id", adminUser.AdminUserID)

		// Return response
		w.WriteHeader(http.StatusCreated)
		response := admin.ApprovedDomain{
			DomainName:         common.DomainName(domainName),
			CreatedByAdminEmail: common.EmailAddress(adminUser.EmailAddress),
			CreatedAt:          domain.CreatedAt.Time.UTC().Format(time.RFC3339),
			UpdatedAt:          domain.UpdatedAt.Time.UTC().Format(time.RFC3339),
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// ListApprovedDomains handles GET /admin/approved-domains
func ListApprovedDomains(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()
		log := s.Logger(ctx)

		// Get admin user from auth middleware context
		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = adminUser // Auth verified, no further use needed

		// Parse query params
		search := r.URL.Query().Get("search")
		limit := parseLimit(r.URL.Query().Get("limit"), defaultLimit, maxLimit)
		cursor := r.URL.Query().Get("cursor")

		var domains []globaldb.ApprovedDomain
		var err error

		if search != "" {
			// Fuzzy search using pg_trgm
			var cursorDomain string
			if cursor != "" {
				cursorDomain, err = decodeDomainCursor(cursor)
				if err != nil {
					log.Debug("invalid cursor", "error", err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
			}
			domains, err = searchApprovedDomainsWithCursor(ctx, s, search, limit+1, cursorDomain)
		} else {
			// List all domains
			var cursorDomain string
			if cursor != "" {
				cursorDomain, err = decodeDomainCursor(cursor)
				if err != nil {
					log.Debug("invalid cursor", "error", err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
			}
			domains, err = listApprovedDomainsWithCursor(ctx, s, limit+1, cursorDomain)
		}

		if err != nil {
			log.Error("failed to query approved domains", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if there are more pages
		hasMore := len(domains) > limit
		if hasMore {
			domains = domains[:limit]
		}

		var nextCursor string
		if hasMore && len(domains) > 0 {
			lastDomain := domains[len(domains)-1]
			nextCursor = encodeDomainCursor(lastDomain.DomainName)
		}

		// Build response
		domainResponses := make([]admin.ApprovedDomain, len(domains))
		for i, d := range domains {
			// Get admin email for each domain
			adminUser, err := s.Global.GetAdminUserByID(ctx, d.CreatedByAdminID)
			adminEmail := d.CreatedByAdminID.String()
			if err == nil {
				adminEmail = adminUser.EmailAddress
			}

			domainResponses[i] = admin.ApprovedDomain{
				DomainName:         common.DomainName(d.DomainName),
				CreatedByAdminEmail: common.EmailAddress(adminEmail),
				CreatedAt:          d.CreatedAt.Time.UTC().Format(time.RFC3339),
				UpdatedAt:          d.UpdatedAt.Time.UTC().Format(time.RFC3339),
			}
		}

		response := admin.ApprovedDomainListResponse{
			Domains:    domainResponses,
			NextCursor: nextCursor,
			HasMore:    hasMore,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// GetApprovedDomain handles GET /admin/approved-domains/{domain_name}
func GetApprovedDomain(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()
		log := s.Logger(ctx)

		// Get admin user from auth middleware context
		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = adminUser // Auth verified, no further use needed

		// Get domain name from URL path variable
		domainName := r.PathValue("domainName")

		// Get domain
		domain, err := s.Global.GetApprovedDomainByName(ctx, domainName)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("domain not found", "domain_name", domainName)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get approved domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get admin email
		domainAdmin, err := s.Global.GetAdminUserByID(ctx, domain.CreatedByAdminID)
		adminEmail := domain.CreatedByAdminID.String()
		if err == nil {
			adminEmail = domainAdmin.EmailAddress
		}

		// Get audit logs with pagination
		auditLimit := parseLimit(r.URL.Query().Get("audit_limit"), defaultLimit, maxLimit)
		auditCursor := r.URL.Query().Get("audit_cursor")

		auditLogs, nextAuditCursor, hasMoreAudit, err := getAuditLogsWithCursor(ctx, s, &domain.DomainID, auditLimit+1, auditCursor)
		if err != nil {
			log.Error("failed to get audit logs", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Build response
		domainResponse := admin.ApprovedDomain{
			DomainName:         common.DomainName(domain.DomainName),
			CreatedByAdminEmail: common.EmailAddress(adminEmail),
			CreatedAt:          domain.CreatedAt.Time.UTC().Format(time.RFC3339),
			UpdatedAt:          domain.UpdatedAt.Time.UTC().Format(time.RFC3339),
		}

		auditResponses := make([]admin.ApprovedDomainAuditLog, len(auditLogs))
		for i, al := range auditLogs {
			auditResponses[i] = auditLogToResponse(ctx, s, al)
		}

		response := admin.ApprovedDomainDetailResponse{
			Domain:           domainResponse,
			AuditLogs:        auditResponses,
			NextAuditCursor:  nextAuditCursor,
			HasMoreAudit:     hasMoreAudit,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// DeleteApprovedDomain handles DELETE /admin/approved-domains/{domain_name}
func DeleteApprovedDomain(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()
		log := s.Logger(ctx)

		// Get admin user from auth middleware context
		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Get domain name from URL path variable
		domainName := r.PathValue("domainName")

		// Get domain before deletion for audit log
		domain, err := s.Global.GetApprovedDomainByName(ctx, domainName)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("domain not found", "domain_name", domainName)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get approved domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Soft delete domain
		deletedDomain, err := s.Global.SoftDeleteApprovedDomain(ctx, domain.DomainID)
		if err != nil {
			log.Error("failed to delete approved domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Create audit log with old value
		oldValue := domainToJSON(domain)
		newValue := map[string]interface{}{
			"deleted_at": deletedDomain.DeletedAt.Time.UTC().Format(time.RFC3339),
		}
		createAuditLog(ctx, s, adminUser.AdminUserID, adminUser.EmailAddress, "deleted", &domain.DomainID, &domainName, oldValue, newValue, r)

		log.Info("approved domain deleted", "domain_name", domainName, "admin_user_id", adminUser.AdminUserID)

		w.WriteHeader(http.StatusNoContent)
	}
}

// GetAuditLogs handles GET /admin/approved-domains/audit
func GetAuditLogs(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()
		log := s.Logger(ctx)

		// Get admin user from auth middleware context
		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = adminUser // Auth verified, no further use needed

		// Parse query params
		limit := parseLimit(r.URL.Query().Get("limit"), defaultLimit, maxLimit)
		cursor := r.URL.Query().Get("cursor")

		// Get audit logs with pagination
		auditLogs, nextCursor, hasMore, err := getAuditLogsWithCursor(ctx, s, nil, limit+1, cursor)
		if err != nil {
			log.Error("failed to get audit logs", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Build response
		auditResponses := make([]admin.ApprovedDomainAuditLog, len(auditLogs))
		for i, al := range auditLogs {
			auditResponses[i] = auditLogToResponse(ctx, s, al)
		}

		response := admin.AuditLogsResponse{
			Logs:       auditResponses,
			NextCursor: nextCursor,
			HasMore:    hasMore,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// Helper functions

func createAuditLog(ctx context.Context, s *server.Server, adminID pgtype.UUID, adminEmail string, action string, targetDomainID *pgtype.UUID, targetDomainName *string, oldValue, newValue map[string]interface{}, r *http.Request) {
	var targetIDPtr pgtype.UUID
	if targetDomainID != nil {
		targetIDPtr = *targetDomainID
	}

	var targetNamePtr pgtype.Text
	if targetDomainName != nil {
		targetNamePtr = pgtype.Text{String: *targetDomainName, Valid: true}
	}

	oldJSON, _ := json.Marshal(oldValue)
	newJSON, _ := json.Marshal(newValue)

	// Get IP address
	ipAddress := getIPAddress(r)

	// Get user agent
	userAgent := pgtype.Text{String: r.Header.Get("User-Agent"), Valid: true}

	// Get request ID
	requestID := pgtype.Text{String: r.Header.Get("X-Request-ID"), Valid: true}

	_, err := s.Global.CreateAuditLog(ctx, globaldb.CreateAuditLogParams{
		AdminID:          adminID,
		Action:           action,
		TargetDomainID:   targetIDPtr,
		TargetDomainName: targetNamePtr,
		OldValue:         oldJSON,
		NewValue:         newJSON,
		IpAddress:        ipAddress,
		UserAgent:        userAgent,
		RequestID:        requestID,
	})
	if err != nil {
		s.Logger(ctx).Error("failed to create audit log", "error", err)
	}
}

func getIPAddress(r *http.Request) *netip.Addr {
	// Check X-Forwarded-For header first (for proxies)
	forwardedFor := r.Header.Get("X-Forwarded-For")
	if forwardedFor != "" {
		// Take the first IP from the list
		ips := strings.Split(forwardedFor, ",")
		ip := net.ParseIP(strings.TrimSpace(ips[0]))
		if ip != nil {
			addr, ok := netip.AddrFromSlice(ip.To4())
			if ok {
				return &addr
			}
		}
	}

	// Fall back to RemoteAddr
	ipStr, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return nil
	}
	ip := net.ParseIP(ipStr)
	if ip != nil {
		addr, ok := netip.AddrFromSlice(ip.To4())
		if ok {
			return &addr
		}
	}
	return nil
}

func domainToJSON(domain globaldb.ApprovedDomain) map[string]interface{} {
	return map[string]interface{}{
		"domain_id":           domain.DomainID.String(),
		"domain_name":         domain.DomainName,
		"created_by_admin_id": domain.CreatedByAdminID.String(),
		"created_at":          domain.CreatedAt.Time.UTC().Format(time.RFC3339),
		"updated_at":          domain.UpdatedAt.Time.UTC().Format(time.RFC3339),
	}
}

func auditLogToResponse(ctx context.Context, s *server.Server, log globaldb.ApprovedDomainsAuditLog) admin.ApprovedDomainAuditLog {
	response := admin.ApprovedDomainAuditLog{
		Action:    admin.AuditAction(log.Action),
		CreatedAt: log.CreatedAt.Time.UTC().Format(time.RFC3339),
	}

	// Get admin email from admin ID
	if log.AdminID.Valid {
		adminUser, err := s.Global.GetAdminUserByID(ctx, log.AdminID)
		if err == nil {
			response.AdminEmail = common.EmailAddress(adminUser.EmailAddress)
		}
	}

	if log.TargetDomainName.Valid {
		targetName := log.TargetDomainName.String
		domainName := common.DomainName(targetName)
		response.TargetDomainName = &domainName
	}

	if log.OldValue != nil {
		var oldVal map[string]interface{}
		json.Unmarshal(log.OldValue, &oldVal)
		response.OldValue = oldVal
	}

	if log.NewValue != nil {
		var newVal map[string]interface{}
		json.Unmarshal(log.NewValue, &newVal)
		response.NewValue = newVal
	}

	if log.IpAddress != nil {
		ipAddr := log.IpAddress.String()
		response.IpAddress = &ipAddr
	}

	if log.UserAgent.Valid {
		ua := log.UserAgent.String
		response.UserAgent = &ua
	}

	if log.RequestID.Valid {
		rid := log.RequestID.String
		response.RequestID = &rid
	}

	return response
}

func listApprovedDomainsWithCursor(ctx context.Context, s *server.Server, limit int, cursor string) ([]globaldb.ApprovedDomain, error) {
	if cursor == "" {
		// First page - no cursor
		rows, err := s.Global.ListApprovedDomains(ctx)
		if err != nil {
			return nil, err
		}
		if len(rows) <= limit {
			return rows, nil
		}
		return rows[:limit], nil
	}

	// Cursor pagination: WHERE domain_name > cursor ORDER BY domain_name ASC
	rows, err := s.Global.ListApprovedDomains(ctx)
	if err != nil {
		return nil, err
	}

	// Filter rows after cursor
	var result []globaldb.ApprovedDomain
	for _, row := range rows {
		if row.DomainName > cursor {
			result = append(result, row)
		}
	}

	if len(result) <= limit {
		return result, nil
	}
	return result[:limit], nil
}

func searchApprovedDomainsWithCursor(ctx context.Context, s *server.Server, search string, limit int, cursor string) ([]globaldb.ApprovedDomain, error) {
	// For cursor-based pagination with similarity search, we fetch more and filter in memory
	// This is a limitation of similarity-based search with keyset pagination
	offset := int32(0)
	if cursor != "" {
		// Find the cursor position
		allRows, err := s.Global.SearchApprovedDomains(ctx, globaldb.SearchApprovedDomainsParams{
			DomainName: search,
			Limit:      1000,
			Offset:     0,
		})
		if err != nil {
			return nil, err
		}
		for i, row := range allRows {
			if row.DomainName == cursor {
				offset = int32(i + 1)
				break
			}
		}
	}

	// Fetch results with offset
	allRows, err := s.Global.SearchApprovedDomains(ctx, globaldb.SearchApprovedDomainsParams{
		DomainName: search,
		Limit:      int32(limit * 2),
		Offset:     offset,
	})
	if err != nil {
		return nil, err
	}

	if len(allRows) <= limit {
		return allRows, nil
	}
	return allRows[:limit], nil
}

func getAuditLogsWithCursor(ctx context.Context, s *server.Server, targetDomainID *pgtype.UUID, limit int, cursor string) ([]globaldb.ApprovedDomainsAuditLog, string, bool, error) {
	var logs []globaldb.ApprovedDomainsAuditLog

	// Parse cursor timestamp
	var cursorTime time.Time
	if cursor != "" {
		decoded, err := base64.StdEncoding.DecodeString(cursor)
		if err == nil {
			cursorTime, _ = time.Parse(time.RFC3339, string(decoded))
		}
	}

	if targetDomainID != nil {
		// Get logs for specific domain
		allLogs, err := s.Global.GetAuditLogsByDomainID(ctx, *targetDomainID)
		if err != nil {
			return nil, "", false, err
		}

		// Filter by cursor (logs are ordered DESC, so we want logs < cursorTime)
		if !cursorTime.IsZero() {
			var filtered []globaldb.ApprovedDomainsAuditLog
			for _, log := range allLogs {
				if log.CreatedAt.Time.Before(cursorTime) {
					filtered = append(filtered, log)
				}
			}
			logs = filtered
		} else {
			logs = allLogs
		}
	} else {
		// Get all audit logs
		allLogs, err := s.Global.GetAuditLogs(ctx, globaldb.GetAuditLogsParams{
			Limit:  int32(limit * 10),
			Offset: 0,
		})
		if err != nil {
			return nil, "", false, err
		}

		// Filter by cursor
		if !cursorTime.IsZero() {
			var filtered []globaldb.ApprovedDomainsAuditLog
			for _, log := range allLogs {
				if log.CreatedAt.Time.Before(cursorTime) {
					filtered = append(filtered, log)
				}
			}
			logs = filtered
		} else {
			logs = allLogs
		}
	}

	hasMore := len(logs) > limit
	if hasMore {
		logs = logs[:limit]
	}

	var nextCursor string
	if hasMore && len(logs) > 0 {
		lastLog := logs[len(logs)-1]
		nextCursor = base64.StdEncoding.EncodeToString([]byte(lastLog.CreatedAt.Time.UTC().Format(time.RFC3339)))
	}

	return logs, nextCursor, hasMore, nil
}

func encodeDomainCursor(domainName string) string {
	// Encode as base64 for URL safety
	return base64.StdEncoding.EncodeToString([]byte(domainName))
}

func decodeDomainCursor(cursor string) (string, error) {
	decoded, err := base64.StdEncoding.DecodeString(cursor)
	if err != nil {
		return "", fmt.Errorf("invalid cursor format")
	}
	return string(decoded), nil
}

func parseLimit(limitStr string, defaultLimit, maxLimit int) int {
	if limitStr == "" {
		return defaultLimit
	}
	var limit int
	if _, err := fmt.Sscanf(limitStr, "%d", &limit); err != nil {
		return defaultLimit
	}
	if limit <= 0 {
		return defaultLimit
	}
	if limit > maxLimit {
		return maxLimit
	}
	return limit
}
