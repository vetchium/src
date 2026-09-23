package profile

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	profilespec "github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

type professionalCodeEmailPayload struct {
	Code string `json:"code"`
}

func RequestProfessionalEmailCode(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request profilespec.ProfessionalEmailIDRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		handlerauth.RunIdempotent(
			s, w, r, "hub:profile:request-professional-email-code",
			dbvalue.FormatUUID(identity.UserDID), key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[profilespec.ProfessionalEmailChallenge],
				*handlerauth.Problem, error,
			) {
				zero := handlerauth.Result[profilespec.ProfessionalEmailChallenge]{}
				emailID, err := dbvalue.ParseUUID(string(request.ID))
				if err != nil {
					return zero, nil, err
				}
				challengeID, err := dbvalue.NewUUID()
				if err != nil {
					return zero, nil, err
				}
				code, err := newProfessionalCode()
				if err != nil {
					return zero, nil, err
				}
				payload, err := json.Marshal(
					professionalCodeEmailPayload{Code: code},
				)
				if err != nil {
					return zero, nil, err
				}
				ciphertext, err := credentials.Encrypt(
					s.CredentialSubkey("outbox"), payload,
				)
				if err != nil {
					return zero, nil, err
				}
				if _, err := q.SupersedeHubProfessionalEmailChallenges(
					r.Context(), sqlc.SupersedeHubProfessionalEmailChallengesParams{
						ProfessionalEmailID: emailID,
						HubUserDid:          identity.UserDID,
					},
				); err != nil {
					return zero, nil, err
				}
				issued, err := q.IssueHubProfessionalEmailChallenge(
					r.Context(), sqlc.IssueHubProfessionalEmailChallengeParams{
						ProfessionalEmailID: emailID,
						HubUserDid:          identity.UserDID,
						ChallengeID:         challengeID,
						CodeHash: professionalCodeHash(
							s.CredentialSubkey("professional-email-code"),
							challengeID, code,
						),
						PayloadCiphertext: ciphertext,
						TenantID:          s.TenantID,
						IdempotencyKey:    dbvalue.Text(string(key)),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					_, existsErr := q.HubProfessionalEmailExistsForOwner(
						r.Context(),
						sqlc.HubProfessionalEmailExistsForOwnerParams{
							ProfessionalEmailID: emailID,
							HubUserDid:          identity.UserDID,
						},
					)
					if errors.Is(existsErr, pgx.ErrNoRows) {
						return handlerauth.Failure[profilespec.ProfessionalEmailChallenge](hubproblem.ProfileNotFoundError)
					}
					if existsErr != nil {
						return zero, nil, existsErr
					}
					return handlerauth.Failure[profilespec.ProfessionalEmailChallenge](problem.RateLimitExceededError)
				}
				if err != nil {
					return zero, nil, err
				}
				return handlerauth.Result[profilespec.ProfessionalEmailChallenge]{
					Status: http.StatusAccepted,
					Body: profilespec.ProfessionalEmailChallenge{
						ChallengeID: profilespec.ProfileEntryID(
							dbvalue.FormatUUID(issued.ChallengeID),
						),
						ExpiresAt: issued.ExpiresAt.Time.UTC(),
					},
				}, nil, nil
			},
		)
	}
}

func VerifyProfessionalEmailCode(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request profilespec.VerifyProfessionalEmailRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		handlerauth.RunIdempotent(
			s, w, r, "hub:profile:verify-professional-email-code",
			dbvalue.FormatUUID(identity.UserDID), key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				zero := handlerauth.Result[struct{}]{}
				emailID, err := dbvalue.ParseUUID(string(request.ID))
				if err != nil {
					return zero, nil, err
				}
				challengeID, err := dbvalue.ParseUUID(
					string(request.ChallengeID),
				)
				if err != nil {
					return zero, nil, err
				}
				result, err := q.VerifyHubProfessionalEmailChallenge(
					r.Context(), sqlc.VerifyHubProfessionalEmailChallengeParams{
						ChallengeID:         challengeID,
						ProfessionalEmailID: emailID,
						HubUserDid:          identity.UserDID,
						CodeHash: professionalCodeHash(
							s.CredentialSubkey("professional-email-code"),
							challengeID, request.Code,
						),
						TenantID:       s.TenantID,
						IdempotencyKey: dbvalue.Text(string(key)),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					_, existsErr := q.HubProfessionalEmailExistsForOwner(
						r.Context(),
						sqlc.HubProfessionalEmailExistsForOwnerParams{
							ProfessionalEmailID: emailID,
							HubUserDid:          identity.UserDID,
						},
					)
					if errors.Is(existsErr, pgx.ErrNoRows) {
						return handlerauth.Failure[struct{}](
							hubproblem.ProfileNotFoundError,
						)
					}
					if existsErr != nil {
						return zero, nil, existsErr
					}
					return handlerauth.Failure[struct{}](
						hubproblem.ProfessionalEmailCodeRejectedError,
					)
				}
				if err != nil {
					return zero, nil, err
				}
				if !result.Verified {
					return handlerauth.CommittedFailure[struct{}](
						hubproblem.ProfessionalEmailCodeRejectedError,
					), nil, nil
				}
				return handlerauth.Result[struct{}]{
					Status: http.StatusNoContent,
				}, nil, nil
			},
		)
	}
}

func newProfessionalCode() (string, error) {
	number, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", number.Int64()), nil
}

func professionalCodeHash(
	key [32]byte, challengeID pgtype.UUID, code string,
) []byte {
	mac := hmac.New(sha256.New, key[:])
	_, _ = mac.Write([]byte(dbvalue.FormatUUID(challengeID)))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(code))
	return mac.Sum(nil)
}
