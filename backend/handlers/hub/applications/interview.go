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

// AcceptInterview accepts the named upcoming interview through the
// hub-accept-interview command.
func AcceptInterview(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applicationspec.AcceptInterviewRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		respondToInterview(s, w, r, request, federationspec.HubAcceptInterviewKind,
			func(applicant hubspec.HubUserDID) any {
				return federationspec.HubAcceptInterviewPayload{
					OpeningNumber:     request.OpeningNumber,
					ApplicationNumber: request.ApplicationNumber,
					InterviewNumber:   request.InterviewNumber,
					ApplicantDID:      applicant,
				}
			})
	}
}

// RequestInterviewReschedule asks the Org to move the named upcoming
// interview through the hub-request-interview-reschedule command.
func RequestInterviewReschedule(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applicationspec.RequestInterviewRescheduleRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		respondToInterview(s, w, r, request.InterviewReference,
			federationspec.HubRescheduleInterviewKind,
			func(applicant hubspec.HubUserDID) any {
				return federationspec.HubRescheduleInterviewPayload{
					OpeningNumber:     request.OpeningNumber,
					ApplicationNumber: request.ApplicationNumber,
					InterviewNumber:   request.InterviewNumber,
					ApplicantDID:      applicant, Note: request.Note,
				}
			}, request)
	}
}

// respondToInterview sends one interview-response command. The digest covers
// digestOf, else the reference, so a reused key with another note conflicts.
func respondToInterview(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	reference applicationspec.InterviewReference,
	kind federationspec.CommandKind,
	payload func(hubspec.HubUserDID) any, digestOf ...any,
) {
	key, ok := handlerauth.IdempotencyKey(s, w, r)
	if !ok {
		return
	}
	identity, _ := middleware.HubIdentityFromContext(r.Context())
	orgDID, ok := resolveOrgForWrite(s, w, r, reference.Domain,
		hubproblem.ApplicationNotFoundError)
	if !ok {
		return
	}
	var covered any = reference
	if len(digestOf) > 0 {
		covered = digestOf[0]
	}
	digest, err := requestDigest(covered)
	if err != nil {
		s.InternalError(r.Context(), w, "digest interview response", err)
		return
	}
	response, ok := sendCommand(s, w, r, commandRequest{
		kind: kind, orgDID: orgDID, opening: reference.OpeningNumber,
		applicant: identity.UserDID, key: key, digest: digest,
		payload: payload(hubspec.HubUserDID(
			dbvalue.FormatUUID(identity.UserDID))),
	})
	if !ok {
		return
	}
	if response.Status != http.StatusOK {
		writeRejection(s, w, r, response, offerRejections)
		return
	}
	var result federationspec.HubInterviewResponseResult
	if err := json.Unmarshal(response.Body, &result); err != nil ||
		result.OpeningNumber != reference.OpeningNumber ||
		result.ApplicationNumber != reference.ApplicationNumber ||
		result.InterviewNumber != reference.InterviewNumber {
		s.InternalError(r.Context(), w, "decode "+string(kind)+" result",
			fmt.Errorf("unexpected result: %v", err))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.JSON(r.Context(), w, http.StatusOK, reference.ApplicationReference)
}
