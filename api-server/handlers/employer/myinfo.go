package employer

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/common"
	employertypes "vetchium-api-server.typespec/employer"
)

func MyInfo(s *server.Server) http.HandlerFunc {
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

		employer, err := s.Global.GetEmployerByID(ctx, orgUser.EmployerID)
		if err != nil {
			log.Error("failed to fetch employer", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		roleRecords, err := s.Regional.GetOrgUserRoles(ctx, orgUser.OrgUserID)
		if err != nil {
			log.Error("failed to fetch org user roles", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		roles := make([]string, len(roleRecords))
		for i, role := range roleRecords {
			roles[i] = role.RoleName
		}

		response := employertypes.OrgMyInfoResponse{
			OrgUserID:         orgUser.OrgUserID.String(),
			FullName:          orgUser.FullName.String,
			PreferredLanguage: common.LanguageCode(orgUser.PreferredLanguage),
			EmployerName:      employer.EmployerName,
			Roles:             roles,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
