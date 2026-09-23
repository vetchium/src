package profile

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	hubspec "github.com/vetchium/src/typespec/hub"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/middleware"
)

func Read(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request profilespec.ReadProfileRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		viewer, err := s.Queries.GetHubMyInfo(
			r.Context(), sqlc.GetHubMyInfoParams{
				HubSessionID: identity.SessionID,
				HubUserDid:   identity.UserDID,
			},
		)
		if errors.Is(err, pgx.ErrNoRows) {
			s.AuthenticationProblem(
				r.Context(), w, hubproblem.AuthenticationRequiredError,
				hubauthn.BearerChallenge,
			)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "read profile viewer", err)
			return
		}
		outcome, err := s.Profiles.RelayRead(
			r.Context(), profilespec.RelayReadProfileRequest{
				ViewerHubUserDID: hubspec.HubUserDID(
					dbvalue.FormatUUID(identity.UserDID),
				),
				ViewerHandle: hubspec.HubHandle(viewer.Handle),
				Address:      request.Address,
			},
		)
		if err != nil {
			s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
			return
		}
		if outcome.Problem != nil {
			if outcome.Problem.Type == hubproblem.ProfileNotFoundError.Type {
				s.Problem(r.Context(), w, hubproblem.ProfileNotFoundError)
			} else {
				s.Problem(r.Context(), w, hubproblem.ProfileUnavailableError)
			}
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, outcome.Profile)
	}
}
