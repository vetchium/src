package applications

import (
	"encoding/json"
	"fmt"
	"net/http"

	federationspec "github.com/vetchium/src/typespec/federation"
	hubspec "github.com/vetchium/src/typespec/hub"
	applicationspec "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/problem"
	federationproblem "github.com/vetchium/src/typespec/problem/federation"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

var offerRejections = map[string]problem.Details{
	hubproblem.ApplicationNotFoundError.Type:      hubproblem.ApplicationNotFoundError,
	hubproblem.ApplicationStateConflictError.Type: hubproblem.ApplicationStateConflictError,
	federationproblem.AuthorityNotFoundError.Type: hubproblem.ApplicationNotFoundError,
}

// AcceptOffer answers the named offer through the hub-accept-offer command.
func AcceptOffer(s *hubruntime.Server) http.HandlerFunc {
	return answerOffer(s, federationspec.HubAcceptOfferKind)
}

// DeclineOffer answers the named offer through the hub-decline-offer
// command.
func DeclineOffer(s *hubruntime.Server) http.HandlerFunc {
	return answerOffer(s, federationspec.HubDeclineOfferKind)
}

func answerOffer(
	s *hubruntime.Server, kind federationspec.CommandKind,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applicationspec.RespondToOfferRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		orgDID, ok := resolveOrgForWrite(s, w, r, request.Domain,
			hubproblem.ApplicationNotFoundError)
		if !ok {
			return
		}
		digest, err := requestDigest(request)
		if err != nil {
			s.InternalError(r.Context(), w, "digest offer answer", err)
			return
		}
		response, ok := sendCommand(s, w, r, commandRequest{
			kind: kind, orgDID: orgDID, opening: request.OpeningNumber,
			applicant: identity.UserDID, key: key, digest: digest,
			payload: federationspec.HubOfferResponsePayload{
				OpeningNumber:     request.OpeningNumber,
				ApplicationNumber: request.ApplicationNumber,
				OfferNumber:       request.OfferNumber,
				ApplicantDID: hubspec.HubUserDID(
					dbvalue.FormatUUID(identity.UserDID),
				),
			},
		})
		if !ok {
			return
		}
		if response.Status != http.StatusOK {
			writeRejection(s, w, r, response, offerRejections)
			return
		}
		var result federationspec.HubOfferResponseResult
		if err := json.Unmarshal(response.Body, &result); err != nil ||
			result.OpeningNumber != request.OpeningNumber ||
			result.ApplicationNumber != request.ApplicationNumber ||
			result.OfferNumber != request.OfferNumber {
			s.InternalError(r.Context(), w, "decode "+string(kind)+" result",
				fmt.Errorf("unexpected result: %v", err))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, request.ApplicationReference)
	}
}
