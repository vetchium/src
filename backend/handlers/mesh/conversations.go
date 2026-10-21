package mesh

import (
	"net/http"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/agencyconversations"
	"backend/internal/apiserver"
	"backend/internal/dbvalue"
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
		if err != nil || outcome.Problem != nil {
			s.Problem(r.Context(), w, orgsproblem.TenantUnavailableError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, *outcome.Result)
	}
}

func PeerReadConversation(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := meshidentity.TenantFromContext(r.Context()); !ok {
			peerAuthenticationRequired(s, w, r)
			return
		}
		var request federationspec.MeshReadConversationRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		readLocalConversation(s, w, r, request)
	}
}

func readLocalConversation(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	request federationspec.MeshReadConversationRequest,
) {
	contactID, err := dbvalue.ParseUUID(string(request.ContactID))
	if err != nil {
		s.Problem(r.Context(), w, orgsproblem.ConversationNotFoundError)
		return
	}
	hubUserDID, err := dbvalue.ParseUUID(string(request.HubUserDID))
	if err != nil {
		s.Problem(r.Context(), w, orgsproblem.ConversationNotFoundError)
		return
	}

	summary, msgs, err := agencyconversations.ReadForHubUser(
		r.Context(), s.Queries, contactID, hubUserDID,
	)
	if err != nil {
		s.Problem(r.Context(), w, orgsproblem.ConversationNotFoundError)
		return
	}

	w.Header().Set("Cache-Control", "no-store")
	s.JSON(r.Context(), w, http.StatusOK, federationspec.MeshReadConversationResponse{
		Conversation: *summary,
		Messages:     msgs,
	})
}
