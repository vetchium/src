package org

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/common"
	orgtypes "vetchium-api-server.typespec/org"
)

func MyInfo(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		employer, err := s.Global.GetOrgByID(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to fetch org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		roleRecords, err := s.Regional.GetOrgUserRoles(ctx, orgUser.OrgUserID)
		if err != nil {
			s.Logger(ctx).Error("failed to fetch org user roles", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		roles := make([]string, len(roleRecords))
		for i, role := range roleRecords {
			roles[i] = role.RoleName
		}

		response := orgtypes.OrgMyInfoResponse{
			OrgUserID:         orgUser.OrgUserID.String(),
			FullName:          orgUser.FullName.String,
			PreferredLanguage: common.LanguageCode(orgUser.PreferredLanguage),
			OrgName:           employer.OrgName,
			Roles:             roles,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
