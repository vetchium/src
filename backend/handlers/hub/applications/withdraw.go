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

var withdrawRejections = map[string]problem.Details{
	hubproblem.ApplicationNotFoundError.Type:      hubproblem.ApplicationNotFoundError,
	hubproblem.ApplicationStateConflictError.Type: hubproblem.ApplicationStateConflictError,
	federationproblem.AuthorityNotFoundError.Type: hubproblem.ApplicationNotFoundError,
}

func Withdraw(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request applicationspec.WithdrawApplicationRequest
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
			s.InternalError(r.Context(), w, "digest withdraw request", err)
			return
		}
		response, ok := sendCommand(s, w, r, commandRequest{
			kind: federationspec.HubWithdrawKind, orgDID: orgDID,
			opening: request.OpeningNumber, applicant: identity.UserDID,
			key: key, digest: digest,
			payload: federationspec.HubWithdrawPayload{
				OpeningNumber:     request.OpeningNumber,
				ApplicationNumber: request.ApplicationNumber,
				ApplicantDID: hubspec.HubUserDID(
					dbvalue.FormatUUID(identity.UserDID),
				),
			},
		})
		if !ok {
			return
		}
		if response.Status != http.StatusOK {
			writeRejection(s, w, r, response, withdrawRejections)
			return
		}
		var result federationspec.HubWithdrawResult
		if err := json.Unmarshal(response.Body, &result); err != nil ||
			result.OpeningNumber != request.OpeningNumber ||
			result.ApplicationNumber != request.ApplicationNumber {
			s.InternalError(r.Context(), w, "decode hub-withdraw result",
				fmt.Errorf("unexpected result: %v", err))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, request)
	}
}
