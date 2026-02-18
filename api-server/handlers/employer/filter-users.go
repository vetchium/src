package employer

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/common"
	"vetchium-api-server.typespec/employer"
)

const (
	defaultLimit = 50
	maxLimit     = 100
)

// FilterUsers handles POST /employer/filter-users
func FilterUsers(s *server.Server) http.HandlerFunc {
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

		var request employer.FilterOrgUsersRequest
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

		var cursorCreatedAt pgtype.Timestamp
		var cursorID pgtype.UUID

		if request.Cursor != nil && *request.Cursor != "" {
			ca, id, err := decodeUserCursor(*request.Cursor)
			if err != nil {
				log.Debug("invalid cursor", "error", err)
				http.Error(w, "invalid cursor format", http.StatusBadRequest)
				return
			}
			cursorCreatedAt = pgtype.Timestamp{Time: ca, Valid: true}
			if err := cursorID.Scan(id); err != nil {
				log.Debug("invalid cursor id", "error", err)
				http.Error(w, "invalid cursor format", http.StatusBadRequest)
				return
			}
		}

		var filterEmail pgtype.Text
		if request.FilterEmail != nil {
			filterEmail = pgtype.Text{String: *request.FilterEmail, Valid: true}
		}

		var filterName pgtype.Text
		if request.FilterName != nil {
			filterName = pgtype.Text{String: *request.FilterName, Valid: true}
		}

		// Query Regional DB for items
		regionalParams := regionaldb.FilterOrgUsersParams{
			EmployerID:      orgUser.EmployerID,
			FilterEmail:     filterEmail,
			FilterName:      filterName,
			CursorCreatedAt: cursorCreatedAt,
			CursorID:        cursorID,
			LimitCount:      int32(limit + 1),
		}

		users, err := s.Regional.FilterOrgUsers(ctx, regionalParams)
		if err != nil {
			log.Error("failed to filter org users from regional db", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if len(users) == 0 {
			// No users found in regional request means nothing to return
			response := employer.FilterOrgUsersResponse{
				Items:      []employer.OrgUser{},
				NextCursor: "",
			}
			if err := json.NewEncoder(w).Encode(response); err != nil {
				log.Error("failed to encode response", "error", err)
			}
			return
		}

		hasMore := len(users) > limit
		if hasMore {
			users = users[:limit]
		}

		// Construct response items, applying status filter if present
		// Status is now available directly from the regional FilterOrgUsers result
		var responseItems []employer.OrgUser

		for i := range users {
			user := users[i]
			status := string(user.Status)

			if request.FilterStatus != nil && *request.FilterStatus != "" && status != *request.FilterStatus {
				// Skip this user as status doesn't match
				continue
			}

			var roles []employer.OrgRole
			for _, r := range user.Roles {
				roles = append(roles, employer.OrgRole(r))
			}

			responseItems = append(responseItems, employer.OrgUser{
				EmailAddress: common.EmailAddress(user.EmailAddress),
				Name:         user.FullName.String,
				Status:       status,
				CreatedAt:    user.CreatedAt.Time.UTC().Format(time.RFC3339),
				Roles:        roles,
			})
		}

		var nextCursor string
		if hasMore && len(users) > 0 {
			lastUser := users[len(users)-1]
			if lastUser.CreatedAt.Valid {
				nextCursor = encodeUserCursor(lastUser.CreatedAt.Time, lastUser.OrgUserID)
			}
		}

		response := employer.FilterOrgUsersResponse{
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
