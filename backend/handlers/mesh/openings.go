package mesh

import (
	"errors"
	"net/http"

	directoryspec "github.com/vetchium/src/typespec/directory"
	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/problem"
	directoryproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
	"backend/internal/publicopenings"
)

func RelayListOrgOpenings(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
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
			home, ok := resolveOpeningHome(s, w, r, request.Domain)
			if !ok {
				return
			}
			if string(home) == s.TenantID {
				s.Problem(r.Context(), w, hubproblem.OrgNotFoundError)
				return
			}
			outcome, peerErr := s.Openings.PeerList(r.Context(), home, request)
			if peerErr != nil {
				s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
				return
			}
			if outcome.Problem != nil {
				writeOpeningPeerProblem(s, w, r, outcome.Problem.Type)
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

func RelayGetOrgOpening(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request openingsspec.GetOrgOpeningRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		result, err := s.PublicOpenings.Get(r.Context(), request)
		if errors.Is(err, publicopenings.ErrOrgNotFound) {
			home, ok := resolveOpeningHome(s, w, r, request.Domain)
			if !ok {
				return
			}
			if string(home) == s.TenantID {
				s.Problem(r.Context(), w, hubproblem.OrgNotFoundError)
				return
			}
			outcome, peerErr := s.Openings.PeerGet(r.Context(), home, request)
			if peerErr != nil {
				s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
				return
			}
			if outcome.Problem != nil {
				writeOpeningPeerProblem(s, w, r, outcome.Problem.Type)
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

func PeerListOrgOpenings(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := meshidentity.TenantFromContext(r.Context()); !ok {
			s.Problem(r.Context(), w, hubproblem.OrgNotFoundError)
			return
		}
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
			s.Problem(r.Context(), w, hubproblem.OrgNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "list peer Org Openings", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

func PeerGetOrgOpening(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := meshidentity.TenantFromContext(r.Context()); !ok {
			s.Problem(r.Context(), w, hubproblem.OrgNotFoundError)
			return
		}
		var request openingsspec.GetOrgOpeningRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		result, err := s.PublicOpenings.Get(r.Context(), request)
		if errors.Is(err, publicopenings.ErrOrgNotFound) {
			s.Problem(r.Context(), w, hubproblem.OrgNotFoundError)
			return
		}
		if errors.Is(err, publicopenings.ErrOpeningNotFound) {
			s.Problem(r.Context(), w, hubproblem.OpeningNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get peer Org Opening", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

func resolveOpeningHome(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	domain orgs.OrgDomain,
) (directoryspec.TenantID, bool) {
	resolved, details, err := s.Directory.ResolveOrgDomain(
		r.Context(), directoryspec.ResolveOrgDomainRequest{Domain: domain},
	)
	if err != nil {
		s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
		return "", false
	}
	if details != nil {
		if details.Type == directoryproblem.DirectoryEntryNotFoundError.Type {
			s.Problem(r.Context(), w, hubproblem.OrgNotFoundError)
		} else {
			s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
		}
		return "", false
	}
	if resolved.Domain != domain {
		s.Problem(r.Context(), w, hubproblem.OrgUnavailableError)
		return "", false
	}
	return resolved.HomeTenantID, true
}

func writeOpeningPeerProblem(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	problemType string,
) {
	s.Problem(r.Context(), w, openingPeerProblem(problemType))
}

func openingPeerProblem(problemType string) problem.Details {
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
