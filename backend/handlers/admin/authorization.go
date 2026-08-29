package admin

import (
	"net/http"

	"github.com/vetchium/src/typespec/admin/authorization"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
)

func SetPermissions(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request authorization.SetPermissionsRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		userID, _ := dbvalue.ParseUUID(string(request.AdminUserID))
		permissions := authorization.DirectPermissions(request.Permissions)
		stored := make([]string, len(permissions))
		for index, permission := range permissions {
			stored[index] = string(permission)
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		result, err := s.Queries.SetAdminPermissions(
			r.Context(), sqlc.SetAdminPermissionsParams{
				TargetAdminUserID: userID,
				Permissions:       stored,
				TenantID:          s.TenantID,
				ActorAdminUserID:  identity.UserID,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "set admin permissions", err)
			return
		}
		switch result {
		case "not_found":
			s.Problem(r.Context(), w, adminproblem.AdminUserNotFoundError)
			return
		case "last_manager":
			s.Problem(r.Context(), w, adminproblem.LastAdminManagerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
