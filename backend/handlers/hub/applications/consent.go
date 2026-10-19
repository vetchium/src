package applications

import (
	"encoding/json"
	"fmt"
	"net/http"

	federationspec "github.com/vetchium/src/typespec/federation"
	hubspec "github.com/vetchium/src/typespec/hub"
	applicationspec "github.com/vetchium/src/typespec/hub/applications"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

// GiveBackgroundCheckConsent consents to the named request through the
// hub-give-background-check-consent command.
func GiveBackgroundCheckConsent(s *hubruntime.Server) http.HandlerFunc {
	return answerConsent(s, federationspec.HubGiveConsentKind)
}

// DeclineBackgroundCheckConsent declines the named request through the
// hub-decline-background-check-consent command.
func DeclineBackgroundCheckConsent(s *hubruntime.Server) http.HandlerFunc {
	return answerConsent(s, federationspec.HubDeclineConsentKind)
}

func answerConsent(
	s *hubruntime.Server, kind federationspec.CommandKind,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applicationspec.BackgroundCheckConsentRequest
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
			s.InternalError(r.Context(), w, "digest consent answer", err)
			return
		}
		response, ok := sendCommand(s, w, r, commandRequest{
			kind: kind, orgDID: orgDID, opening: request.OpeningNumber,
			applicant: identity.UserDID, key: key, digest: digest,
			payload: federationspec.HubBackgroundCheckConsentPayload{
				OpeningNumber:     request.OpeningNumber,
				ApplicationNumber: request.ApplicationNumber,
				CheckNumber:       request.CheckNumber,
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
		var result federationspec.HubBackgroundCheckConsentResult
		if err := json.Unmarshal(response.Body, &result); err != nil ||
			result.OpeningNumber != request.OpeningNumber ||
			result.ApplicationNumber != request.ApplicationNumber ||
			result.CheckNumber != request.CheckNumber {
			s.InternalError(r.Context(), w, "decode "+string(kind)+" result",
				fmt.Errorf("unexpected result: %v", err))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, request.ApplicationReference)
	}
}
