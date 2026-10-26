package mesh

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/agencyconversations"
	"backend/internal/apiserver"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
)

func RelayReadConversation(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request federationspec.MeshReadConversationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		resolved, details, err := s.Directory.ResolvePrincipal(r.Context(),
			directoryspec.ResolvePrincipalRequest{
				PrincipalType: directoryspec.PrincipalOrg,
				PrincipalDID:  directoryspec.PrincipalDID(request.AgencyOrgDID),
			},
		)
		if err != nil || details != nil {
			s.Problem(r.Context(), w, orgsproblem.TenantUnavailableError)
			return
		}
		if string(resolved.HomeTenantID) == s.TenantID {
			readLocalConversation(s, w, r, request)
			return
		}
		outcome, err := s.ConversationPeers.PeerRead(r.Context(), resolved.HomeTenantID, request)
		if err == nil && outcome.Problem != nil {
			switch outcome.Problem.Type {
			case orgsproblem.ConversationNotFoundError.Type:
				s.Problem(r.Context(), w, orgsproblem.ConversationNotFoundError)
				return
			case problem.InvalidPaginationKeyError.Type:
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
		}
		if err != nil || outcome.Problem != nil || outcome.Result == nil {
			s.Problem(r.Context(), w, orgsproblem.TenantUnavailableError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, *outcome.Result)
	}
}

// PeerReadConversation answers only the tenant that homes the Hub user the
// request names; any other learns nothing about the conversations here.
func PeerReadConversation(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller, ok := meshidentity.TenantFromContext(r.Context())
		if !ok {
			peerAuthenticationRequired(s, w, r)
			return
		}
		var request federationspec.MeshReadConversationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		resolved, details, err := s.Directory.ResolvePrincipal(r.Context(),
			directoryspec.ResolvePrincipalRequest{
				PrincipalType: directoryspec.PrincipalHubUser,
				PrincipalDID:  directoryspec.PrincipalDID(request.HubUserDID),
			})
		if err != nil || (details != nil &&
			details.Type != coordinatorproblem.DirectoryEntryNotFoundError.Type) {
			s.Problem(r.Context(), w, orgsproblem.TenantUnavailableError)
			return
		}
		if details != nil || resolved.HomeTenantID != caller {
			s.Problem(r.Context(), w, orgsproblem.ConversationNotFoundError)
			return
		}
		readLocalConversation(s, w, r, request)
	}
}

func readLocalConversation(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	request federationspec.MeshReadConversationRequest,
) {
	response, err := agencyconversations.ReadForHubUser(r.Context(), s.Queries, request)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		s.Problem(r.Context(), w, orgsproblem.ConversationNotFoundError)
		return
	case errors.Is(err, agencyconversations.ErrInvalidCursor):
		s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
		return
	case err != nil:
		s.InternalError(r.Context(), w, "read conversation", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.JSON(r.Context(), w, http.StatusOK, response)
}
