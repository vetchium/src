package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	hub "vetchium-api-server.typespec/hub"
	orgtypes "vetchium-api-server.typespec/org"
)

func GetHubUserProfile(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.OrgGetHubUserProfileRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// One global round-trip: resolve handle to home region + global ID
		globalHubUser, err := s.Global.GetHubUserByHandle(ctx, req.Handle)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to resolve handle", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		homeDB := s.GetRegionalDB(globalHubUser.HomeRegion)
		if homeDB == nil {
			log.Error("no regional pool for home region", "region", globalHubUser.HomeRegion)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// One regional round-trip: get public profile
		publicProfile, err := homeDB.GetPublicProfileByHandle(ctx, req.Handle)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get public profile", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// One global round-trip: display names + employer stints
		displayNames, err := s.Global.ListHubUserDisplayNames(ctx, publicProfile.HubUserGlobalID)
		if err != nil {
			log.Error("failed to get display names", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		stintRows, err := homeDB.ListPublicEmployerStintsByHandle(ctx, req.Handle)
		if err != nil {
			log.Error("failed to get employer stints", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		profile := hub.HubProfilePublicView{
			Handle:       hub.Handle(publicProfile.Handle),
			DisplayNames: make([]hub.DisplayNameEntry, 0, len(displayNames)),
		}
		if publicProfile.ShortBio.Valid {
			profile.ShortBio = &publicProfile.ShortBio.String
		}
		if publicProfile.LongBio.Valid {
			profile.LongBio = &publicProfile.LongBio.String
		}
		if publicProfile.City.Valid {
			profile.City = &publicProfile.City.String
		}
		if publicProfile.ResidentCountryCode.Valid {
			cc := hub.CountryCode(publicProfile.ResidentCountryCode.String)
			profile.ResidentCountryCode = &cc
		}
		// Profile picture serving is not available via the org portal
		for _, dn := range displayNames {
			profile.DisplayNames = append(profile.DisplayNames, hub.DisplayNameEntry{
				LanguageCode: dn.LanguageCode,
				DisplayName:  hub.DisplayName(dn.DisplayName),
				IsPreferred:  dn.IsPreferred,
			})
		}

		stints := make([]hub.PublicEmployerStint, 0, len(stintRows))
		for _, row := range stintRows {
			ps := hub.PublicEmployerStint{
				Domain:    row.Domain,
				IsCurrent: row.IsCurrent,
				StartYear: row.StartYear,
			}
			if !row.IsCurrent && row.EndYear != nil {
				switch v := row.EndYear.(type) {
				case int32:
					ps.EndYear = &v
				case int64:
					n := int32(v)
					ps.EndYear = &n
				}
			}
			stints = append(stints, ps)
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(orgtypes.OrgHubUserProfileResponse{
			Profile: profile,
			Stints:  stints,
		})
	}
}
