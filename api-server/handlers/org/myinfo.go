package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
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

		primaryDomain, err := s.Global.GetPrimaryDomainByOrg(ctx, orgUser.OrgID)
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Error("failed to fetch primary domain", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			// Fallback if no primary domain found (should not happen for verified orgs)
			s.Logger(ctx).Warn("no primary domain found for org", "org_id", orgUser.OrgID)
		}

		response := orgtypes.OrgMyInfoResponse{
			FullName:          orgUser.FullName.String,
			PreferredLanguage: common.LanguageCode(orgUser.PreferredLanguage),
			OrgName:           employer.OrgName,
			OrgDomain:         common.DomainName(primaryDomain),
			Roles:             roles,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
