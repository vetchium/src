package openings

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	hubspec "github.com/vetchium/src/typespec/hub"
	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/middleware"
	"backend/internal/openingsearch"
)

// Search answers the caller's home region locally and any other region
// through the mesh relay (OPN-SRCH-002). The match sort reads the caller's
// own ideal job, the only viewer data a peer may receive (OPN-SRCH-014). It
// never logs the query or the text (OPN-SRCH-008).
func Search(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openingsspec.SearchOpeningsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		query := openingsspec.OpeningSearchQuery{
			OpeningSearchFilters: request.OpeningSearchFilters, Sort: request.Sort,
		}
		if request.EffectiveSort() == openingsspec.SortIdealJobMatch {
			identity, _ := middleware.HubIdentityFromContext(r.Context())
			idealJob, err := s.Queries.GetHubIdealJob(r.Context(), identity.UserDID)
			if errors.Is(err, pgx.ErrNoRows) {
				s.AuthenticationProblem(
					r.Context(), w, hubproblem.AuthenticationRequiredError,
					hubauthn.BearerChallenge,
				)
				return
			}
			if err != nil {
				s.InternalError(r.Context(), w, "read Hub ideal job", err)
				return
			}
			// Checked before any routing, so every region answers alike
			// (OPN-SRCH-013).
			if !idealJob.Valid {
				s.Problem(r.Context(), w, hubproblem.IdealJobMissingError)
				return
			}
			text := hubspec.IdealJob(idealJob.String)
			query.IdealJobText = &text
		}
		var result openingsspec.SearchOpeningsResponse
		if request.Region == nil || string(*request.Region) == s.TenantID {
			local, err := s.OpeningSearch.Search(r.Context(), query)
			if errors.Is(err, openingsearch.ErrInvalidPaginationKey) {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			if err != nil {
				s.InternalError(r.Context(), w, "search local Openings", err)
				return
			}
			result = local
		} else {
			if _, ok := s.Regions.Region(string(*request.Region)); !ok {
				s.Problem(r.Context(), w, hubproblem.RegionUnavailableError)
				return
			}
			outcome, err := s.Openings.RelaySearch(
				r.Context(), *request.Region, query,
			)
			if err != nil {
				s.Problem(r.Context(), w, hubproblem.RegionUnavailableError)
				return
			}
			if outcome.Problem != nil {
				s.Problem(r.Context(), w, searchRelayProblem(*outcome.Problem))
				return
			}
			result = *outcome.Result
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

// SuggestOrgs routes like Search (OPN-SRCH-007).
func SuggestOrgs(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openingsspec.SuggestOpeningOrgsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		var result openingsspec.SuggestOpeningOrgsResponse
		if request.Region == nil || string(*request.Region) == s.TenantID {
			local, err := s.OpeningSearch.SuggestOrgs(r.Context(), request.SuggestOpeningOrgsQuery)
			if err != nil {
				s.InternalError(r.Context(), w, "suggest local Opening Orgs", err)
				return
			}
			result = local
		} else {
			if _, ok := s.Regions.Region(string(*request.Region)); !ok {
				s.Problem(r.Context(), w, hubproblem.RegionUnavailableError)
				return
			}
			outcome, err := s.Openings.RelaySuggestOrgs(
				r.Context(), *request.Region, request.SuggestOpeningOrgsQuery,
			)
			if err != nil {
				s.Problem(r.Context(), w, hubproblem.RegionUnavailableError)
				return
			}
			if outcome.Problem != nil {
				s.Problem(r.Context(), w, searchRelayProblem(*outcome.Problem))
				return
			}
			result = *outcome.Result
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

// searchRelayProblem forwards only the problems a search request itself can
// cause; the relay names query faults under `query.`, the Hub request at its
// top level.
func searchRelayProblem(upstream problem.Details) problem.Details {
	switch upstream.Type {
	case problem.InvalidPaginationKeyError.Type:
		return problem.InvalidPaginationKeyError
	case problem.ValidationFailedError.Type:
		details := problem.ValidationFailedError
		details.Fields = []string{}
		for _, field := range upstream.Fields {
			if name, ok := strings.CutPrefix(field, "query."); ok {
				details.Fields = append(details.Fields, name)
			}
		}
		if len(details.Fields) == 0 {
			return hubproblem.RegionUnavailableError
		}
		return details
	default:
		return hubproblem.RegionUnavailableError
	}
}
