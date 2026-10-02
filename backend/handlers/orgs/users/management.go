package users

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/authorization"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	"github.com/vetchium/src/typespec/orgs/users"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	orgusers "backend/internal/orgs/users"
)

const usersPaginationPurpose = "orgs-list-users-v1"

type usersPaginationPayload struct {
	AfterEmailAddress string    `json:"after_email_address"`
	AfterJoinedAt     time.Time `json:"after_joined_at"`
	FiltersHash       string    `json:"filters_hash"`
}

func listUsersFiltersHash(request users.ListUsersRequest) string {
	parts := []string{
		string(request.EffectiveSortBy()),
		strconv.FormatBool(request.Descending()),
	}
	if request.FilterSearch != nil {
		parts = append(parts, "search="+strings.ToLower(
			strings.TrimSpace(string(*request.FilterSearch)),
		))
	}
	if request.FilterState != nil {
		parts = append(parts, "state="+string(*request.FilterState))
	}
	if request.FilterPermission != nil {
		parts = append(parts, "permission="+string(*request.FilterPermission))
	}
	if request.FilterNoPermissions != nil && *request.FilterNoPermissions {
		parts = append(parts, "none")
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func permissionIDs(values []string) []authorization.OrgPermissionID {
	result := make([]authorization.OrgPermissionID, len(values))
	for index, value := range values {
		result[index] = authorization.OrgPermissionID(value)
	}
	return result
}

func ListUsers(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.ListUsersRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		filtersHash := listUsersFiltersHash(request)
		params := sqlc.ListOrgUsersParams{
			OrgDid:        identity.OrgDID,
			SortBy:        string(request.EffectiveSortBy()),
			Descending:    request.Descending(),
			NoPermissions: request.FilterNoPermissions != nil && *request.FilterNoPermissions,
			PageLimit:     int32(request.EffectiveLimit()) + 1,
		}
		if request.FilterSearch != nil {
			params.Search = dbvalue.Text(strings.ToLower(
				strings.TrimSpace(string(*request.FilterSearch)),
			))
		}
		if request.FilterState != nil {
			params.StateFilter = dbvalue.Text(string(*request.FilterState))
		}
		if request.FilterPermission != nil {
			params.PermissionFilter = dbvalue.Text(string(*request.FilterPermission))
		}
		if request.PaginationKey != nil {
			payload, ok := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), usersPaginationPurpose,
				string(*request.PaginationKey),
			)
			var decoded usersPaginationPayload
			if !ok || json.Unmarshal(payload, &decoded) != nil ||
				decoded.FiltersHash != filtersHash ||
				decoded.AfterEmailAddress == "" || decoded.AfterJoinedAt.IsZero() {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.AfterEmailAddress = dbvalue.Text(decoded.AfterEmailAddress)
			params.AfterCreatedAt = dbvalue.Timestamp(decoded.AfterJoinedAt)
		}
		rows, err := s.Queries.ListOrgUsers(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list Org users", err)
			return
		}
		limit := int(request.EffectiveLimit())
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := users.ListUsersResponse{
			Users: make([]users.OrgUserSummary, 0, len(rows)),
		}
		for _, row := range rows {
			summary := users.OrgUserSummary{
				EmailAddress:         common.EmailAddress(row.EmailAddress),
				State:                users.OrgUserState(row.OrgUserState),
				GrantedPermissions:   permissionIDs(row.GrantedPermissions),
				EffectivePermissions: permissionIDs(row.EffectivePermissions),
				JoinedAt:             row.CreatedAt.Time.UTC(),
				LastLoginAt:          dbvalue.TimePtr(row.LastLoginAt),
			}
			if row.DisabledReason.Valid {
				reason := users.DisabledReason(row.DisabledReason.String)
				summary.DisabledReason = &reason
			}
			response.Users = append(response.Users, summary)
		}
		if hasMore {
			last := rows[len(rows)-1]
			payload, err := json.Marshal(usersPaginationPayload{
				AfterEmailAddress: last.EmailAddress,
				AfterJoinedAt:     last.CreatedAt.Time.UTC(),
				FiltersHash:       filtersHash,
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode pagination key", err)
				return
			}
			key := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"), usersPaginationPurpose, payload,
			))
			response.NextPaginationKey = &key
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func UserSummary(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		summary, err := s.Queries.GetOrgUserSummary(r.Context(), identity.OrgDID)
		if err != nil {
			s.InternalError(r.Context(), w, "get Org user summary", err)
			return
		}
		counts, err := s.Queries.ListOrgPermissionCounts(r.Context(), identity.OrgDID)
		if err != nil {
			s.InternalError(r.Context(), w, "count Org permissions", err)
			return
		}
		response := users.UserSummaryResponse{
			SeatsInUse:                    int32(summary.SeatsInUse),
			ActiveUsers:                   int32(summary.ActiveUsers),
			DisabledManualUsers:           int32(summary.DisabledManualUsers),
			DisabledNonpaymentUsers:       int32(summary.DisabledNonpaymentUsers),
			ActiveUsersWithoutPermissions: int32(summary.ActiveUsersWithoutPermissions),
			PermissionCounts:              make([]users.PermissionCount, 0, len(counts)),
		}
		if limit, unlimited := orgusers.SeatLimit(
			subscriptionspec.PlanOID(summary.OrgPlanOid), nil, false,
		); !unlimited {
			value := int32(limit)
			response.SeatLimit = &value
		}
		for _, count := range counts {
			response.PermissionCounts = append(
				response.PermissionCounts, users.PermissionCount{
					Permission: authorization.OrgPermissionID(count.Permission),
					Users:      int32(count.Users),
				},
			)
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func ListPermissions(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Queries.ListOrgPermissionCatalog(r.Context())
		if err != nil {
			s.InternalError(r.Context(), w, "list Org permissions", err)
			return
		}
		response := authorization.ListPermissionsResponse{
			Permissions: make([]authorization.PermissionDescriptor, 0, len(rows)),
		}
		for _, row := range rows {
			response.Permissions = append(
				response.Permissions, authorization.PermissionDescriptor{
					Permission: authorization.OrgPermissionID(row.Permission),
					Implies:    permissionIDs(row.Implies),
				},
			)
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}

// change is one all-or-nothing operation on a set of users, run in a single
// transaction under the Org row lock (D28).
type change struct {
	emails []string
	// refuseSelf rejects a set that includes the caller (D38).
	refuseSelf bool
	// apply writes the change and reports a refusal, if any. The targets are
	// in request order.
	apply func(
		ctx context.Context, q *sqlc.Queries, identity middleware.OrgIdentity,
		plan string, targets []sqlc.GetOrgUsersForChangeRow,
	) (problem.Body, error)
}

func runChange(
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request, c change,
) {
	ctx := r.Context()
	identity, _ := middleware.OrgIdentityFromContext(ctx)
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		s.InternalError(ctx, w, "begin Org user change", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	refused, err := func() (problem.Body, error) {
		policy, err := q.LockOrgSeatPolicy(ctx, identity.OrgDID)
		if errors.Is(err, pgx.ErrNoRows) {
			return orgsproblem.OrgSuspendedError, nil
		}
		if err != nil {
			return nil, err
		}
		targets, err := q.GetOrgUsersForChange(ctx, sqlc.GetOrgUsersForChangeParams{
			OrgDid: identity.OrgDID, EmailAddresses: c.emails,
		})
		if err != nil {
			return nil, err
		}
		present := make(map[string]bool, len(targets))
		for _, target := range targets {
			present[target.EmailAddress] = true
		}
		for _, email := range c.emails {
			if !present[email] {
				return orgsproblem.UserNotFoundError(email), nil
			}
		}
		if c.refuseSelf {
			for _, target := range targets {
				if target.OrgUserID == identity.UserID {
					return orgsproblem.SelfChangeForbiddenError, nil
				}
			}
		}
		return c.apply(ctx, q, identity, policy.OrgPlanOid, targets)
	}()
	if err != nil {
		s.InternalError(ctx, w, "change Org users", err)
		return
	}
	if refused != nil {
		s.Problem(ctx, w, refused)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		s.InternalError(ctx, w, "commit Org user change", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.Empty(ctx, w, http.StatusNoContent)
}

func addresses(values []common.EmailAddress) []string {
	result := make([]string, len(values))
	for index, value := range values {
		result[index] = string(value)
	}
	return result
}

func userIDs(targets []sqlc.GetOrgUsersForChangeRow) []pgtype.UUID {
	result := make([]pgtype.UUID, len(targets))
	for index, target := range targets {
		result[index] = target.OrgUserID
	}
	return result
}

func isSuperadmin(permissions []string) bool {
	return slices.Contains(permissions, string(authorization.Superadmin))
}

// requireSuperadminForSuperadmins implements D17: only a superadmin may
// disable or re-enable a user holding org:superadmin.
func requireSuperadminForSuperadmins(
	identity middleware.OrgIdentity, targets []sqlc.GetOrgUsersForChangeRow,
) problem.Body {
	if isSuperadmin(identity.Permissions) {
		return nil
	}
	for _, target := range targets {
		if isSuperadmin(target.GrantedPermissions) {
			return orgsproblem.SuperadminRequiredError(target.EmailAddress)
		}
	}
	return nil
}

func disable(s *orgsruntime.Server, w http.ResponseWriter, r *http.Request, emails []string) {
	runChange(s, w, r, change{
		emails: emails, refuseSelf: true,
		apply: func(
			ctx context.Context, q *sqlc.Queries, identity middleware.OrgIdentity,
			_ string, targets []sqlc.GetOrgUsersForChangeRow,
		) (problem.Body, error) {
			if refused := requireSuperadminForSuperadmins(identity, targets); refused != nil {
				return refused, nil
			}
			result, err := q.DisableOrgUsers(ctx, sqlc.DisableOrgUsersParams{
				OrgDid:         identity.OrgDID,
				OrgUserIds:     userIDs(targets),
				ActorOrgUserID: identity.UserID,
				TenantID:       s.TenantID,
			})
			if err != nil {
				return nil, err
			}
			if result == "last-superadmin" {
				return orgsproblem.LastSuperadminError, nil
			}
			return nil, nil
		},
	})
}

func enable(s *orgsruntime.Server, w http.ResponseWriter, r *http.Request, emails []string) {
	runChange(s, w, r, change{
		emails: emails,
		apply: func(
			ctx context.Context, q *sqlc.Queries, identity middleware.OrgIdentity,
			plan string, targets []sqlc.GetOrgUsersForChangeRow,
		) (problem.Body, error) {
			if refused := requireSuperadminForSuperadmins(identity, targets); refused != nil {
				return refused, nil
			}
			limit, limitValue := seatLimit(plan)
			result, err := q.EnableOrgUsers(ctx, sqlc.EnableOrgUsersParams{
				OrgDid:         identity.OrgDID,
				OrgUserIds:     userIDs(targets),
				SeatLimit:      limit,
				ActorOrgUserID: dbvalue.FormatUUID(identity.UserID),
				TenantID:       s.TenantID,
			})
			if err != nil {
				return nil, err
			}
			if result == "limit-reached" {
				return orgsproblem.UserLimitReachedError(limitValue), nil
			}
			return nil, nil
		},
	})
}

func setPermissions(
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request,
	emails []string, requested []authorization.OrgPermissionID,
) {
	granted := authorization.DirectPermissions(requested)
	grants := make([]string, len(granted))
	for index, permission := range granted {
		grants[index] = string(permission)
	}
	runChange(s, w, r, change{
		emails: emails, refuseSelf: true,
		apply: func(
			ctx context.Context, q *sqlc.Queries, identity middleware.OrgIdentity,
			_ string, targets []sqlc.GetOrgUsersForChangeRow,
		) (problem.Body, error) {
			// Granting and revoking are both delegated: the grants that
			// differ between what a user holds and what it will hold must be
			// ones the caller may hand out.
			for _, target := range targets {
				changed := symmetricDifference(target.GrantedPermissions, grants)
				if !orgusers.CanGrant(identity.Permissions, permissionIDs(changed)) {
					return orgsproblem.SuperadminRequiredError(target.EmailAddress), nil
				}
			}
			result, err := q.SetOrgUserPermissions(ctx, sqlc.SetOrgUserPermissionsParams{
				OrgDid:         identity.OrgDID,
				OrgUserIds:     userIDs(targets),
				Permissions:    grants,
				ActorOrgUserID: dbvalue.FormatUUID(identity.UserID),
				TenantID:       s.TenantID,
			})
			if err != nil {
				return nil, err
			}
			if result == "last-superadmin" {
				return orgsproblem.LastSuperadminError, nil
			}
			return nil, nil
		},
	})
}

func symmetricDifference(a, b []string) []string {
	var result []string
	for _, value := range a {
		if !slices.Contains(b, value) {
			result = append(result, value)
		}
	}
	for _, value := range b {
		if !slices.Contains(a, value) {
			result = append(result, value)
		}
	}
	return result
}

func DisableUser(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.DisableUserRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		disable(s, w, r, []string{string(request.EmailAddress)})
	}
}

func BulkDisableUsers(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.BulkDisableUsersRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		disable(s, w, r, addresses(request.EmailAddresses))
	}
}

func EnableUser(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.EnableUserRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		enable(s, w, r, []string{string(request.EmailAddress)})
	}
}

func BulkEnableUsers(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.BulkEnableUsersRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		enable(s, w, r, addresses(request.EmailAddresses))
	}
}

func SetUserPermissions(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.SetUserPermissionsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		setPermissions(
			s, w, r, []string{string(request.EmailAddress)}, request.Permissions,
		)
	}
}

func BulkSetUserPermissions(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request users.BulkSetUserPermissionsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		setPermissions(s, w, r, addresses(request.EmailAddresses), request.Permissions)
	}
}
