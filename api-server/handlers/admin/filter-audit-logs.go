package admin

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	auditlogs "vetchium-api-server.typespec/audit-logs"
)

// FilterAuditLogs handles POST /admin/filter-audit-logs
func FilterAuditLogs(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			s.Logger(ctx).Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req auditlogs.FilterAuditLogsRequest
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

		params := globaldb.FilterAdminAuditLogsParams{
			LimitCount: req.EffectiveLimit() + 1, // fetch one extra to detect next page
		}

		if len(req.EventTypes) > 0 {
			params.EventTypes = req.EventTypes
		}

		if req.ActorEmail != nil {
			actorUser, err := s.Global.GetAdminUserByEmail(ctx, *req.ActorEmail)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				s.Logger(ctx).Error("failed to get admin user by email", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			params.ActorUserID = actorUser.AdminUserID
		}

		if req.StartTime != nil {
			t, _ := time.Parse(time.RFC3339, *req.StartTime)
			params.StartTime = pgtype.Timestamptz{Time: t, Valid: true}
		}

		if req.EndTime != nil {
			t, _ := time.Parse(time.RFC3339, *req.EndTime)
			params.EndTime = pgtype.Timestamptz{Time: t, Valid: true}
		}

		if req.PaginationKey != nil && *req.PaginationKey != "" {
			cursorTime, cursorID, err := decodeAuditLogCursor(*req.PaginationKey)
			if err != nil {
				s.Logger(ctx).Debug("invalid pagination_key", "error", err)
				http.Error(w, "invalid pagination_key", http.StatusBadRequest)
				return
			}
			params.CursorCreatedAt = pgtype.Timestamptz{Time: cursorTime, Valid: true}
			if err := params.CursorID.Scan(cursorID); err != nil {
				http.Error(w, "invalid pagination_key", http.StatusBadRequest)
				return
			}
		}

		rows, err := s.Global.FilterAdminAuditLogs(ctx, params)
		if err != nil {
			s.Logger(ctx).Error("failed to filter admin audit logs", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		limit := int(req.EffectiveLimit())
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}

		// Build UUID→email map for actors and targets
		uuidEmailMap := make(map[string]string)
		for _, row := range rows {
			if row.ActorUserID.Valid {
				uidStr := uuidToString(row.ActorUserID)
				if _, ok := uuidEmailMap[uidStr]; !ok {
					if user, err := s.Global.GetAdminUserByID(ctx, row.ActorUserID); err == nil {
						uuidEmailMap[uidStr] = user.EmailAddress
					}
				}
			}
			if row.TargetUserID.Valid {
				uidStr := uuidToString(row.TargetUserID)
				if _, ok := uuidEmailMap[uidStr]; !ok {
					if user, err := s.Global.GetAdminUserByID(ctx, row.TargetUserID); err == nil {
						uuidEmailMap[uidStr] = user.EmailAddress
					}
				}
			}
		}

		entries := make([]auditlogs.AuditLogEntry, 0, len(rows))
		for _, row := range rows {
			entries = append(entries, adminAuditLogToEntry(row, uuidEmailMap))
		}

		var paginationKey *string
		if hasMore && len(rows) > 0 {
			last := rows[len(rows)-1]
			if last.CreatedAt.Valid {
				key := encodeAuditLogCursor(last.CreatedAt.Time, last.ID)
				paginationKey = &key
			}
		}

		resp := auditlogs.FilterAuditLogsResponse{
			AuditLogs:     entries,
			PaginationKey: paginationKey,
		}

		if err := json.NewEncoder(w).Encode(resp); err != nil {
			s.Logger(ctx).Error("failed to encode response", "error", err)
		}
	}
}

func adminAuditLogToEntry(row globaldb.AdminAuditLog, uuidEmailMap map[string]string) auditlogs.AuditLogEntry {
	entry := auditlogs.AuditLogEntry{
		EventType: row.EventType,
		IPAddress: row.IpAddress,
		CreatedAt: row.CreatedAt.Time.UTC().Format(time.RFC3339),
		EventData: make(map[string]interface{}),
	}
	if row.ActorUserID.Valid {
		uidStr := uuidToString(row.ActorUserID)
		if email, ok := uuidEmailMap[uidStr]; ok {
			entry.ActorEmail = &email
		}
	}
	if row.TargetUserID.Valid {
		uidStr := uuidToString(row.TargetUserID)
		if email, ok := uuidEmailMap[uidStr]; ok {
			entry.TargetEmail = &email
		}
	}
	if len(row.EventData) > 0 {
		json.Unmarshal(row.EventData, &entry.EventData) //nolint:errcheck
	}
	return entry
}

func uuidToString(u pgtype.UUID) string {
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func encodeAuditLogCursor(createdAt time.Time, id pgtype.UUID) string {
	idStr := uuidToString(id)
	data := fmt.Sprintf("%s|%s", createdAt.UTC().Format(time.RFC3339Nano), idStr)
	return base64.URLEncoding.EncodeToString([]byte(data))
}

func decodeAuditLogCursor(cursor string) (time.Time, string, error) {
	data, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", err
	}
	parts := strings.SplitN(string(data), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, "", fmt.Errorf("invalid cursor format")
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, "", err
	}
	return t, parts[1], nil
}
