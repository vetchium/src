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
	"strconv"
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
	maxLimit     = 100
)

// ErrorResponse represents a JSON error response body.
type ErrorResponse struct {
	Error string `json:"error"`
}

func writeErrorResponse(w http.ResponseWriter, statusCode int, message string) {
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(ErrorResponse{Error: message})
}

// CreateApprovedDomain handles POST /admin/approved-domains
func CreateApprovedDomain(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var request admin.CreateApprovedDomainRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			log.Debug("failed to decode request", "error", err)
			writeErrorResponse(w, http.StatusBadRequest, "invalid JSON request body")
			return
		}

		// Normalize domain name to lowercase before validation
		request.DomainName = common.DomainName(strings.ToLower(string(request.DomainName)))

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
			writeErrorResponse(w, http.StatusConflict, "domain already exists")
			return
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to check existing domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		domain, err := s.Global.CreateApprovedDomain(ctx, globaldb.CreateApprovedDomainParams{
			DomainName:       domainName,
			CreatedByAdminID: adminUser.AdminUserID,
		})
		if err != nil {
			log.Error("failed to create approved domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		createAuditLog(ctx, s, adminUser.AdminUserID, "created", &domain.DomainID, &domainName, nil, domainToJSON(domain), r)

		log.Info("approved domain created", "domain_name", domainName, "admin_user_id", adminUser.AdminUserID)

		w.WriteHeader(http.StatusCreated)
		response := admin.ApprovedDomain{
			DomainName:          common.DomainName(domainName),
			CreatedByAdminEmail: common.EmailAddress(adminUser.EmailAddress),
			CreatedAt:           domain.CreatedAt.Time.UTC().Format(time.RFC3339),
			UpdatedAt:           domain.UpdatedAt.Time.UTC().Format(time.RFC3339),
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

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		search := r.URL.Query().Get("search")
		limit := parseLimit(r.URL.Query().Get("limit"), defaultLimit, maxLimit)
		cursor := r.URL.Query().Get("cursor")

		var domainResponses []admin.ApprovedDomain
		var nextCursor string
		var hasMore bool
		var err error

		if search != "" {
			domainResponses, nextCursor, hasMore, err = listDomainsWithSearch(ctx, s, search, limit, cursor)
		} else {
			domainResponses, nextCursor, hasMore, err = listDomainsWithoutSearch(ctx, s, limit, cursor)
		}

		if err != nil {
			if err.Error() == "invalid cursor format" {
				writeErrorResponse(w, http.StatusBadRequest, "invalid cursor format")
				return
			}
			log.Error("failed to query approved domains", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
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

func listDomainsWithoutSearch(ctx context.Context, s *server.Server, limit int, cursor string) ([]admin.ApprovedDomain, string, bool, error) {
	var rows []globaldb.ListApprovedDomainsFirstPageRow

	if cursor == "" {
		var err error
		rows, err = s.Global.ListApprovedDomainsFirstPage(ctx, int32(limit+1))
		if err != nil {
			return nil, "", false, err
		}
	} else {
		cursorDomain, err := decodeDomainCursor(cursor)
		if err != nil {
			return nil, "", false, err
		}
		afterRows, err := s.Global.ListApprovedDomainsAfterCursor(ctx, globaldb.ListApprovedDomainsAfterCursorParams{
			DomainName: cursorDomain,
			Limit:      int32(limit + 1),
		})
		if err != nil {
			return nil, "", false, err
		}
		for _, r := range afterRows {
			rows = append(rows, globaldb.ListApprovedDomainsFirstPageRow{
				DomainID:         r.DomainID,
				DomainName:       r.DomainName,
				CreatedByAdminID: r.CreatedByAdminID,
				CreatedAt:        r.CreatedAt,
				UpdatedAt:        r.UpdatedAt,
				DeletedAt:        r.DeletedAt,
				AdminEmail:       r.AdminEmail,
			})
		}
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	var nextCursor string
	if hasMore && len(rows) > 0 {
		lastRow := rows[len(rows)-1]
		nextCursor = encodeDomainCursor(lastRow.DomainName)
	}

	domainResponses := make([]admin.ApprovedDomain, len(rows))
	for i, r := range rows {
		domainResponses[i] = admin.ApprovedDomain{
			DomainName:          common.DomainName(r.DomainName),
			CreatedByAdminEmail: common.EmailAddress(r.AdminEmail),
			CreatedAt:           r.CreatedAt.Time.UTC().Format(time.RFC3339),
			UpdatedAt:           r.UpdatedAt.Time.UTC().Format(time.RFC3339),
		}
	}

	return domainResponses, nextCursor, hasMore, nil
}

func listDomainsWithSearch(ctx context.Context, s *server.Server, search string, limit int, cursor string) ([]admin.ApprovedDomain, string, bool, error) {
	var rows []globaldb.SearchApprovedDomainsFirstPageRow

	if cursor == "" {
		var err error
		rows, err = s.Global.SearchApprovedDomainsFirstPage(ctx, globaldb.SearchApprovedDomainsFirstPageParams{
			SearchTerm: search,
			LimitCount: int32(limit + 1),
		})
		if err != nil {
			return nil, "", false, err
		}
	} else {
		cursorScore, cursorDomain, err := decodeSearchCursor(cursor)
		if err != nil {
			return nil, "", false, err
		}
		afterRows, err := s.Global.SearchApprovedDomainsAfterCursor(ctx, globaldb.SearchApprovedDomainsAfterCursorParams{
			SearchTerm:   search,
			CursorScore:  cursorScore,
			CursorDomain: cursorDomain,
			LimitCount:   int32(limit + 1),
		})
		if err != nil {
			return nil, "", false, err
		}
		for _, r := range afterRows {
			rows = append(rows, globaldb.SearchApprovedDomainsFirstPageRow{
				DomainID:         r.DomainID,
				DomainName:       r.DomainName,
				CreatedByAdminID: r.CreatedByAdminID,
				CreatedAt:        r.CreatedAt,
				UpdatedAt:        r.UpdatedAt,
				DeletedAt:        r.DeletedAt,
				AdminEmail:       r.AdminEmail,
				SimScore:         r.SimScore,
			})
		}
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	var nextCursor string
	if hasMore && len(rows) > 0 {
		lastRow := rows[len(rows)-1]
		nextCursor = encodeSearchCursor(lastRow.SimScore, lastRow.DomainName)
	}

	domainResponses := make([]admin.ApprovedDomain, len(rows))
	for i, r := range rows {
		domainResponses[i] = admin.ApprovedDomain{
			DomainName:          common.DomainName(r.DomainName),
			CreatedByAdminEmail: common.EmailAddress(r.AdminEmail),
			CreatedAt:           r.CreatedAt.Time.UTC().Format(time.RFC3339),
			UpdatedAt:           r.UpdatedAt.Time.UTC().Format(time.RFC3339),
		}
	}

	return domainResponses, nextCursor, hasMore, nil
}

// GetApprovedDomain handles GET /admin/approved-domains/{domain_name}
func GetApprovedDomain(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		domainName := r.PathValue("domainName")

		domain, err := s.Global.GetApprovedDomainWithAdminByName(ctx, domainName)
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

		auditLimit := parseLimit(r.URL.Query().Get("audit_limit"), defaultLimit, maxLimit)
		auditCursor := r.URL.Query().Get("audit_cursor")

		auditLogs, nextAuditCursor, hasMoreAudit, err := getAuditLogsForDomain(ctx, s, domain.DomainID, auditLimit, auditCursor)
		if err != nil {
			if err.Error() == "invalid cursor format" {
				writeErrorResponse(w, http.StatusBadRequest, "invalid audit cursor format")
				return
			}
			log.Error("failed to get audit logs", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		domainResponse := admin.ApprovedDomain{
			DomainName:          common.DomainName(domain.DomainName),
			CreatedByAdminEmail: common.EmailAddress(domain.AdminEmail),
			CreatedAt:           domain.CreatedAt.Time.UTC().Format(time.RFC3339),
			UpdatedAt:           domain.UpdatedAt.Time.UTC().Format(time.RFC3339),
		}

		response := admin.ApprovedDomainDetailResponse{
			Domain:          domainResponse,
			AuditLogs:       auditLogs,
			NextAuditCursor: nextAuditCursor,
			HasMoreAudit:    hasMoreAudit,
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

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		domainName := r.PathValue("domainName")

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

		deletedDomain, err := s.Global.SoftDeleteApprovedDomain(ctx, domain.DomainID)
		if err != nil {
			log.Error("failed to delete approved domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		oldValue := domainToJSON(domain)
		newValue := map[string]interface{}{
			"deleted_at": deletedDomain.DeletedAt.Time.UTC().Format(time.RFC3339),
		}
		createAuditLog(ctx, s, adminUser.AdminUserID, "deleted", &domain.DomainID, &domainName, oldValue, newValue, r)

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

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		limit := parseLimit(r.URL.Query().Get("limit"), defaultLimit, maxLimit)
		cursor := r.URL.Query().Get("cursor")

		auditLogs, nextCursor, hasMore, err := getAllAuditLogs(ctx, s, limit, cursor)
		if err != nil {
			if err.Error() == "invalid cursor format" {
				writeErrorResponse(w, http.StatusBadRequest, "invalid cursor format")
				return
			}
			log.Error("failed to get audit logs", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		response := admin.AuditLogsResponse{
			Logs:       auditLogs,
			NextCursor: nextCursor,
			HasMore:    hasMore,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// Helper functions

func createAuditLog(ctx context.Context, s *server.Server, adminID pgtype.UUID, action string, targetDomainID *pgtype.UUID, targetDomainName *string, oldValue, newValue map[string]interface{}, r *http.Request) {
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

	ipAddress := getIPAddress(r)
	userAgent := pgtype.Text{String: r.Header.Get("User-Agent"), Valid: true}
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
		ips := strings.Split(forwardedFor, ",")
		ipStr := strings.TrimSpace(ips[0])
		if addr, err := netip.ParseAddr(ipStr); err == nil {
			return &addr
		}
	}

	// Fall back to RemoteAddr
	ipStr, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		// RemoteAddr might not have port
		ipStr = r.RemoteAddr
	}
	if addr, err := netip.ParseAddr(ipStr); err == nil {
		return &addr
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

func getAuditLogsForDomain(ctx context.Context, s *server.Server, domainID pgtype.UUID, limit int, cursor string) ([]admin.ApprovedDomainAuditLog, string, bool, error) {
	var rows []globaldb.GetAuditLogsByDomainIDFirstPageRow

	if cursor == "" {
		var err error
		rows, err = s.Global.GetAuditLogsByDomainIDFirstPage(ctx, globaldb.GetAuditLogsByDomainIDFirstPageParams{
			TargetDomainID: domainID,
			Limit:          int32(limit + 1),
		})
		if err != nil {
			return nil, "", false, err
		}
	} else {
		cursorTime, err := decodeAuditCursor(cursor)
		if err != nil {
			return nil, "", false, err
		}
		afterRows, err := s.Global.GetAuditLogsByDomainIDAfterCursor(ctx, globaldb.GetAuditLogsByDomainIDAfterCursorParams{
			TargetDomainID: domainID,
			CreatedAt:      pgtype.Timestamptz{Time: cursorTime, Valid: true},
			Limit:          int32(limit + 1),
		})
		if err != nil {
			return nil, "", false, err
		}
		for _, r := range afterRows {
			rows = append(rows, globaldb.GetAuditLogsByDomainIDFirstPageRow{
				AuditID:          r.AuditID,
				AdminID:          r.AdminID,
				Action:           r.Action,
				TargetDomainID:   r.TargetDomainID,
				TargetDomainName: r.TargetDomainName,
				OldValue:         r.OldValue,
				NewValue:         r.NewValue,
				IpAddress:        r.IpAddress,
				UserAgent:        r.UserAgent,
				RequestID:        r.RequestID,
				CreatedAt:        r.CreatedAt,
				AdminEmail:       r.AdminEmail,
			})
		}
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	var nextCursor string
	if hasMore && len(rows) > 0 {
		lastRow := rows[len(rows)-1]
		nextCursor = encodeAuditCursor(lastRow.CreatedAt.Time)
	}

	auditLogs := make([]admin.ApprovedDomainAuditLog, len(rows))
	for i, r := range rows {
		auditLogs[i] = auditLogRowToResponse(r)
	}

	return auditLogs, nextCursor, hasMore, nil
}

func getAllAuditLogs(ctx context.Context, s *server.Server, limit int, cursor string) ([]admin.ApprovedDomainAuditLog, string, bool, error) {
	var rows []globaldb.GetAuditLogsFirstPageRow

	if cursor == "" {
		var err error
		rows, err = s.Global.GetAuditLogsFirstPage(ctx, int32(limit+1))
		if err != nil {
			return nil, "", false, err
		}
	} else {
		cursorTime, err := decodeAuditCursor(cursor)
		if err != nil {
			return nil, "", false, err
		}
		afterRows, err := s.Global.GetAuditLogsAfterCursor(ctx, globaldb.GetAuditLogsAfterCursorParams{
			CreatedAt: pgtype.Timestamptz{Time: cursorTime, Valid: true},
			Limit:     int32(limit + 1),
		})
		if err != nil {
			return nil, "", false, err
		}
		for _, r := range afterRows {
			rows = append(rows, globaldb.GetAuditLogsFirstPageRow{
				AuditID:          r.AuditID,
				AdminID:          r.AdminID,
				Action:           r.Action,
				TargetDomainID:   r.TargetDomainID,
				TargetDomainName: r.TargetDomainName,
				OldValue:         r.OldValue,
				NewValue:         r.NewValue,
				IpAddress:        r.IpAddress,
				UserAgent:        r.UserAgent,
				RequestID:        r.RequestID,
				CreatedAt:        r.CreatedAt,
				AdminEmail:       r.AdminEmail,
			})
		}
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	var nextCursor string
	if hasMore && len(rows) > 0 {
		lastRow := rows[len(rows)-1]
		nextCursor = encodeAuditCursor(lastRow.CreatedAt.Time)
	}

	auditLogs := make([]admin.ApprovedDomainAuditLog, len(rows))
	for i, r := range rows {
		auditLogs[i] = auditLogFirstPageRowToResponse(r)
	}

	return auditLogs, nextCursor, hasMore, nil
}

func auditLogRowToResponse(r globaldb.GetAuditLogsByDomainIDFirstPageRow) admin.ApprovedDomainAuditLog {
	response := admin.ApprovedDomainAuditLog{
		Action:    admin.AuditAction(r.Action),
		CreatedAt: r.CreatedAt.Time.UTC().Format(time.RFC3339),
	}

	if r.AdminEmail.Valid {
		response.AdminEmail = common.EmailAddress(r.AdminEmail.String)
	}

	if r.TargetDomainName.Valid {
		targetName := common.DomainName(r.TargetDomainName.String)
		response.TargetDomainName = &targetName
	}

	if r.OldValue != nil {
		var oldVal map[string]interface{}
		json.Unmarshal(r.OldValue, &oldVal)
		response.OldValue = oldVal
	}

	if r.NewValue != nil {
		var newVal map[string]interface{}
		json.Unmarshal(r.NewValue, &newVal)
		response.NewValue = newVal
	}

	if r.IpAddress != nil {
		ipAddr := r.IpAddress.String()
		response.IpAddress = &ipAddr
	}

	if r.UserAgent.Valid {
		ua := r.UserAgent.String
		response.UserAgent = &ua
	}

	if r.RequestID.Valid {
		rid := r.RequestID.String
		response.RequestID = &rid
	}

	return response
}

func auditLogFirstPageRowToResponse(r globaldb.GetAuditLogsFirstPageRow) admin.ApprovedDomainAuditLog {
	response := admin.ApprovedDomainAuditLog{
		Action:    admin.AuditAction(r.Action),
		CreatedAt: r.CreatedAt.Time.UTC().Format(time.RFC3339),
	}

	if r.AdminEmail.Valid {
		response.AdminEmail = common.EmailAddress(r.AdminEmail.String)
	}

	if r.TargetDomainName.Valid {
		targetName := common.DomainName(r.TargetDomainName.String)
		response.TargetDomainName = &targetName
	}

	if r.OldValue != nil {
		var oldVal map[string]interface{}
		json.Unmarshal(r.OldValue, &oldVal)
		response.OldValue = oldVal
	}

	if r.NewValue != nil {
		var newVal map[string]interface{}
		json.Unmarshal(r.NewValue, &newVal)
		response.NewValue = newVal
	}

	if r.IpAddress != nil {
		ipAddr := r.IpAddress.String()
		response.IpAddress = &ipAddr
	}

	if r.UserAgent.Valid {
		ua := r.UserAgent.String
		response.UserAgent = &ua
	}

	if r.RequestID.Valid {
		rid := r.RequestID.String
		response.RequestID = &rid
	}

	return response
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
	data := fmt.Sprintf("%f|%s", score, domainName)
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

func encodeAuditCursor(t time.Time) string {
	return base64.URLEncoding.EncodeToString([]byte(t.UTC().Format(time.RFC3339Nano)))
}

func decodeAuditCursor(cursor string) (time.Time, error) {
	decoded, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid cursor format")
	}
	t, err := time.Parse(time.RFC3339Nano, string(decoded))
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid cursor format")
	}
	return t, nil
}

func parseLimit(limitStr string, defaultLimit, maxLimit int) int {
	if limitStr == "" {
		return defaultLimit
	}
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 {
		return defaultLimit
	}
	if limit > maxLimit {
		return maxLimit
	}
	return limit
}
