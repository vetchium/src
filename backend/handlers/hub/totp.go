package hub

import (
	"context"
	"encoding/base64"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	hubauth "github.com/vetchium/src/typespec/hub/auth"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/hubapi"
	"backend/internal/middleware"
)

var hubTOTPProblems = handlerauth.TOTPProblems{
	InvalidLoginChallenge: hubproblem.InvalidLoginChallengeError,
	IncorrectTOTPCode:     hubproblem.IncorrectTOTPCodeError,
	IncorrectRecoveryCode: hubproblem.IncorrectRecoveryCodeError,
	TOTPAlreadyEnabled:    hubproblem.TOTPAlreadyEnabledError,
	TOTPNotEnabled:        hubproblem.TOTPNotEnabledError,
	InvalidEnrollment:     hubproblem.InvalidTOTPEnrollmentError,
	AuthenticationFailed:  hubproblem.AuthenticationRequiredError,
	LoginChallenge:        hubapi.LoginTokenChallenge,
	BearerChallenge:       hubapi.BearerChallenge,
}

func lockedHubLoginChallenge(
	ctx context.Context, q *sqlc.Queries, tokenHash []byte,
) (sqlc.GetHubLoginChallengeRow, error) {
	var zero sqlc.GetHubLoginChallengeRow
	userDID, err := q.ResolveHubLoginChallengeUser(ctx, tokenHash)
	if err != nil {
		return zero, err
	}
	if err := lockHubUser(ctx, q, userDID); err != nil {
		return zero, err
	}
	return q.GetHubLoginChallenge(ctx, tokenHash)
}

func hubSecondFactorLogin(
	s *hubapi.Server, tokenHash []byte, now time.Time,
) handlerauth.SecondFactorLogin[sqlc.GetHubLoginChallengeRow] {
	return handlerauth.SecondFactorLogin[sqlc.GetHubLoginChallengeRow]{
		TokenHash: tokenHash,
		SessionDuration: func(
			challenge sqlc.GetHubLoginChallengeRow,
		) time.Duration {
			return s.SessionDuration(challenge.Remembered)
		},
		Now:       now,
		Problems:  hubTOTPProblems,
		Challenge: lockedHubLoginChallenge,
	}
}

func hubSession(
	challenge sqlc.GetHubLoginChallengeRow,
	session handlerauth.IssuedSession,
) hubauth.AuthenticatedSessionResponse {
	return authenticatedSessionResponse(
		session.Token, session.ExpiresAt, challenge.HubUserDid,
		challenge.Handle, challenge.PreferredLanguage,
		challenge.ResidentCountry,
	)
}

func VerifyTFA(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.VerifyTFARequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
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
			s, w, r, "hub:login-tfa", binding, key, request,
			handlerauth.LoginReplayExpiresAt(s.SessionDurations, now),
			func(q *sqlc.Queries) (
				handlerauth.Result[hubauth.AuthenticatedSessionResponse],
				*handlerauth.Problem, error,
			) {
				return handlerauth.VerifyTOTPLogin(
					r.Context(), q,
					hubSecondFactorLogin(s, challengeHash, now),
					s.CredentialSubkey("totp"), string(request.TOTPCode),
					hubChallengeSecret,
					completeHubTOTPLogin(s.TenantID, key),
					hubSession,
				)
			},
		)
	}
}

func VerifyRecoveryCode(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.VerifyRecoveryCodeRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
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
			s, w, r, "hub:login-recovery-code", binding, key, request,
			handlerauth.LoginReplayExpiresAt(s.SessionDurations, now),
			func(q *sqlc.Queries) (
				handlerauth.Result[hubauth.VerifyRecoveryCodeResponse],
				*handlerauth.Problem, error,
			) {
				return handlerauth.VerifyRecoveryCodeLogin(
					r.Context(), q,
					hubSecondFactorLogin(s, challengeHash, now),
					string(request.RecoveryCode),
					completeHubRecoveryCodeLogin(s.TenantID, key),
					hubRecoveryCodeSession,
				)
			},
		)
	}
}

func StartTOTPEnrollment(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		binding := dbvalue.FormatUUID(identity.UserDID)
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "hub:start-totp-enrollment", binding, key,
			struct{}{}, now.Add(handlerauth.TOTPEnrollmentTTL),
			func(q *sqlc.Queries) (
				handlerauth.Result[hubauth.StartTOTPEnrollmentResponse],
				*handlerauth.Problem, error,
			) {
				return handlerauth.StartTOTPEnrollment(
					r.Context(), q,
					handlerauth.StartTOTPEnrollmentFlow{
						Subject:        identity.UserDID,
						TenantID:       s.TenantID,
						IdempotencyKey: key,
						SecretKey:      s.CredentialSubkey("totp"),
						Issuer:         "Vetchium " + s.TenantID,
						ExpiresAt:      now.Add(handlerauth.TOTPEnrollmentTTL),
						Problems:       hubTOTPProblems,
						Lock:           lockHubUser,
						Create:         createHubTOTPEnrollment,
					},
					hubStartedEnrollment,
				)
			},
		)
	}
}

func ConfirmTOTPEnrollment(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.ConfirmTOTPEnrollmentRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		enrollmentHash := credentials.TokenHash(
			string(request.TOTPEnrollmentToken),
		)
		binding := dbvalue.FormatUUID(identity.UserDID) + ":" +
			base64.RawURLEncoding.EncodeToString(enrollmentHash)
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "hub:confirm-totp-enrollment", binding, key,
			request, now.Add(handlerauth.TOTPEnrollmentTTL),
			func(q *sqlc.Queries) (
				handlerauth.Result[hubauth.ConfirmTOTPEnrollmentResponse],
				*handlerauth.Problem, error,
			) {
				return handlerauth.ConfirmTOTPEnrollment(
					r.Context(), q,
					handlerauth.ConfirmTOTPEnrollmentFlow{
						Subject:        identity.UserDID,
						TokenHash:      enrollmentHash,
						Code:           string(request.TOTPCode),
						Now:            now,
						TenantID:       s.TenantID,
						IdempotencyKey: key,
						SecretKey:      s.CredentialSubkey("totp"),
						Problems:       hubTOTPProblems,
						Lock:           lockHubUser,
						Enrollment:     hubTOTPEnrollment,
						Confirm: confirmHubTOTPEnrollment(
							identity.SessionID,
						),
					},
					hubConfirmedEnrollment,
				)
			},
		)
	}
}

func DisableTOTP(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		disabled, err := handlerauth.WithCredentialLock(
			s, r, hubCredentialLocker(hubCredentialLock{
				userDID: identity.UserDID,
			}),
			func(q sqlc.Querier) (bool, error) {
				return q.DisableHubTOTP(
					r.Context(), sqlc.DisableHubTOTPParams{
						HubUserDid:          identity.UserDID,
						CurrentHubSessionID: identity.SessionID,
						TenantID:            s.TenantID,
					},
				)
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "disable Hub TOTP", err)
			return
		}
		if !disabled {
			s.Problem(
				r.Context(), w, hubproblem.AuthenticationRequiredError,
				hubapi.BearerChallenge,
			)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func RegenerateTOTPRecoveryCodes(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		binding := dbvalue.FormatUUID(identity.UserDID)
		handlerauth.RunIdempotent(
			s, w, r, "hub:regenerate-totp-recovery-codes", binding,
			key, struct{}{},
			s.CurrentTime().Add(handlerauth.RecoveryCodeReplayWindow),
			func(q *sqlc.Queries) (
				handlerauth.Result[hubauth.RegenerateTOTPRecoveryCodesResponse],
				*handlerauth.Problem, error,
			) {
				return handlerauth.RegenerateRecoveryCodes(
					r.Context(), q,
					handlerauth.RegenerateRecoveryCodesFlow{
						Subject:        identity.UserDID,
						TenantID:       s.TenantID,
						IdempotencyKey: key,
						Problems:       hubTOTPProblems,
						Lock:           lockHubUser,
						Enabled:        hubTOTPEnabled,
						Regenerate: regenerateHubRecoveryCodes(
							identity.SessionID,
						),
					},
					hubRegeneratedCodes,
				)
			},
		)
	}
}

func createHubTOTPEnrollment(
	ctx context.Context, q *sqlc.Queries,
	enrollment handlerauth.TOTPEnrollmentRequest,
) (handlerauth.CreatedTOTPEnrollment, error) {
	created, err := q.CreateHubTOTPEnrollment(
		ctx, sqlc.CreateHubTOTPEnrollmentParams{
			HubUserDid:       enrollment.Subject,
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

func hubTOTPEnrollment(
	ctx context.Context, q *sqlc.Queries,
	tokenHash []byte, userDID pgtype.UUID,
) (handlerauth.PendingTOTPEnrollment, error) {
	enrollment, err := q.GetHubTOTPEnrollment(
		ctx, sqlc.GetHubTOTPEnrollmentParams{
			TokenHash: tokenHash, HubUserDid: userDID,
		},
	)
	return handlerauth.PendingTOTPEnrollment{
		EnrollmentID:     enrollment.HubTotpEnrollmentID,
		SecretCiphertext: enrollment.SecretCiphertext,
	}, err
}

func confirmHubTOTPEnrollment(sessionID pgtype.UUID) func(
	context.Context, *sqlc.Queries, handlerauth.ConfirmedTOTPEnrollment,
) (bool, error) {
	return func(
		ctx context.Context, q *sqlc.Queries,
		enrollment handlerauth.ConfirmedTOTPEnrollment,
	) (bool, error) {
		return q.ConfirmHubTOTPEnrollment(
			ctx, sqlc.ConfirmHubTOTPEnrollmentParams{
				HubTotpEnrollmentID: enrollment.EnrollmentID,
				HubUserDid:          enrollment.Subject,
				SecretCiphertext:    enrollment.SecretCiphertext,
				TotpTimestep:        enrollment.Timestep,
				RecoveryCodeHashes:  enrollment.RecoveryCodeHashes,
				CurrentHubSessionID: sessionID,
				TenantID:            enrollment.TenantID,
				IdempotencyKey:      enrollment.IdempotencyKey,
			},
		)
	}
}

func hubTOTPEnabled(
	ctx context.Context, q *sqlc.Queries, userDID pgtype.UUID,
) (bool, error) {
	return q.HubTOTPEnabled(ctx, userDID)
}

func regenerateHubRecoveryCodes(sessionID pgtype.UUID) func(
	context.Context, *sqlc.Queries, handlerauth.RegeneratedRecoveryCodes,
) (bool, error) {
	return func(
		ctx context.Context, q *sqlc.Queries,
		codes handlerauth.RegeneratedRecoveryCodes,
	) (bool, error) {
		return q.RegenerateHubTOTPRecoveryCodes(
			ctx, sqlc.RegenerateHubTOTPRecoveryCodesParams{
				HubUserDid:          codes.Subject,
				RecoveryCodeHashes:  codes.RecoveryCodeHashes,
				CurrentHubSessionID: sessionID,
				TenantID:            codes.TenantID,
				IdempotencyKey:      codes.IdempotencyKey,
			},
		)
	}
}

func hubChallengeSecret(challenge sqlc.GetHubLoginChallengeRow) []byte {
	return challenge.TotpSecretCiphertext
}

func completeHubTOTPLogin(
	tenantID string, key common.IdempotencyKey,
) func(
	context.Context, *sqlc.Queries, sqlc.GetHubLoginChallengeRow,
	handlerauth.CompletedTOTPLogin,
) (pgtype.Timestamptz, error) {
	return func(
		ctx context.Context, q *sqlc.Queries,
		challenge sqlc.GetHubLoginChallengeRow,
		login handlerauth.CompletedTOTPLogin,
	) (pgtype.Timestamptz, error) {
		session, err := q.CompleteHubTOTPLogin(
			ctx, sqlc.CompleteHubTOTPLoginParams{
				LastTotpTimestep:    login.Timestep,
				HubUserDid:          challenge.HubUserDid,
				HubLoginChallengeID: challenge.HubLoginChallengeID,
				SessionTokenHash:    login.SessionTokenHash,
				ExpiresAt:           login.ExpiresAt,
				Remembered:          challenge.Remembered,
				TenantID:            tenantID,
				IdempotencyKey:      dbvalue.Text(string(key)),
			},
		)
		return session.ExpiresAt, err
	}
}

func completeHubRecoveryCodeLogin(
	tenantID string, key common.IdempotencyKey,
) func(
	context.Context, *sqlc.Queries, sqlc.GetHubLoginChallengeRow,
	handlerauth.CompletedRecoveryCodeLogin,
) (handlerauth.SpentRecoveryCode, error) {
	return func(
		ctx context.Context, q *sqlc.Queries,
		challenge sqlc.GetHubLoginChallengeRow,
		login handlerauth.CompletedRecoveryCodeLogin,
	) (handlerauth.SpentRecoveryCode, error) {
		session, err := q.CompleteHubRecoveryCodeLogin(
			ctx, sqlc.CompleteHubRecoveryCodeLoginParams{
				HubUserDid:          challenge.HubUserDid,
				RecoveryCodeHash:    login.RecoveryCodeHash,
				HubLoginChallengeID: challenge.HubLoginChallengeID,
				SessionTokenHash:    login.SessionTokenHash,
				ExpiresAt:           login.ExpiresAt,
				Remembered:          challenge.Remembered,
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

func hubRecoveryCodeSession(
	challenge sqlc.GetHubLoginChallengeRow,
	session handlerauth.IssuedSession, remaining int64,
) hubauth.VerifyRecoveryCodeResponse {
	return hubauth.VerifyRecoveryCodeResponse{
		AuthenticatedSessionResponse: hubSession(challenge, session),
		RemainingRecoveryCodes:       common.TOTPRecoveryCodeCount(remaining),
	}
}

func hubStartedEnrollment(
	enrollment handlerauth.StartedTOTPEnrollment,
) hubauth.StartTOTPEnrollmentResponse {
	return hubauth.StartTOTPEnrollmentResponse{
		TOTPEnrollmentToken: common.TOTPEnrollmentToken(enrollment.Token),
		ProvisioningURI:     enrollment.ProvisioningURI,
		ManualEntryKey:      common.TOTPManualEntryKey(enrollment.Secret),
		Configuration:       common.StandardTOTPConfiguration(),
		ExpiresAt:           enrollment.ExpiresAt.UTC(),
	}
}

func hubConfirmedEnrollment(
	codes []common.TOTPRecoveryCode,
) hubauth.ConfirmTOTPEnrollmentResponse {
	return hubauth.ConfirmTOTPEnrollmentResponse{RecoveryCodes: codes}
}

func hubRegeneratedCodes(
	codes []common.TOTPRecoveryCode,
) hubauth.RegenerateTOTPRecoveryCodesResponse {
	return hubauth.RegenerateTOTPRecoveryCodesResponse{RecoveryCodes: codes}
}
