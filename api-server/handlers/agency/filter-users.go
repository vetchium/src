package agency

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
	"vetchium-api-server.typespec/agency"
	"vetchium-api-server.typespec/common"
)

const (
	defaultLimit = 50
	maxLimit     = 100
)

// FilterUsers handles POST /agency/filter-users
func FilterUsers(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()
		log := s.Logger(ctx)

		agencyUser := middleware.AgencyUserFromContext(ctx)
		if agencyUser == nil {
			log.Debug("agency user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var request agency.FilterAgencyUsersRequest
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

		regionalDB := s.GetRegionalDB(agencyUser.HomeRegion)
		if regionalDB == nil {
			log.Error("regional db not found", "region", agencyUser.HomeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var filterEmail pgtype.Text
		if request.FilterEmail != nil {
			filterEmail = pgtype.Text{String: *request.FilterEmail, Valid: true}
		}

		var filterName pgtype.Text
		if request.FilterName != nil {
			filterName = pgtype.Text{String: *request.FilterName, Valid: true}
		}

		regionalParams := regionaldb.FilterAgencyUsersParams{
			AgencyID:        agencyUser.AgencyID,
			FilterEmail:     filterEmail,
			FilterName:      filterName,
			CursorCreatedAt: cursorCreatedAt,
			CursorID:        cursorID,
			LimitCount:      int32(limit + 1),
		}

		users, err := regionalDB.FilterAgencyUsers(ctx, regionalParams)
		if err != nil {
			log.Error("failed to filter agency users from regional db", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if len(users) == 0 {
			response := agency.FilterAgencyUsersResponse{
				Items:      []agency.AgencyUser{},
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

		userIDs := make([]pgtype.UUID, len(users))
		for i, u := range users {
			userIDs[i] = u.AgencyUserID
		}

		statusMap := make(map[string]string)
		statusRows, err := s.Global.GetAgencyUserStatuses(ctx, userIDs)
		if err != nil {
			log.Error("failed to get agency user statuses from global db", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		for _, row := range statusRows {
			idStr := fmt.Sprintf("%x-%x-%x-%x-%x", row.AgencyUserID.Bytes[0:4], row.AgencyUserID.Bytes[4:6], row.AgencyUserID.Bytes[6:8], row.AgencyUserID.Bytes[8:10], row.AgencyUserID.Bytes[10:16])
			statusMap[idStr] = string(row.Status)
		}

		var responseItems []agency.AgencyUser

		for i := range users {
			user := users[i]
			idStr := fmt.Sprintf("%x-%x-%x-%x-%x", user.AgencyUserID.Bytes[0:4], user.AgencyUserID.Bytes[4:6], user.AgencyUserID.Bytes[6:8], user.AgencyUserID.Bytes[8:10], user.AgencyUserID.Bytes[10:16])
			status := statusMap[idStr]
			if status == "" {
				status = "unknown"
			}

			if request.FilterStatus != nil && *request.FilterStatus != "" && status != *request.FilterStatus {
				continue
			}

			responseItems = append(responseItems, agency.AgencyUser{
				EmailAddress: common.EmailAddress(user.EmailAddress),
				Name:         user.FullName.String,
				Status:       status,
				CreatedAt:    user.CreatedAt.Time.UTC().Format(time.RFC3339),
			})
		}

		var nextCursor string
		if hasMore && len(users) > 0 {
			lastUser := users[len(users)-1]
			if lastUser.CreatedAt.Valid {
				nextCursor = encodeUserCursor(lastUser.CreatedAt.Time, lastUser.AgencyUserID)
			}
		}

		response := agency.FilterAgencyUsersResponse{
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
