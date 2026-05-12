package org

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/db/regionaldb"
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

		// One global round-trip: org name + primary domain.
		orgInfo, err := s.Global.GetOrgWithPrimaryDomain(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to fetch org with primary domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// One regional round-trip: roles + failing-domain warning.
		regionalInfo, err := s.Regional.GetOrgUserRolesWithDomainWarning(ctx, regionaldb.GetOrgUserRolesWithDomainWarningParams{
			OrgUserID: orgUser.OrgUserID,
			OrgID:     orgUser.OrgID,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to fetch org user roles", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if orgInfo.PrimaryDomain == "" {
			s.Logger(ctx).Warn("no primary domain found for org", "org_id", orgUser.OrgID)
		}

		response := orgtypes.OrgMyInfoResponse{
			FullName:          orgUser.FullName.String,
			PreferredLanguage: common.LanguageCode(orgUser.PreferredLanguage),
			OrgName:           orgInfo.OrgName,
			OrgDomain:         common.DomainName(orgInfo.PrimaryDomain),
			Roles:             regionalInfo.Roles,
			HasFailingDomains: regionalInfo.HasFailingDomains,
			EmailAddress:      common.EmailAddress(orgUser.EmailAddress),
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
