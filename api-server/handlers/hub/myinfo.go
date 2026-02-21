package hub

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/common"
	hubtypes "vetchium-api-server.typespec/hub"
)

func MyInfo(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			log.Debug("hub user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		roleRecords, err := s.Regional.GetHubUserRoles(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			log.Error("failed to fetch hub user roles", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		roles := make([]string, len(roleRecords))
		for i, role := range roleRecords {
			roles[i] = role.RoleName
		}

		response := hubtypes.HubMyInfoResponse{
			HubUserID:         hubUser.HubUserGlobalID.String(),
			Handle:            hubtypes.Handle(hubUser.Handle),
			EmailAddress:      common.EmailAddress(hubUser.EmailAddress),
			PreferredLanguage: common.LanguageCode(hubUser.PreferredLanguage),
			Roles:             roles,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
