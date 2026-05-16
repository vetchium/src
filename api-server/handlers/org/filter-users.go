package org

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
	"vetchium-api-server.typespec/org"
)

const (
	defaultLimit = 50
	maxLimit     = 100
)

// FilterUsers handles POST /org/filter-users
func FilterUsers(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var request org.ListOrgUsersRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, "invalid JSON request body", http.StatusBadRequest)
			return
		}

		if validationErrors := request.Validate(); len(validationErrors) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", validationErrors)
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

		if request.PaginationKey != nil && *request.PaginationKey != "" {
			ca, id, err := decodeUserCursor(*request.PaginationKey)
			if err != nil {
				s.Logger(ctx).Debug("invalid cursor", "error", err)
				http.Error(w, "invalid cursor format", http.StatusBadRequest)
				return
			}
			cursorCreatedAt = pgtype.Timestamp{Time: ca, Valid: true}
			if err := cursorID.Scan(id); err != nil {
				s.Logger(ctx).Debug("invalid cursor id", "error", err)
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

		var filterStatus pgtype.Text
		if request.FilterStatus != nil {
			filterStatus = pgtype.Text{String: *request.FilterStatus, Valid: true}
		}

		// Query Regional DB for users
		regionalParams := regionaldb.FilterOrgUsersParams{
			OrgID:           orgUser.OrgID,
			FilterEmail:     filterEmail,
			FilterName:      filterName,
			FilterStatus:    filterStatus,
			CursorCreatedAt: cursorCreatedAt,
			CursorID:        cursorID,
			LimitCount:      int32(limit + 1),
		}

		users, err := s.RegionalForCtx(ctx).FilterOrgUsers(ctx, regionalParams)
		if err != nil {
			s.Logger(ctx).Error("failed to filter org users from regional db", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if len(users) == 0 {
			response := org.ListOrgUsersResponse{
				Users:             []org.OrgUser{},
				NextPaginationKey: "",
			}
			if err := json.NewEncoder(w).Encode(response); err != nil {
				s.Logger(ctx).Error("failed to encode response", "error", err)
			}
			return
		}

		hasMore := len(users) > limit
		if hasMore {
			users = users[:limit]
		}

		responseUsers := make([]org.OrgUser, 0, len(users))
		for i := range users {
			user := users[i]
			var roles []org.OrgRole
			for _, r := range user.Roles {
				roles = append(roles, org.OrgRole(r))
			}
			responseUsers = append(responseUsers, org.OrgUser{
				EmailAddress: common.EmailAddress(user.EmailAddress),
				Name:         user.FullName.String,
				Status:       string(user.Status),
				CreatedAt:    user.CreatedAt.Time.UTC().Format(time.RFC3339),
				Roles:        roles,
			})
		}

		var nextPaginationKey string
		if hasMore && len(users) > 0 {
			lastUser := users[len(users)-1]
			if lastUser.CreatedAt.Valid {
				nextPaginationKey = encodeUserCursor(lastUser.CreatedAt.Time, lastUser.OrgUserID)
			}
		}

		response := org.ListOrgUsersResponse{
			Users:             responseUsers,
			NextPaginationKey: nextPaginationKey,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("failed to encode response", "error", err)
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
