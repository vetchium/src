package admin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/admin/authorization"
	admincommon "github.com/vetchium/src/typespec/admin/common"
	"github.com/vetchium/src/typespec/admin/user"
	"github.com/vetchium/src/typespec/admin/users"
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
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
		if err := apiserver.DecodeJSON(r, &request); err != nil {
			s.InvalidJSON(r.Context(), w, err)
			return
		}
		if fields := request.Validate(); len(fields) != 0 {
			s.ValidationFailed(r.Context(), w, fields)
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
			summary, err := adminUserSummary(row)
			if err != nil {
				s.InternalError(r.Context(), w, "decode admin user summary", err)
				return
			}
			response.Users = append(response.Users, summary)
		}
		if hasMore {
			last := rows[len(rows)-1]
			payload, err := json.Marshal(adminUsersPaginationPayload{
				BeforeCreatedAt: last.CreatedAt.Time,
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
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		targetID, _ := adminapi.ParseUUID(string(request.AdminUserID))
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		result, err := withAdminSuperadminInvariant(
			r.Context(), s, func(q *sqlc.Queries) (string, error) {
				return q.DisableAdminUser(
					r.Context(), sqlc.DisableAdminUserParams{
						TargetAdminUserID: targetID,
						ActorAdminUserID:  identity.UserID,
						ActorIsSuperadmin: identity.IsSuperadmin,
					},
				)
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
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		targetID, _ := adminapi.ParseUUID(string(request.AdminUserID))
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		result, err := s.Queries.EnableAdminUser(
			r.Context(), sqlc.EnableAdminUserParams{
				TargetAdminUserID: targetID,
				ActorIsSuperadmin: identity.IsSuperadmin,
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
	case "superadmin_required":
		s.Problem(r.Context(), w, adminproblem.SuperadminRequiredError)
	case "last_superadmin":
		s.Problem(r.Context(), w, adminproblem.LastActiveSuperadminError)
	default:
		return false
	}
	return true
}

func applyListUsersFilters(
	params *sqlc.ListAdminUsersParams, request users.ListUsersRequest,
) {
	if request.FilterEmailAddress != nil {
		params.FilterEmailAddress = adminapi.Text(pointer(
			strings.ToLower(string(*request.FilterEmailAddress)),
		))
	}
	if request.FilterDisplayName != nil {
		params.FilterDisplayName = adminapi.Text(pointer(
			strings.ToLower(string(*request.FilterDisplayName)),
		))
	}
	if request.FilterState != nil {
		params.FilterState = sqlc.NullVetchiumAdminUserState{
			VetchiumAdminUserState: sqlc.VetchiumAdminUserState(*request.FilterState),
			Valid:                  true,
		}
	}
	params.FilterIsSuperadmin = adminapi.Bool(request.FilterIsSuperadmin)
	if request.FilterPermission != nil {
		params.FilterPermission = adminapi.Text(pointer(
			string(*request.FilterPermission),
		))
	}
}

func listUsersFiltersHash(request users.ListUsersRequest) (string, error) {
	payload, err := json.Marshal(struct {
		EmailAddress *users.AdminUserFilterText     `json:"email_address"`
		DisplayName  *users.AdminUserFilterText     `json:"display_name"`
		State        *user.State                    `json:"state"`
		Superadmin   *bool                          `json:"superadmin"`
		Permission   *authorization.AdminPermission `json:"permission"`
	}{
		EmailAddress: normalizeFilter(request.FilterEmailAddress),
		DisplayName:  normalizeFilter(request.FilterDisplayName),
		State:        request.FilterState,
		Superadmin:   request.FilterIsSuperadmin,
		Permission:   request.FilterPermission,
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
) (users.AdminUserSummary, error) {
	displayNames := make([]common.LocalizedDisplayName, 0)
	if err := json.Unmarshal(
		[]byte(row.DisplayNamesJson), &displayNames,
	); err != nil {
		return users.AdminUserSummary{}, err
	}
	permissions := make([]authorization.AdminPermissionID, len(row.Permissions))
	for index, permission := range row.Permissions {
		permissions[index] = authorization.AdminPermissionID(permission)
	}
	result := users.AdminUserSummary{
		AdminUserID: admincommon.AdminUserID(
			adminapi.FormatUUID(row.AdminUserID),
		),
		EmailAddress:               common.EmailAddress(row.EmailAddress),
		DisplayNames:               displayNames,
		PrimaryDisplayNameLanguage: common.RegionalLanguageCode(row.PrimaryDisplayNameLanguage),
		State:                      user.State(row.AdminUserState),
		AdminAuthorization: authorization.AdminAuthorization{
			IsSuperadmin: row.IsSuperadmin,
			Permissions:  permissions,
		},
		TOTPEnabled: row.TotpEnabled,
		CreatedAt:   row.CreatedAt.Time,
	}
	if row.LastLoginAt.Valid {
		lastLoginAt := row.LastLoginAt.Time
		result.LastLoginAt = &lastLoginAt
	}
	return result, nil
}

func pointer[T any](value T) *T {
	return &value
}
