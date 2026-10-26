package mesh

import (
	"errors"
	"net/http"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/problem"
	federationproblem "github.com/vetchium/src/typespec/problem/federation"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/apiserver"
	"backend/internal/federation/commands"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
)

// RelayExecuteCommand routes a command from this tenant's API servers and
// workers to its authority principal's home tenant.
func RelayExecuteCommand(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request federationspec.ExecuteCommandRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		resolved, details, err := s.Directory.ResolvePrincipal(r.Context(),
			directoryspec.ResolvePrincipalRequest{
				PrincipalType: request.AuthorityPrincipalType,
				PrincipalDID:  request.AuthorityPrincipalDID,
			})
		if err != nil || (details != nil && details.Type !=
			coordinatorproblem.DirectoryEntryNotFoundError.Type) {
			s.WarnContext(r.Context(), "federation command authority unresolved",
				"event", "federation_command_unrouted",
				"kind", request.Kind, "error", err)
			s.Problem(r.Context(), w, federationproblem.AuthorityUnavailableError)
			return
		}
		if details != nil {
			s.Problem(r.Context(), w, federationproblem.AuthorityNotFoundError)
			return
		}
		if string(resolved.HomeTenantID) == s.TenantID {
			executeCommand(s, w, r, request, s.TenantID)
			return
		}
		outcome, err := s.CommandPeers.Execute(
			r.Context(), resolved.HomeTenantID, request,
		)
		if errors.Is(err, commands.ErrNotSent) {
			s.WarnContext(r.Context(), "federation command peer unreachable",
				"event", "federation_command_not_sent",
				"kind", request.Kind, "tenant", resolved.HomeTenantID,
				"error", err)
			s.Problem(r.Context(), w, federationproblem.AuthorityUnavailableError)
			return
		}
		if err != nil {
			s.WarnContext(r.Context(), "federation command peer outcome unknown",
				"event", "federation_command_outcome_unknown",
				"kind", request.Kind, "tenant", resolved.HomeTenantID,
				"error", err)
			s.Problem(r.Context(), w, federationproblem.CommandOutcomeUnknownError)
			return
		}
		if outcome.Problem != nil {
			s.Problem(r.Context(), w, peerCommandProblem(*outcome.Problem))
			return
		}
		writeCommandResult(s, w, r, *outcome.Result)
	}
}

// PeerExecuteCommand executes a command another tenant sent to this
// authority, attributing it to the tenant its client certificate names.
func PeerExecuteCommand(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller, ok := meshidentity.TenantFromContext(r.Context())
		if !ok {
			s.AuthenticationProblem(r.Context(), w,
				coordinatorproblem.MeshPeerAuthenticationRequiredError,
				`MutualTLS realm="mesh-api"`)
			return
		}
		var request federationspec.ExecuteCommandRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		executeCommand(s, w, r, request, string(caller))
	}
}

func executeCommand(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	request federationspec.ExecuteCommandRequest, sourceTenantID string,
) {
	command, err := commands.FromWire(request, sourceTenantID)
	if err != nil {
		s.InternalError(r.Context(), w, "parse validated federation command", err)
		return
	}
	response, err := s.Commands.Execute(r.Context(), command)
	switch {
	case errors.Is(err, commands.ErrCommandConflict):
		s.Problem(r.Context(), w, federationproblem.CommandConflictError)
	case errors.Is(err, commands.ErrMisdirected):
		s.Problem(r.Context(), w, federationproblem.AuthorityMisdirectedError)
	case errors.Is(err, commands.ErrUnsupportedKind):
		s.ValidationFailed(r.Context(), w, []string{"kind"})
	case err != nil:
		s.InternalError(r.Context(), w, "execute federation command", err)
	default:
		writeCommandResult(s, w, r, response)
	}
}

func writeCommandResult(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	response commands.Response,
) {
	w.Header().Set("Cache-Control", "no-store")
	s.JSON(r.Context(), w, http.StatusOK, commands.WireResult(response))
}

// peerCommandProblem passes on only the problems the relay contract
// declares; anything else from a peer leaves the outcome unknown.
func peerCommandProblem(details problem.Details) problem.Details {
	for _, known := range []problem.Details{
		federationproblem.CommandConflictError,
		federationproblem.AuthorityMisdirectedError,
		problem.InvalidJSONError,
	} {
		if details.Type == known.Type {
			return known
		}
	}
	if details.Type == problem.ValidationFailedError.Type {
		passed := problem.ValidationFailedError
		passed.Fields = details.Fields
		return passed
	}
	return federationproblem.CommandOutcomeUnknownError
}
