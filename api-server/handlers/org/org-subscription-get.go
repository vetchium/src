package org

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

// GetMyOrgSubscription returns the calling org's subscription + usage.
// Requires org:view_subscription or org:manage_subscription (or superadmin via middleware).
func GetMyOrgSubscription(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		sub, err := s.Global.GetOrgSubscription(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get org subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		org, err := s.Global.GetOrgByID(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		resp, err := buildOrgSubscription(ctx, sub, org.OrgName, s.Global, s.Regional)
		if err != nil {
			s.Logger(ctx).Error("failed to build org subscription response", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(resp)
	}
}
