package hub

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/common"
	hubtypes "vetchium-api-server.typespec/hub"
)

func MyInfo(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			s.Logger(ctx).Debug("hub user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		roleRecords, err := s.RegionalForCtx(ctx).GetHubUserRoles(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			s.Logger(ctx).Error("failed to fetch hub user roles", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		roles := make([]string, len(roleRecords))
		for i, role := range roleRecords {
			roles[i] = role.RoleName
		}

		response := hubtypes.HubMyInfoResponse{
			Handle:            hubtypes.Handle(hubUser.Handle),
			EmailAddress:      common.EmailAddress(hubUser.EmailAddress),
			PreferredLanguage: common.LanguageCode(hubUser.PreferredLanguage),
			Roles:             roles,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
