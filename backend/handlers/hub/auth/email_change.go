package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	hubauth "github.com/vetchium/src/typespec/hub/auth"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/middleware"
)

const emailChangeCodeSubkey = "email-change-code"

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
				if _, err := q.SupersedeHubEmailChangeChallenges(
					r.Context(), identity.UserDID,
				); err != nil {
					return zero, nil, err
				}
				issued, err := q.IssueHubEmailChangeChallenge(
					r.Context(), sqlc.IssueHubEmailChangeChallengeParams{
						HubUserDid:      identity.UserDID,
						HubSessionID:    identity.SessionID,
						NewEmailAddress: address,
						ChallengeID:     challengeID,
						CodeHash: credentials.VerificationCodeHash(
							s.CredentialSubkey(emailChangeCodeSubkey),
							dbvalue.FormatUUID(challengeID), code,
						),
						PayloadCiphertext: ciphertext,
						TenantID:          s.TenantID,
						IdempotencyKey:    dbvalue.Text(string(key)),
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
		handlerauth.RunIdempotent(
			s, w, r, "hub:confirm-email-change",
			dbvalue.FormatUUID(identity.UserDID), key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				zero := handlerauth.Result[struct{}]{}
				challengeID, err := dbvalue.ParseUUID(string(request.ChallengeID))
				if err != nil {
					return zero, nil, err
				}
				notice, err := credentials.Encrypt(
					s.CredentialSubkey("outbox"), []byte("{}"),
				)
				if err != nil {
					return zero, nil, err
				}
				result, err := q.ConfirmHubEmailChange(
					r.Context(), sqlc.ConfirmHubEmailChangeParams{
						ChallengeID:  challengeID,
						HubUserDid:   identity.UserDID,
						HubSessionID: identity.SessionID,
						CodeHash: credentials.VerificationCodeHash(
							s.CredentialSubkey(emailChangeCodeSubkey),
							dbvalue.FormatUUID(challengeID), request.Code,
						),
						NoticePayloadCiphertext: notice,
						TenantID:                s.TenantID,
						IdempotencyKey:          dbvalue.Text(string(key)),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[struct{}](
						hubproblem.EmailChangeCodeRejectedError,
					)
				}
				if isAccountEmailTaken(err) {
					return handlerauth.Failure[struct{}](
						hubproblem.EmailAddressUnavailableError,
					)
				}
				if err != nil {
					return zero, nil, err
				}
				if !result.Verified {
					return handlerauth.CommittedFailure[struct{}](
						hubproblem.EmailChangeCodeRejectedError,
					), nil, nil
				}
				return handlerauth.Result[struct{}]{
					Status: http.StatusNoContent,
				}, nil, nil
			},
		)
	}
}

// Another account can take the address between the code request and its
// confirmation, for example by completing signup with it.
func isAccountEmailTaken(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) &&
		databaseError.Code == "23505" &&
		databaseError.ConstraintName == "hub_users_email_address_key"
}
