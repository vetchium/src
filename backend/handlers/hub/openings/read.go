package openings

import (
	"errors"
	"net/http"

	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	hubruntime "backend/internal/hub"
	"backend/internal/publicopenings"
)

func List(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openingsspec.ListOrgOpeningsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		result, err := s.PublicOpenings.List(r.Context(), request)
		if errors.Is(err, publicopenings.ErrInvalidPaginationKey) {
			s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
			return
		}
		if errors.Is(err, publicopenings.ErrOrgNotFound) {
			outcome, relayErr := s.Openings.RelayList(r.Context(), request)
			if relayErr != nil {
				s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
				return
			}
			if outcome.Problem != nil {
				writeRelayProblem(s, w, r, outcome.Problem.Type)
				return
			}
			result = *outcome.Result
		} else if err != nil {
			s.InternalError(r.Context(), w, "list local Org Openings", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

func Get(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request openingsspec.GetOrgOpeningRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		result, err := s.PublicOpenings.Get(r.Context(), request)
		if errors.Is(err, publicopenings.ErrOrgNotFound) {
			outcome, relayErr := s.Openings.RelayGet(r.Context(), request)
			if relayErr != nil {
				s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
				return
			}
			if outcome.Problem != nil {
				writeRelayProblem(s, w, r, outcome.Problem.Type)
				return
			}
			result = *outcome.Result
		} else if errors.Is(err, publicopenings.ErrOpeningNotFound) {
			s.Problem(r.Context(), w, hubproblem.OpeningNotFoundError)
			return
		} else if err != nil {
			s.InternalError(r.Context(), w, "get local Org Opening", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

func writeRelayProblem(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	problemType string,
) {
	s.Problem(r.Context(), w, relayProblem(problemType))
}

func relayProblem(problemType string) problem.Details {
	switch problemType {
	case hubproblem.OrgNotFoundError.Type:
		return hubproblem.OrgNotFoundError
	case hubproblem.OpeningNotFoundError.Type:
		return hubproblem.OpeningNotFoundError
	case problem.InvalidPaginationKeyError.Type:
		return problem.InvalidPaginationKeyError
	default:
		return hubproblem.OrgUnavailableError
	}
}
