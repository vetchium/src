package mesh

import (
	"errors"
	"net/http"

	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
	"backend/internal/openingsearch"
)

// RelaySearchOpenings searches one region for the local hub-api: this
// tenant's own from the database, another's through its peer listener
// (OPN-SRCH-002). It never logs the query (OPN-SRCH-008).
func RelaySearchOpenings(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request openingsspec.RelaySearchOpeningsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		var result openingsspec.SearchOpeningsResponse
		if string(request.TenantID) == s.TenantID {
			local, err := s.OpeningSearch.Search(r.Context(), request.Query)
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
			outcome, err := s.Openings.PeerSearch(r.Context(), request.TenantID, request.Query)
			if err != nil {
				s.Problem(r.Context(), w, hubproblem.RegionUnavailableError)
				return
			}
			if outcome.Problem != nil {
				s.Problem(r.Context(), w, searchPeerProblem(*outcome.Problem))
				return
			}
			result = *outcome.Result
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

// RelaySuggestOpeningOrgs routes like RelaySearchOpenings (OPN-SRCH-007).
func RelaySuggestOpeningOrgs(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request openingsspec.RelaySuggestOpeningOrgsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		var result openingsspec.SuggestOpeningOrgsResponse
		if string(request.TenantID) == s.TenantID {
			local, err := s.OpeningSearch.SuggestOrgs(r.Context(), request.Query)
			if err != nil {
				s.InternalError(r.Context(), w, "suggest local Opening Orgs", err)
				return
			}
			result = local
		} else {
			outcome, err := s.Openings.PeerSuggestOrgs(r.Context(), request.TenantID, request.Query)
			if err != nil {
				s.Problem(r.Context(), w, hubproblem.RegionUnavailableError)
				return
			}
			if outcome.Problem != nil {
				s.Problem(r.Context(), w, searchPeerProblem(*outcome.Problem))
				return
			}
			result = *outcome.Result
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

// PeerSearchOpenings answers another tenant's search from this tenant's
// database and never forwards it. The mTLS identity admits the caller; the
// query names no viewer (OPN-HUB-006).
func PeerSearchOpenings(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := meshidentity.TenantFromContext(r.Context()); !ok {
			peerAuthenticationRequired(s, w, r)
			return
		}
		var request openingsspec.PeerSearchOpeningsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		result, err := s.OpeningSearch.Search(r.Context(), request)
		if errors.Is(err, openingsearch.ErrInvalidPaginationKey) {
			s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "search peer Openings", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

func PeerSuggestOpeningOrgs(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := meshidentity.TenantFromContext(r.Context()); !ok {
			peerAuthenticationRequired(s, w, r)
			return
		}
		var request openingsspec.PeerSuggestOpeningOrgsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		result, err := s.OpeningSearch.SuggestOrgs(r.Context(), request)
		if err != nil {
			s.InternalError(r.Context(), w, "suggest peer Opening Orgs", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

// searchPeerProblem forwards only the problems the query itself can cause,
// naming a peer's query fields under `query.` as the relay request does.
func searchPeerProblem(upstream problem.Details) problem.Details {
	switch upstream.Type {
	case problem.InvalidPaginationKeyError.Type:
		return problem.InvalidPaginationKeyError
	case problem.ValidationFailedError.Type:
		if len(upstream.Fields) == 0 {
			return hubproblem.RegionUnavailableError
		}
		details := problem.ValidationFailedError
		details.Fields = make([]string, len(upstream.Fields))
		for i, field := range upstream.Fields {
			details.Fields[i] = "query." + field
		}
		return details
	default:
		return hubproblem.RegionUnavailableError
	}
}
