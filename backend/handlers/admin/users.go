package admin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	adminspec "github.com/vetchium/src/typespec/admin"
	"github.com/vetchium/src/typespec/admin/authorization"
	"github.com/vetchium/src/typespec/admin/user"
	"github.com/vetchium/src/typespec/admin/users"
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
)

const adminUsersPaginationPurpose = "admin-list-users-v1"

type adminUsersPaginationPayload struct {
	BeforeCreatedAt time.Time `json:"before_created_at"`
	BeforeUserID    string    `json:"before_user_id"`
	FiltersHash     string    `json:"filters_hash"`
}

func ListUsers(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.ListUsersRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		filtersHash, err := listUsersFiltersHash(request)
		if err != nil {
			s.InternalError(r.Context(), w, "hash list-users filters", err)
			return
		}
		params := sqlc.ListAdminUsersParams{
			PageLimit: int32(request.EffectiveLimit()) + 1,
		}
		applyListUsersFilters(&params, request)
		if request.PaginationKey != nil {
			if !applyAdminUsersPaginationKey(
				s, &params, string(*request.PaginationKey), filtersHash,
			) {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
		}
		rows, err := s.Queries.ListAdminUsers(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list admin users", err)
			return
		}
		limit := int(request.EffectiveLimit())
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := users.ListUsersResponse{
			Users: make([]users.AdminUserSummary, 0, len(rows)),
		}
		for _, row := range rows {
			response.Users = append(response.Users, adminUserSummary(row))
		}
		if hasMore {
			last := rows[len(rows)-1]
			payload, err := json.Marshal(adminUsersPaginationPayload{
				BeforeCreatedAt: last.CreatedAt.Time.UTC(),
				BeforeUserID:    adminapi.FormatUUID(last.AdminUserID),
				FiltersHash:     filtersHash,
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode pagination key", err)
				return
			}
			key := common.PaginationKey(adminapi.SignValue(
				s.CredentialSubkey("pagination"), adminUsersPaginationPurpose, payload,
			))
			response.NextPaginationKey = &key
		}
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func DisableUser(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.DisableUserRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		targetID, _ := adminapi.ParseUUID(string(request.AdminUserID))
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		result, err := s.Queries.DisableAdminUser(
			r.Context(), sqlc.DisableAdminUserParams{
				TargetAdminUserID: targetID,
				ActorAdminUserID:  identity.UserID,
				TenantID:          s.TenantID,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "disable admin user", err)
			return
		}
		if writeAdminUserMutationProblem(s, w, r, result) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func EnableUser(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.EnableUserRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		targetID, _ := adminapi.ParseUUID(string(request.AdminUserID))
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		result, err := s.Queries.EnableAdminUser(
			r.Context(), sqlc.EnableAdminUserParams{
				TargetAdminUserID: targetID,
				TenantID:          s.TenantID,
				ActorAdminUserID:  identity.UserID,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "enable admin user", err)
			return
		}
		if writeAdminUserMutationProblem(s, w, r, result) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func writeAdminUserMutationProblem(
	s *adminapi.Server, w http.ResponseWriter, r *http.Request,
	result string,
) bool {
	switch result {
	case "not_found":
		s.Problem(r.Context(), w, adminproblem.AdminUserNotFoundError)
	case "self":
		s.Problem(r.Context(), w, adminproblem.CannotDisableCurrentAdminError)
	case "last_manager":
		s.Problem(r.Context(), w, adminproblem.LastAdminManagerError)
	default:
		return false
	}
	return true
}

func applyListUsersFilters(
	params *sqlc.ListAdminUsersParams, request users.ListUsersRequest,
) {
	if request.FilterSearch != nil {
		params.FilterSearch = adminapi.Text(pointer(
			strings.ToLower(string(*request.FilterSearch)),
		))
	}
	if request.FilterState != nil {
		params.FilterState = sqlc.NullVetchiumAdminUserState{
			VetchiumAdminUserState: sqlc.VetchiumAdminUserState(*request.FilterState),
			Valid:                  true,
		}
	}
	if len(request.FilterPermissions) != 0 {
		params.FilterPermissions = make([]string, len(request.FilterPermissions))
		for index, permission := range request.FilterPermissions {
			params.FilterPermissions[index] = string(permission)
		}
	}
	params.FilterNoPermissions = adminapi.Bool(request.FilterNoPermissions)
	params.FilterTotpEnabled = adminapi.Bool(request.FilterTOTPEnabled)
	if request.FilterLastLogin != nil {
		params.FilterLastLogin = adminapi.Text(pointer(
			string(*request.FilterLastLogin),
		))
	}
}

func listUsersFiltersHash(request users.ListUsersRequest) (string, error) {
	permissions := slices.Sorted(slices.Values(request.FilterPermissions))
	payload, err := json.Marshal(struct {
		Search        *users.AdminUserFilterText        `json:"search"`
		State         *user.State                       `json:"state"`
		Permissions   []authorization.AdminPermissionID `json:"permissions"`
		NoPermissions *bool                             `json:"no_permissions"`
		TOTPEnabled   *bool                             `json:"totp_enabled"`
		LastLogin     *users.AdminLastLoginFilter       `json:"last_login"`
	}{
		Search:        normalizeFilter(request.FilterSearch),
		State:         request.FilterState,
		Permissions:   permissions,
		NoPermissions: request.FilterNoPermissions,
		TOTPEnabled:   request.FilterTOTPEnabled,
		LastLogin:     request.FilterLastLogin,
	})
	if err != nil {
		return "", err
	}
	digest := adminapi.CanonicalDigest(payload)
	return base64.RawURLEncoding.EncodeToString(digest[:]), nil
}

func normalizeFilter(
	value *users.AdminUserFilterText,
) *users.AdminUserFilterText {
	if value == nil {
		return nil
	}
	normalized := users.AdminUserFilterText(strings.ToLower(string(*value)))
	return &normalized
}

func applyAdminUsersPaginationKey(
	s *adminapi.Server, params *sqlc.ListAdminUsersParams,
	key, filtersHash string,
) bool {
	payload, ok := adminapi.VerifySignedValue(
		s.CredentialSubkey("pagination"), adminUsersPaginationPurpose, key,
	)
	if !ok {
		return false
	}
	var decoded adminUsersPaginationPayload
	if err := json.Unmarshal(payload, &decoded); err != nil ||
		decoded.FiltersHash != filtersHash || decoded.BeforeCreatedAt.IsZero() {
		return false
	}
	userID, err := adminapi.ParseUUID(decoded.BeforeUserID)
	if err != nil {
		return false
	}
	params.BeforeCreatedAt = pgtype.Timestamptz{
		Time: decoded.BeforeCreatedAt, Valid: true,
	}
	params.BeforeAdminUserID = userID
	return true
}

func adminUserSummary(
	row sqlc.ListAdminUsersRow,
) users.AdminUserSummary {
	permissions := make([]authorization.AdminPermissionID, len(row.Permissions))
	for index, permission := range row.Permissions {
		permissions[index] = authorization.AdminPermissionID(permission)
	}
	result := users.AdminUserSummary{
		AdminUserID: adminspec.AdminUserID(
			adminapi.FormatUUID(row.AdminUserID),
		),
		EmailAddress: common.EmailAddress(row.EmailAddress),
		DisplayName:  common.DisplayName(row.DisplayName),
		State:        user.State(row.AdminUserState),
		AdminAuthorization: authorization.AdminAuthorization{
			Permissions: permissions,
		},
		TOTPEnabled: row.TotpEnabled,
		CreatedAt:   row.CreatedAt.Time.UTC(),
	}
	if row.LastLoginAt.Valid {
		lastLoginAt := row.LastLoginAt.Time.UTC()
		result.LastLoginAt = &lastLoginAt
	}
	return result
}

func pointer[T any](value T) *T {
	return &value
}
