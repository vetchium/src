package profile

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	directoryspec "github.com/vetchium/src/typespec/directory"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/db/sqlc"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/middleware"
)

func AliasState(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		row, err := s.Queries.GetHubAliasState(
			r.Context(), sqlc.GetHubAliasStateParams{
				HubSessionID: identity.SessionID,
				HubUserDid:   identity.UserDID,
			},
		)
		if errors.Is(err, pgx.ErrNoRows) {
			s.AuthenticationProblem(r.Context(), w,
				hubproblem.AuthenticationRequiredError, hubauthn.BearerChallenge)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "read Hub alias state", err)
			return
		}
		state := profilespec.AliasState{}
		if row.ProfileAlias.Valid {
			alias := directoryspec.HubAlias(row.ProfileAlias.String)
			if !directoryspec.IsHubAlias(alias) {
				s.InternalError(r.Context(), w, "decode stored Hub alias",
					errors.New("invalid stored profile alias"))
				return
			}
			state.ProfileAlias = &alias
		}
		if row.AliasLastChangedAt.Valid {
			until := row.AliasLastChangedAt.Time.UTC().Add(7 * 24 * time.Hour)
			if until.After(s.CurrentTime()) {
				state.NextChangeAt = &until
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, state)
	}
}
