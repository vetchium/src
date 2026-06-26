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

		// One regional round-trip: plan capabilities + aggregated role names.
		info, err := s.RegionalForCtx(ctx).GetHubUserPlanAndRoles(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			s.Logger(ctx).Error("failed to fetch hub user plan and roles", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		roles := make([]string, 0, len(info.Roles))
		roles = append(roles, info.Roles...)

		response := hubtypes.HubMyInfoResponse{
			Handle:                  hubtypes.Handle(hubUser.Handle),
			EmailAddress:            common.EmailAddress(hubUser.EmailAddress),
			PreferredLanguage:       common.LanguageCode(hubUser.PreferredLanguage),
			HomeRegion:              middleware.HubRegionFromContext(ctx),
			Roles:                   roles,
			PlanID:                  hubtypes.HubPlanId(info.PlanID),
			CanUploadProfilePicture: info.CanUploadProfilePicture,
			CanPostMessages:         info.CanPostMessages,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger(ctx).Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
