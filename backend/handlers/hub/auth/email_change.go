package auth

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubauth "github.com/vetchium/src/typespec/hub/auth"
	operationspec "github.com/vetchium/src/typespec/hub/operations"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/hub/emailchange"
	"backend/internal/middleware"
)

type emailChangeCodePayload struct {
	Code string `json:"code"`
}

func RequestEmailChange(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.RequestEmailChangeRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		address := string(request.NewEmailAddress)
		handlerauth.RunIdempotent(
			s, w, r, "hub:request-email-change",
			dbvalue.FormatUUID(identity.UserDID), key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[hubauth.EmailChangeChallenge],
				*handlerauth.Problem, error,
			) {
				zero := handlerauth.Result[hubauth.EmailChangeChallenge]{}
				// While a live change is in flight, neither issue nor
				// supersede a challenge for it (GU-ECH-001).
				inProgress, err := q.HubAccountEmailChangeInProgress(
					r.Context(), identity.UserDID,
				)
				if err != nil {
					return zero, nil, err
				}
				if inProgress {
					return handlerauth.Failure[hubauth.EmailChangeChallenge](
						hubproblem.EmailChangeInProgressError,
					)
				}
				challengeID, err := dbvalue.NewUUID()
				if err != nil {
					return zero, nil, err
				}
				code, err := credentials.NewVerificationCode()
				if err != nil {
					return zero, nil, err
				}
				payload, err := json.Marshal(emailChangeCodePayload{Code: code})
				if err != nil {
					return zero, nil, err
				}
				ciphertext, err := credentials.Encrypt(
					s.CredentialSubkey("outbox"), payload,
				)
				if err != nil {
					return zero, nil, err
				}
				// Resolved globally, including this tenant, so an address
				// registered anywhere gets the same response but no message
				// (GU-ECH-001). A resolve error still sends the code: the
				// authoritative check happens at reserve time, and confirm
				// would otherwise fail closed against a false negative here.
				_, details, err := s.Directory.ResolveHubAccountEmail(
					r.Context(), directoryspec.ResolveHubAccountEmailRequest{
						EmailDigest: directoryspec.EmailDigest(
							hex.EncodeToString(s.DigestKey.HubAccountEmail(address)),
						),
						DigestKeyID: directoryspec.DigestKeyID(s.DigestKey.ID()),
					},
				)
				globallyRegistered := err == nil && details == nil
				if _, err := q.SupersedeHubEmailChangeChallenges(
					r.Context(), identity.UserDID,
				); err != nil {
					return zero, nil, err
				}
				issued, err := q.IssueHubEmailChangeChallenge(
					r.Context(), sqlc.IssueHubEmailChangeChallengeParams{
						HubUserDid:         identity.UserDID,
						HubSessionID:       identity.SessionID,
						NewEmailAddress:    address,
						ChallengeID:        challengeID,
						CodeHash:           s.EmailChange.CodeHash(challengeID, code),
						PayloadCiphertext:  ciphertext,
						GloballyRegistered: globallyRegistered,
						TenantID:           s.TenantID,
						IdempotencyKey:     dbvalue.Text(string(key)),
					},
				)
				if err != nil {
					return zero, nil, err
				}
				switch issued.Result {
				case "issued":
					return handlerauth.Result[hubauth.EmailChangeChallenge]{
						Status: http.StatusAccepted,
						Body: hubauth.EmailChangeChallenge{
							ChallengeID: hubauth.HubEmailChangeChallengeID(
								dbvalue.FormatUUID(challengeID),
							),
							ExpiresAt: issued.ExpiresAt.Time.UTC(),
						},
					}, nil, nil
				case "rate_limited":
					return handlerauth.Failure[hubauth.EmailChangeChallenge](
						problem.RateLimitExceededError,
					)
				default:
					return handlerauth.AuthenticationFailure[hubauth.EmailChangeChallenge](
						hubproblem.AuthenticationRequiredError,
						hubauthn.BearerChallenge,
					)
				}
			},
		)
	}
}

func ConfirmEmailChange(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.ConfirmEmailChangeRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		result, err := s.EmailChange.Start(
			r.Context(), identity.UserDID, identity.SessionID, request, key,
		)
		switch {
		case errors.Is(err, emailchange.ErrCodeRejected):
			s.Problem(r.Context(), w, hubproblem.EmailChangeCodeRejectedError)
		case errors.Is(err, emailchange.ErrAddressUnavailable):
			s.Problem(r.Context(), w, hubproblem.EmailAddressUnavailableError)
		case errors.Is(err, emailchange.ErrUnavailable):
			s.Problem(r.Context(), w, hubproblem.EmailChangeUnavailableError)
		case errors.Is(err, emailchange.ErrIdempotencyConflict):
			s.Problem(r.Context(), w, problem.IdempotencyKeyConflictError)
		case errors.Is(err, emailchange.ErrPending):
			w.Header().Set("Cache-Control", "no-store")
			s.JSON(r.Context(), w, http.StatusAccepted,
				operationspec.PendingOperation{
					OperationID: operationspec.OperationID(result.OperationID),
				},
			)
		case err != nil:
			s.InternalError(r.Context(), w, "confirm Hub email change", err)
		default:
			w.Header().Set("Cache-Control", "no-store")
			s.Empty(r.Context(), w, http.StatusNoContent)
		}
	}
}
