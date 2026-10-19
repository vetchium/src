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
	"backend/internal/federation/events"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
)

// RelayDeliverEvent routes an outbox event from this tenant's workers to
// its destination principal's home tenant.
func RelayDeliverEvent(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request federationspec.DeliverEventRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		resolved, details, err := s.Directory.ResolvePrincipal(r.Context(),
			directoryspec.ResolvePrincipalRequest{
				PrincipalType: request.DestinationPrincipalType,
				PrincipalDID:  request.DestinationPrincipalDID,
			})
		if err != nil || (details != nil && details.Type !=
			coordinatorproblem.DirectoryEntryNotFoundError.Type) {
			s.WarnContext(r.Context(), "federation event destination unresolved",
				"event", "federation_event_unrouted",
				"kind", request.Kind, "error", err)
			s.Problem(r.Context(), w, federationproblem.EventUndeliveredError)
			return
		}
		if details != nil {
			s.Problem(r.Context(), w, federationproblem.DestinationNotFoundError)
			return
		}
		if string(resolved.HomeTenantID) == s.TenantID {
			receiveEvent(s, w, r, request, s.TenantID)
			return
		}
		delivery, err := s.EventPeers.Deliver(
			r.Context(), resolved.HomeTenantID, request,
		)
		if err != nil {
			s.WarnContext(r.Context(), "federation event peer delivery unconfirmed",
				"event", "federation_event_undelivered",
				"kind", request.Kind, "tenant", resolved.HomeTenantID,
				"error", err)
			s.Problem(r.Context(), w, federationproblem.EventUndeliveredError)
			return
		}
		if delivery.Problem != nil {
			s.Problem(r.Context(), w, peerEventProblem(*delivery.Problem))
			return
		}
		writeEventReceipt(s, w, r, *delivery.Receipt)
	}
}

// PeerDeliverEvent records and applies an event another tenant sent,
// attributing it to the tenant its client certificate names.
func PeerDeliverEvent(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller, ok := meshidentity.TenantFromContext(r.Context())
		if !ok {
			s.AuthenticationProblem(r.Context(), w,
				coordinatorproblem.MeshPeerAuthenticationRequiredError,
				`MutualTLS realm="mesh-api"`)
			return
		}
		var request federationspec.DeliverEventRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		receiveEvent(s, w, r, request, string(caller))
	}
}

func receiveEvent(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	request federationspec.DeliverEventRequest, sourceTenantID string,
) {
	event, err := events.FromWire(request, sourceTenantID)
	if err != nil {
		s.InternalError(r.Context(), w, "parse validated federation event", err)
		return
	}
	outcome, err := s.Events.Receive(r.Context(), event)
	switch {
	case errors.Is(err, events.ErrEventConflict):
		s.Problem(r.Context(), w, federationproblem.EventConflictError)
	case errors.Is(err, events.ErrMisdirected):
		s.Problem(r.Context(), w, federationproblem.DestinationMisdirectedError)
	case errors.Is(err, events.ErrOriginMismatch):
		s.WarnContext(r.Context(), "federation event origin refused",
			"event", "federation_event_origin_mismatch",
			"kind", request.Kind, "sourceTenant", sourceTenantID)
		s.Problem(r.Context(), w, federationproblem.EventOriginMismatchError)
	case errors.Is(err, events.ErrUnsupportedKind):
		s.ValidationFailed(r.Context(), w, []string{"kind"})
	case err != nil:
		s.InternalError(r.Context(), w, "receive federation event", err)
	default:
		writeEventReceipt(s, w, r, federationspec.EventReceipt{Outcome: outcome})
	}
}

func writeEventReceipt(
	s *meshapi.Server, w http.ResponseWriter, r *http.Request,
	receipt federationspec.EventReceipt,
) {
	w.Header().Set("Cache-Control", "no-store")
	s.JSON(r.Context(), w, http.StatusOK, receipt)
}

// peerEventProblem passes on only the problems the relay contract declares;
// anything else from a peer leaves delivery unconfirmed.
func peerEventProblem(details problem.Details) problem.Details {
	for _, known := range []problem.Details{
		federationproblem.EventConflictError,
		federationproblem.EventOriginMismatchError,
		federationproblem.DestinationMisdirectedError,
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
	return federationproblem.EventUndeliveredError
}
