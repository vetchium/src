package admin

import (
	"context"
	"net/http"

	"github.com/vetchium/src/typespec/admin/authorization"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
)

func GrantPermission(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request authorization.GrantPermissionRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		userID, _ := adminapi.ParseUUID(string(request.AdminUserID))
		result, err := s.Queries.GrantAdminPermission(
			r.Context(), sqlc.GrantAdminPermissionParams{
				TargetAdminUserID: userID,
				Permission:        string(request.Permission),
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "grant admin permission", err)
			return
		}
		if result == "not_found" {
			s.Problem(r.Context(), w, adminproblem.AdminUserNotFoundError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func RevokePermission(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request authorization.RevokePermissionRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		userID, _ := adminapi.ParseUUID(string(request.AdminUserID))
		result, err := s.Queries.RevokeAdminPermission(
			r.Context(), sqlc.RevokeAdminPermissionParams{
				TargetAdminUserID: userID,
				Permission:        string(request.Permission),
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "revoke admin permission", err)
			return
		}
		switch result {
		case "not_found":
			s.Problem(r.Context(), w, adminproblem.AdminUserNotFoundError)
			return
		case "not_applicable":
			s.Problem(r.Context(), w, adminproblem.PermissionNotApplicableError)
			return
		case "dependency":
			s.Problem(
				r.Context(), w,
				adminproblem.PermissionDependencyConflictError,
			)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func PromoteToSuperadmin(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request authorization.PromoteToSuperadminRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		userID, _ := adminapi.ParseUUID(string(request.AdminUserID))
		result, err := s.Queries.PromoteAdminToSuperadmin(
			r.Context(), userID,
		)
		if err != nil {
			s.InternalError(r.Context(), w, "promote admin to superadmin", err)
			return
		}
		if result == "not_found" {
			s.Problem(r.Context(), w, adminproblem.AdminUserNotFoundError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func DemoteFromSuperadmin(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request authorization.DemoteFromSuperadminRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		userID, _ := adminapi.ParseUUID(string(request.AdminUserID))
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		result, err := withAdminSuperadminInvariant(
			r.Context(), s, func(q *sqlc.Queries) (string, error) {
				return q.DemoteAdminFromSuperadmin(
					r.Context(), sqlc.DemoteAdminFromSuperadminParams{
						TargetAdminUserID: userID,
						ActorAdminUserID:  identity.UserID,
					},
				)
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "demote admin from superadmin", err)
			return
		}
		switch result {
		case "not_found":
			s.Problem(r.Context(), w, adminproblem.AdminUserNotFoundError)
			return
		case "self":
			s.Problem(
				r.Context(), w,
				adminproblem.CannotDemoteCurrentSuperadminError,
			)
			return
		case "last_superadmin":
			s.Problem(r.Context(), w, adminproblem.LastActiveSuperadminError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func withAdminSuperadminInvariant(
	ctx context.Context,
	s *adminapi.Server,
	mutation func(*sqlc.Queries) (string, error),
) (string, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	queries := sqlc.New(tx)
	if err := queries.LockAdminSuperadminInvariant(ctx); err != nil {
		return "", err
	}
	result, err := mutation(queries)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return result, nil
}

func decodeAndValidate[T any](
	s *adminapi.Server, w http.ResponseWriter, r *http.Request,
	request *T, validate func() []string,
) bool {
	if err := apiserver.DecodeJSON(r, request); err != nil {
		s.InvalidJSON(r.Context(), w, err)
		return false
	}
	if fields := validate(); len(fields) != 0 {
		s.ValidationFailed(r.Context(), w, fields)
		return false
	}
	return true
}
