package mesh

import (
	"errors"
	"net/http"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/listings"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
)

// RelaySearchListings searches one tenant's Listings for the local orgs-api:
// this tenant's own from the database, another tenant's through its peer
// listener. Any failure to get an answer is one unavailable tenant, which the
// caller reports as incomplete results.
func RelaySearchListings(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request marketplace.RelaySearchListingsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		var result marketplace.PeerSearchListingsResponse
		if string(request.Tenant) == s.TenantID {
			local, err := s.PublicListings.Search(r.Context(), request.Search)
			if err != nil {
				s.InternalError(r.Context(), w, "search local Listings", err)
				return
			}
			result = local
		} else {
			outcome, err := s.ListingPeers.PeerSearch(
				r.Context(), request.Tenant, request.Search,
			)
			if err != nil || outcome.Problem != nil {
				listingTenantUnavailable(s, w, r, request.Tenant, err, outcome.Problem)
				return
			}
			result = *outcome.Result
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

// RelayGetListing reads one Listing at the named tenant for the local
// orgs-api.
func RelayGetListing(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request marketplace.RelayGetListingRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		var result marketplace.ListingDetail
		if string(request.Tenant) == s.TenantID {
			local, err := s.PublicListings.Get(r.Context(), request.Listing)
			if errors.Is(err, listings.ErrNotFound) {
				s.Problem(r.Context(), w, orgsproblem.ListingNotFoundError)
				return
			}
			if err != nil {
				s.InternalError(r.Context(), w, "get local Listing", err)
				return
			}
			result = local
		} else {
			outcome, err := s.ListingPeers.PeerGet(
				r.Context(), request.Tenant, request.Listing,
			)
			if err == nil && outcome.Problem != nil &&
				outcome.Problem.Type == orgsproblem.ListingNotFoundError.Type {
				s.Problem(r.Context(), w, orgsproblem.ListingNotFoundError)
				return
			}
			if err != nil || outcome.Problem != nil {
				listingTenantUnavailable(s, w, r, request.Tenant, err, outcome.Problem)
				return
			}
			result = *outcome.Result
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

// PeerSearchListings answers another tenant's search from this tenant's
// database. The mTLS identity admits the caller; the read carries no caller
// data because every active Org may read the same Listings.
func PeerSearchListings(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := meshidentity.TenantFromContext(r.Context()); !ok {
			peerAuthenticationRequired(s, w, r)
			return
		}
		var request marketplace.PeerSearchListingsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		result, err := s.PublicListings.Search(r.Context(), request)
		if err != nil {
			s.InternalError(r.Context(), w, "search peer Listings", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

func PeerGetListing(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := meshidentity.TenantFromContext(r.Context()); !ok {
			peerAuthenticationRequired(s, w, r)
			return
		}
		var request marketplace.GetListingRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		result, err := s.PublicListings.Get(r.Context(), request)
		if errors.Is(err, listings.ErrNotFound) {
			s.Problem(r.Context(), w, orgsproblem.ListingNotFoundError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get peer Listing", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

func listingTenantUnavailable(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	tenant directoryspec.TenantID, err error, details *problem.Details,
) {
	attrs := []any{"event", "listing_tenant_unavailable", "peer_tenant", tenant}
	if err != nil {
		attrs = append(attrs, "error", err)
	}
	if details != nil {
		attrs = append(attrs, "problem_type", details.Type)
	}
	s.WarnContext(r.Context(), "Listing peer did not answer", attrs...)
	s.Problem(r.Context(), w, orgsproblem.TenantUnavailableError)
}

func peerAuthenticationRequired(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
) {
	s.AuthenticationProblem(r.Context(), w,
		coordinatorproblem.MeshPeerAuthenticationRequiredError,
		`MutualTLS realm="mesh-api"`)
}
