package admin

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
	"vetchium-api-server.typespec/common"
)

// FilterUsers handles POST /admin/filter-users
func FilterUsers(s *server.Server) http.HandlerFunc {
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

		var request admin.FilterAdminUsersRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, "invalid JSON request body", http.StatusBadRequest)
			return
		}

		if validationErrors := request.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(validationErrors)
			return
		}

		limit := defaultLimit
		if request.Limit != nil {
			limit = int(*request.Limit)
			if limit > maxLimit {
				limit = maxLimit
			}
		}

		var cursorCreatedAt pgtype.Timestamptz
		var cursorID pgtype.UUID

		if request.Cursor != nil && *request.Cursor != "" {
			ca, id, err := decodeUserCursor(*request.Cursor)
			if err != nil {
				log.Debug("invalid cursor", "error", err)
				http.Error(w, "invalid cursor format", http.StatusBadRequest)
				return
			}
			cursorCreatedAt = pgtype.Timestamptz{Time: ca, Valid: true}
			if err := cursorID.Scan(id); err != nil {
				log.Debug("invalid cursor id", "error", err)
				http.Error(w, "invalid cursor format", http.StatusBadRequest)
				return
			}
		}

		// Use pointers for sqlc.narg which generates nullable types (likely *string or pgtype.Text)
		// Assuming sqlc generates *string for sqlc.narg('foo') if using std types or specific types.
		// If it generates pgtype.Text, we use that.
		// Let's assume pgtype.Text based on previous lint error "cannot use pgtype.Text as string".
		// If we use sqlc.narg, it MIGHT generate *string depending on config.
		// But let's check global.sql.go again after generation?
		// For now, I will use pgtype.Text which is standard for null string in pgx/v5 sqlc.
		// If sqlc generates *string, simple conversion.

		var filterEmail pgtype.Text
		if request.FilterEmail != nil {
			filterEmail = pgtype.Text{String: *request.FilterEmail, Valid: true}
		}

		var filterName pgtype.Text
		if request.FilterName != nil {
			filterName = pgtype.Text{String: *request.FilterName, Valid: true}
		}

		var filterStatus pgtype.Text
		if request.FilterStatus != nil {
			filterStatus = pgtype.Text{String: *request.FilterStatus, Valid: true}
		}

		params := globaldb.FilterAdminUsersParams{
			FilterEmail:     filterEmail,
			FilterName:      filterName,
			FilterStatus:    filterStatus,
			CursorCreatedAt: cursorCreatedAt,
			CursorID:        cursorID,
			LimitCount:      int32(limit + 1),
		}

		users, err := s.Global.FilterAdminUsers(ctx, params)
		if err != nil {
			log.Error("failed to filter admin users", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(users) > limit
		if hasMore {
			users = users[:limit]
		}

		var nextCursor string
		if hasMore && len(users) > 0 {
			lastUser := users[len(users)-1]
			// Ensure CreatedAt is valid
			if lastUser.CreatedAt.Valid {
				nextCursor = encodeUserCursor(lastUser.CreatedAt.Time, lastUser.AdminUserID)
			}
		}

		responseItems := make([]admin.AdminUser, len(users))
		for i, user := range users {
			statusStr := string(user.Status) // Convert enum to string

			// Map roles
			var roles []admin.AdminRole
			for _, roleName := range user.Roles {
				roles = append(roles, admin.AdminRole(roleName))
			}

			responseItems[i] = admin.AdminUser{
				EmailAddress: common.EmailAddress(user.EmailAddress),
				Name:         user.FullName.String,
				Status:       statusStr,
				CreatedAt:    user.CreatedAt.Time.UTC().Format(time.RFC3339),
				Roles:        roles,
			}
		}

		response := admin.FilterAdminUsersResponse{
			Items:      responseItems,
			NextCursor: nextCursor,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

func encodeUserCursor(createdAt time.Time, id pgtype.UUID) string {
	idBytes := id.Bytes
	idStr := fmt.Sprintf("%x-%x-%x-%x-%x", idBytes[0:4], idBytes[4:6], idBytes[6:8], idBytes[8:10], idBytes[10:16])
	data := fmt.Sprintf("%s|%s", createdAt.UTC().Format(time.RFC3339Nano), idStr)
	return base64.URLEncoding.EncodeToString([]byte(data))
}

func decodeUserCursor(cursor string) (time.Time, string, error) {
	data, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", err
	}
	parts := strings.Split(string(data), "|")
	if len(parts) != 2 {
		return time.Time{}, "", fmt.Errorf("invalid cursor format")
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, "", err
	}
	return t, parts[1], nil
}
