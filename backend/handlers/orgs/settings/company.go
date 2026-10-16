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

func SetCompanyDetails(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request settingsspec.SetCompanyDetailsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx := r.Context()
		identity, _ := middleware.OrgIdentityFromContext(ctx)
		state, err := s.Queries.SetOrgCompanyDetails(
			ctx, sqlc.SetOrgCompanyDetailsParams{
				OrgDid:          identity.OrgDID,
				DisplayName:     string(request.DisplayName),
				Country:         string(request.Country),
				DefaultLanguage: string(request.DefaultLanguage),
				TenantID:        s.TenantID,
				ActorOrgUserID:  identity.UserID,
			},
		)
		if err != nil {
			s.InternalError(ctx, w, "set company details", err)
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
