package profile

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	operationspec "github.com/vetchium/src/typespec/hub/operations"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	"backend/internal/hub/professionalemail"
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
				code, err := credentials.NewVerificationCode()
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
						CodeHash: s.ProfessionalEmail.CodeHash(
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

// VerifyProfessionalEmailCode does not use handlerauth.RunIdempotent: once
// the code is accepted, professionalemail.Service.Advance makes network
// calls to the global directory, which must never run inside a DB
// transaction RunIdempotent would hold open for the whole request (mirrors
// ConfirmEmailChange; see backend/internal/hub/emailchange's package doc).
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
		emailID, err := dbvalue.ParseUUID(string(request.ID))
		if err != nil {
			s.InternalError(
				r.Context(), w, "parse validated professional email id", err,
			)
			return
		}
		result, err := s.ProfessionalEmail.Start(
			r.Context(), identity.UserDID, emailID, request, key,
		)
		switch {
		case errors.Is(err, professionalemail.ErrCodeRejected):
			problemForRejectedProfessionalEmailCode(
				r.Context(), s, w, emailID, identity.UserDID,
			)
		case errors.Is(err, professionalemail.ErrIdempotencyConflict):
			s.Problem(r.Context(), w, problem.IdempotencyKeyConflictError)
		case errors.Is(err, professionalemail.ErrPending):
			w.Header().Set("Cache-Control", "no-store")
			s.JSON(r.Context(), w, http.StatusAccepted,
				operationspec.PendingOperation{
					OperationID: operationspec.OperationID(result.OperationID),
				},
			)
		case err != nil:
			s.InternalError(r.Context(), w, "verify professional email code", err)
		default:
			w.Header().Set("Cache-Control", "no-store")
			s.Empty(r.Context(), w, http.StatusNoContent)
		}
	}
}

// problemForRejectedProfessionalEmailCode distinguishes an unknown or
// foreign professional email id (404) from a genuine code rejection (400),
// same as before this handler moved to professionalemail.Service.
func problemForRejectedProfessionalEmailCode(
	ctx context.Context, s *hubruntime.Server, w http.ResponseWriter,
	emailID, hubUserDID pgtype.UUID,
) {
	_, err := s.Queries.HubProfessionalEmailExistsForOwner(
		ctx, sqlc.HubProfessionalEmailExistsForOwnerParams{
			ProfessionalEmailID: emailID, HubUserDid: hubUserDID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		s.Problem(ctx, w, hubproblem.ProfileNotFoundError)
		return
	}
	if err != nil {
		s.InternalError(ctx, w, "check professional email owner", err)
		return
	}
	s.Problem(ctx, w, hubproblem.ProfessionalEmailCodeRejectedError)
}
