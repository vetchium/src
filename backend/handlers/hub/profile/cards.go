package profile

import (
	"net/http"
	"slices"

	hubspec "github.com/vetchium/src/typespec/hub"
	profilespec "github.com/vetchium/src/typespec/hub/profile"

	"backend/internal/apiserver"
	"backend/internal/dbvalue"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
	"backend/internal/postread"
)

// ReadCards returns the display fields of up to 50 handles (PST-THR-007).
// This tenant reads the users it homes. The local mesh relay reads the rest
// from their home tenants and lists the handles it could not read as
// unavailable. A handle that names no user is in neither list.
func ReadCards(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request profilespec.ReadCardsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		ctx := r.Context()
		identity, _ := middleware.HubIdentityFromContext(ctx)
		cards, err := postread.Reader{
			Queries: s.Queries, Pictures: s.PictureURLs,
		}.CardsByHandles(ctx, request.Handles)
		if err != nil {
			s.InternalError(ctx, w, "read local cards", err)
			return
		}
		response := profilespec.ReadCardsResponse{
			Cards: cards, Unavailable: []hubspec.HubHandle{},
		}
		var rest []hubspec.HubHandle
		for _, handle := range request.Handles {
			if !slices.ContainsFunc(cards, func(c profilespec.ProfileCard) bool {
				return c.Handle == handle
			}) {
				rest = append(rest, handle)
			}
		}
		if len(rest) > 0 {
			viewer, err := s.Queries.GetHubProfileViewer(ctx, identity.UserDID)
			if err != nil {
				s.InternalError(ctx, w, "read card viewer", err)
				return
			}
			outcome, err := s.Profiles.RelayReadCards(
				ctx, profilespec.RelayReadCardsRequest{
					ViewerHubUserDID: hubspec.HubUserDID(
						dbvalue.FormatUUID(identity.UserDID)),
					ViewerHandle: hubspec.HubHandle(viewer), Handles: rest,
				},
			)
			if err != nil || outcome.Problem != nil ||
				!answersOnly(outcome.Cards, rest) {
				response.Unavailable = rest
			} else {
				response.Cards = append(response.Cards, outcome.Cards.Cards...)
				response.Unavailable = outcome.Cards.Unavailable
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(ctx, w, http.StatusOK, response)
	}
}

// answersOnly holds when every handle in the answer was asked for.
func answersOnly(
	answer *profilespec.ReadCardsResponse, asked []hubspec.HubHandle,
) bool {
	for _, card := range answer.Cards {
		if !slices.Contains(asked, card.Handle) {
			return false
		}
	}
	for _, handle := range answer.Unavailable {
		if !slices.Contains(asked, handle) {
			return false
		}
	}
	return true
}
