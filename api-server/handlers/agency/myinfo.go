package agency

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/agency"
	"vetchium-api-server.typespec/common"
)

func MyInfo(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		agencyUser := middleware.AgencyUserFromContext(ctx)
		if agencyUser == nil {
			log.Debug("agency user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		agencyEntity, err := s.Global.GetAgencyByID(ctx, agencyUser.AgencyID)
		if err != nil {
			log.Error("failed to fetch agency", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		roleRecords, err := s.Global.GetAgencyUserRoles(ctx, agencyUser.AgencyUserID)
		if err != nil {
			log.Error("failed to fetch agency user roles", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		roles := make([]string, len(roleRecords))
		for i, role := range roleRecords {
			roles[i] = role.RoleName
		}

		response := agency.AgencyMyInfoResponse{
			AgencyUserID:      agencyUser.AgencyUserID.String(),
			FullName:          agencyUser.FullName.String,
			PreferredLanguage: common.LanguageCode(agencyUser.PreferredLanguage),
			AgencyName:        agencyEntity.AgencyName,
			IsAdmin:           agencyUser.IsAdmin,
			Roles:             roles,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Error("JSON encoding error", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
	}
}
