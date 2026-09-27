package auth

import (
	"context"
	"encoding/base64"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	orgsauth "github.com/vetchium/src/typespec/orgs/auth"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	orgsauthn "backend/internal/orgs/auth"
)

var orgTOTPProblems = handlerauth.TOTPProblems{
	InvalidLoginChallenge: orgsproblem.InvalidLoginChallengeError,
	IncorrectTOTPCode:     orgsproblem.IncorrectTOTPCodeError,
	IncorrectRecoveryCode: orgsproblem.IncorrectRecoveryCodeError,
	TOTPAlreadyEnabled:    orgsproblem.TOTPAlreadyEnabledError,
	TOTPNotEnabled:        orgsproblem.TOTPNotEnabledError,
	InvalidEnrollment:     orgsproblem.InvalidTOTPEnrollmentError,
	AuthenticationFailed:  orgsproblem.AuthenticationRequiredError,
	LoginChallenge:        orgsauthn.LoginTokenChallenge,
	BearerChallenge:       orgsauthn.BearerChallenge,
}

func lockedOrgLoginChallenge(
	ctx context.Context, q *sqlc.Queries, tokenHash []byte,
) (sqlc.GetOrgLoginChallengeRow, error) {
	var zero sqlc.GetOrgLoginChallengeRow
	userID, err := q.ResolveOrgLoginChallengeUser(ctx, tokenHash)
	if err != nil {
		return zero, err
	}
	if err := lockOrgUser(ctx, q, userID); err != nil {
		return zero, err
	}
	return q.GetOrgLoginChallenge(ctx, tokenHash)
}

func orgSecondFactorLogin(
	s *orgsruntime.Server, tokenHash []byte, now time.Time,
) handlerauth.SecondFactorLogin[sqlc.GetOrgLoginChallengeRow] {
	return handlerauth.SecondFactorLogin[sqlc.GetOrgLoginChallengeRow]{
		TokenHash: tokenHash,
		SessionDuration: func(sqlc.GetOrgLoginChallengeRow) time.Duration {
			return s.SessionTTL
		},
		Now:       now,
		Problems:  orgTOTPProblems,
		Challenge: lockedOrgLoginChallenge,
	}
}

func orgSession(
	challenge sqlc.GetOrgLoginChallengeRow,
	session handlerauth.IssuedSession,
) orgsauth.AuthenticatedSessionResponse {
	return sessionResponse(
		session.Token, session.ExpiresAt, challenge.PreferredLanguage,
	)
}

func VerifyTFA(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request orgsauth.VerifyTFARequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		challengeHash := credentials.TokenHash(
			string(request.LoginChallengeToken),
		)
		binding := base64.RawURLEncoding.EncodeToString(challengeHash)
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "orgs:login-tfa", binding, key, request,
			handlerauth.LoginReplayExpiresAt(s.SessionDurations(), now),
			func(q *sqlc.Queries) (
				handlerauth.Result[orgsauth.AuthenticatedSessionResponse],
				*handlerauth.Problem, error,
			) {
				return handlerauth.VerifyTOTPLogin(
					r.Context(), q,
					orgSecondFactorLogin(s, challengeHash, now),
					s.CredentialSubkey("totp"), string(request.TOTPCode),
					orgChallengeSecret,
					completeOrgTOTPLogin(s.TenantID, key),
					orgSession,
				)
			},
		)
	}
}

func VerifyRecoveryCode(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request orgsauth.VerifyRecoveryCodeRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		challengeHash := credentials.TokenHash(
			string(request.LoginChallengeToken),
		)
		binding := base64.RawURLEncoding.EncodeToString(challengeHash)
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "orgs:login-recovery-code", binding, key, request,
			handlerauth.LoginReplayExpiresAt(s.SessionDurations(), now),
			func(q *sqlc.Queries) (
				handlerauth.Result[orgsauth.VerifyRecoveryCodeResponse],
				*handlerauth.Problem, error,
			) {
				return handlerauth.VerifyRecoveryCodeLogin(
					r.Context(), q,
					orgSecondFactorLogin(s, challengeHash, now),
					string(request.RecoveryCode),
					completeOrgRecoveryCodeLogin(s.TenantID, key),
					orgRecoveryCodeSession,
				)
			},
		)
	}
}

func StartTOTPEnrollment(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		binding := dbvalue.FormatUUID(identity.UserID)
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "orgs:start-totp-enrollment", binding, key,
			struct{}{}, now.Add(handlerauth.TOTPEnrollmentTTL),
			func(q *sqlc.Queries) (
				handlerauth.Result[orgsauth.StartTOTPEnrollmentResponse],
				*handlerauth.Problem, error,
			) {
				return handlerauth.StartTOTPEnrollment(
					r.Context(), q,
					handlerauth.StartTOTPEnrollmentFlow{
						Subject:        identity.UserID,
						TenantID:       s.TenantID,
						IdempotencyKey: key,
						SecretKey:      s.CredentialSubkey("totp"),
						Issuer:         "Vetchium " + s.TenantID,
						ExpiresAt:      now.Add(handlerauth.TOTPEnrollmentTTL),
						Problems:       orgTOTPProblems,
						Lock:           lockOrgUser,
						Create:         createOrgTOTPEnrollment,
					},
					orgStartedEnrollment,
				)
			},
		)
	}
}

func ConfirmTOTPEnrollment(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request orgsauth.ConfirmTOTPEnrollmentRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		enrollmentHash := credentials.TokenHash(
			string(request.TOTPEnrollmentToken),
		)
		binding := dbvalue.FormatUUID(identity.UserID) + ":" +
			base64.RawURLEncoding.EncodeToString(enrollmentHash)
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "orgs:confirm-totp-enrollment", binding, key,
			request, now.Add(handlerauth.TOTPEnrollmentTTL),
			func(q *sqlc.Queries) (
				handlerauth.Result[orgsauth.ConfirmTOTPEnrollmentResponse],
				*handlerauth.Problem, error,
			) {
				return handlerauth.ConfirmTOTPEnrollment(
					r.Context(), q,
					handlerauth.ConfirmTOTPEnrollmentFlow{
						Subject:        identity.UserID,
						TokenHash:      enrollmentHash,
						Code:           string(request.TOTPCode),
						Now:            now,
						TenantID:       s.TenantID,
						IdempotencyKey: key,
						SecretKey:      s.CredentialSubkey("totp"),
						Problems:       orgTOTPProblems,
						Lock:           lockOrgUser,
						Enrollment:     orgTOTPEnrollment,
						Confirm: confirmOrgTOTPEnrollment(
							identity.SessionID,
						),
					},
					orgConfirmedEnrollment,
				)
			},
		)
	}
}

func DisableTOTP(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		active, err := handlerauth.WithCredentialLock(
			s, r, orgCredentialLocker(identity.UserID),
			func(q sqlc.Querier) (bool, error) {
				return q.DisableOrgTOTP(
					r.Context(), sqlc.DisableOrgTOTPParams{
						OrgUserID:           identity.UserID,
						CurrentOrgSessionID: identity.SessionID,
						TenantID:            s.TenantID,
					},
				)
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "disable Org TOTP", err)
			return
		}
		if !active {
			s.AuthenticationProblem(
				r.Context(), w, orgsproblem.AuthenticationRequiredError,
				orgsauthn.BearerChallenge,
			)
			return
		}
		s.Empty(r.Context(), w, http.StatusNoContent)
	}
}

func RegenerateTOTPRecoveryCodes(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		binding := dbvalue.FormatUUID(identity.UserID)
		handlerauth.RunIdempotent(
			s, w, r, "orgs:regenerate-totp-recovery-codes", binding,
			key, struct{}{},
			s.CurrentTime().Add(handlerauth.RecoveryCodeReplayWindow),
			func(q *sqlc.Queries) (
				handlerauth.Result[orgsauth.RegenerateTOTPRecoveryCodesResponse],
				*handlerauth.Problem, error,
			) {
				return handlerauth.RegenerateRecoveryCodes(
					r.Context(), q,
					handlerauth.RegenerateRecoveryCodesFlow{
						Subject:        identity.UserID,
						TenantID:       s.TenantID,
						IdempotencyKey: key,
						Problems:       orgTOTPProblems,
						Lock:           lockOrgUser,
						Enabled:        orgTOTPEnabled,
						Regenerate: regenerateOrgRecoveryCodes(
							identity.SessionID,
						),
					},
					orgRegeneratedCodes,
				)
			},
		)
	}
}

func createOrgTOTPEnrollment(
	ctx context.Context, q *sqlc.Queries,
	enrollment handlerauth.TOTPEnrollmentRequest,
) (handlerauth.CreatedTOTPEnrollment, error) {
	created, err := q.CreateOrgTOTPEnrollment(
		ctx, sqlc.CreateOrgTOTPEnrollmentParams{
			OrgUserID:        enrollment.Subject,
			TokenHash:        enrollment.TokenHash,
			SecretCiphertext: enrollment.SecretCiphertext,
			ExpiresAt:        dbvalue.Timestamp(enrollment.ExpiresAt),
			TenantID:         enrollment.TenantID,
			IdempotencyKey:   enrollment.IdempotencyKey,
		},
	)
	return handlerauth.CreatedTOTPEnrollment{
		ExpiresAt: created.ExpiresAt,
	}, err
}

func orgTOTPEnrollment(
	ctx context.Context, q *sqlc.Queries,
	tokenHash []byte, userID pgtype.UUID,
) (handlerauth.PendingTOTPEnrollment, error) {
	enrollment, err := q.GetOrgTOTPEnrollment(
		ctx, sqlc.GetOrgTOTPEnrollmentParams{
			TokenHash: tokenHash, OrgUserID: userID,
		},
	)
	return handlerauth.PendingTOTPEnrollment{
		EnrollmentID:     enrollment.OrgTotpEnrollmentID,
		SecretCiphertext: enrollment.SecretCiphertext,
	}, err
}

func confirmOrgTOTPEnrollment(sessionID pgtype.UUID) func(
	context.Context, *sqlc.Queries, handlerauth.ConfirmedTOTPEnrollment,
) (bool, error) {
	return func(
		ctx context.Context, q *sqlc.Queries,
		enrollment handlerauth.ConfirmedTOTPEnrollment,
	) (bool, error) {
		return q.ConfirmOrgTOTPEnrollment(
			ctx, sqlc.ConfirmOrgTOTPEnrollmentParams{
				OrgTotpEnrollmentID: enrollment.EnrollmentID,
				OrgUserID:           enrollment.Subject,
				SecretCiphertext:    enrollment.SecretCiphertext,
				TotpTimestep:        enrollment.Timestep,
				RecoveryCodeHashes:  enrollment.RecoveryCodeHashes,
				CurrentOrgSessionID: sessionID,
				TenantID:            enrollment.TenantID,
				IdempotencyKey:      enrollment.IdempotencyKey,
			},
		)
	}
}

func orgTOTPEnabled(
	ctx context.Context, q *sqlc.Queries, userID pgtype.UUID,
) (bool, error) {
	return q.OrgTOTPEnabled(ctx, userID)
}

func regenerateOrgRecoveryCodes(sessionID pgtype.UUID) func(
	context.Context, *sqlc.Queries, handlerauth.RegeneratedRecoveryCodes,
) (bool, error) {
	return func(
		ctx context.Context, q *sqlc.Queries,
		codes handlerauth.RegeneratedRecoveryCodes,
	) (bool, error) {
		return q.RegenerateOrgTOTPRecoveryCodes(
			ctx, sqlc.RegenerateOrgTOTPRecoveryCodesParams{
				OrgUserID:           codes.Subject,
				RecoveryCodeHashes:  codes.RecoveryCodeHashes,
				CurrentOrgSessionID: sessionID,
				TenantID:            codes.TenantID,
				IdempotencyKey:      codes.IdempotencyKey,
			},
		)
	}
}

func orgChallengeSecret(challenge sqlc.GetOrgLoginChallengeRow) []byte {
	return challenge.SecretCiphertext
}

func completeOrgTOTPLogin(
	tenantID string, key common.IdempotencyKey,
) func(
	context.Context, *sqlc.Queries, sqlc.GetOrgLoginChallengeRow,
	handlerauth.CompletedTOTPLogin,
) (pgtype.Timestamptz, error) {
	return func(
		ctx context.Context, q *sqlc.Queries,
		challenge sqlc.GetOrgLoginChallengeRow,
		login handlerauth.CompletedTOTPLogin,
	) (pgtype.Timestamptz, error) {
		session, err := q.CompleteOrgTOTPLogin(
			ctx, sqlc.CompleteOrgTOTPLoginParams{
				LastTotpTimestep:    login.Timestep,
				OrgUserID:           challenge.OrgUserID,
				OrgLoginChallengeID: challenge.OrgLoginChallengeID,
				SessionTokenHash:    login.SessionTokenHash,
				ExpiresAt:           login.ExpiresAt,
				TenantID:            tenantID,
				IdempotencyKey:      dbvalue.Text(string(key)),
			},
		)
		return session.ExpiresAt, err
	}
}

func completeOrgRecoveryCodeLogin(
	tenantID string, key common.IdempotencyKey,
) func(
	context.Context, *sqlc.Queries, sqlc.GetOrgLoginChallengeRow,
	handlerauth.CompletedRecoveryCodeLogin,
) (handlerauth.SpentRecoveryCode, error) {
	return func(
		ctx context.Context, q *sqlc.Queries,
		challenge sqlc.GetOrgLoginChallengeRow,
		login handlerauth.CompletedRecoveryCodeLogin,
	) (handlerauth.SpentRecoveryCode, error) {
		session, err := q.CompleteOrgRecoveryCodeLogin(
			ctx, sqlc.CompleteOrgRecoveryCodeLoginParams{
				OrgUserID:           challenge.OrgUserID,
				RecoveryCodeHash:    login.RecoveryCodeHash,
				OrgLoginChallengeID: challenge.OrgLoginChallengeID,
				SessionTokenHash:    login.SessionTokenHash,
				ExpiresAt:           login.ExpiresAt,
				TenantID:            tenantID,
				IdempotencyKey:      dbvalue.Text(string(key)),
			},
		)
		return handlerauth.SpentRecoveryCode{
			ExpiresAt:      session.ExpiresAt,
			RemainingCodes: session.RemainingCodes,
		}, err
	}
}

func orgRecoveryCodeSession(
	challenge sqlc.GetOrgLoginChallengeRow,
	session handlerauth.IssuedSession, remaining int64,
) orgsauth.VerifyRecoveryCodeResponse {
	return orgsauth.VerifyRecoveryCodeResponse{
		AuthenticatedSessionResponse: orgSession(challenge, session),
		RemainingRecoveryCodes:       common.TOTPRecoveryCodeCount(remaining),
	}
}

func orgStartedEnrollment(
	enrollment handlerauth.StartedTOTPEnrollment,
) orgsauth.StartTOTPEnrollmentResponse {
	return orgsauth.StartTOTPEnrollmentResponse{
		TOTPEnrollmentToken: common.TOTPEnrollmentToken(enrollment.Token),
		ProvisioningURI:     enrollment.ProvisioningURI,
		ManualEntryKey:      common.TOTPManualEntryKey(enrollment.Secret),
		Configuration:       common.StandardTOTPConfiguration(),
		ExpiresAt:           enrollment.ExpiresAt.UTC(),
	}
}

func orgConfirmedEnrollment(
	codes []common.TOTPRecoveryCode,
) orgsauth.ConfirmTOTPEnrollmentResponse {
	return orgsauth.ConfirmTOTPEnrollmentResponse{RecoveryCodes: codes}
}

func orgRegeneratedCodes(
	codes []common.TOTPRecoveryCode,
) orgsauth.RegenerateTOTPRecoveryCodesResponse {
	return orgsauth.RegenerateTOTPRecoveryCodesResponse{RecoveryCodes: codes}
}
