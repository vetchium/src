package settings

import (
	"net/http"

	settingsspec "github.com/vetchium/src/typespec/orgs/settings"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

func SetCompanyName(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request settingsspec.SetCompanyNameRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx := r.Context()
		identity, _ := middleware.OrgIdentityFromContext(ctx)
		state, err := s.Queries.SetOrgCompanyName(
			ctx, sqlc.SetOrgCompanyNameParams{
				OrgDid:         identity.OrgDID,
				DisplayName:    string(request.DisplayName),
				TenantID:       s.TenantID,
				ActorOrgUserID: identity.UserID,
			},
		)
		if err != nil {
			s.InternalError(ctx, w, "set company name", err)
			return
		}
		if state != sqlc.VetchiumOrgStateActive {
			s.Problem(ctx, w, orgsproblem.OrgSuspendedError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.Empty(ctx, w, http.StatusNoContent)
	}
}
