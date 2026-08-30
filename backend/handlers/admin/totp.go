package admin

import (
	"context"
	"encoding/base64"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	adminauth "github.com/vetchium/src/typespec/admin/auth"
	"github.com/vetchium/src/typespec/common"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
)

var adminTOTPProblems = handlerauth.TOTPProblems{
	InvalidLoginChallenge: adminproblem.InvalidLoginChallengeError,
	IncorrectTOTPCode:     adminproblem.IncorrectTOTPCodeError,
	IncorrectRecoveryCode: adminproblem.IncorrectRecoveryCodeError,
	TOTPAlreadyEnabled:    adminproblem.TOTPAlreadyEnabledError,
	TOTPNotEnabled:        adminproblem.TOTPNotEnabledError,
	InvalidEnrollment:     adminproblem.InvalidTOTPEnrollmentError,
	AuthenticationFailed:  adminproblem.AdminAuthenticationRequiredError,
	LoginChallenge:        adminapi.LoginTokenChallenge,
	BearerChallenge:       adminapi.BearerChallenge,
}

func lockedAdminLoginChallenge(
	ctx context.Context, q *sqlc.Queries, tokenHash []byte,
) (sqlc.GetAdminLoginChallengeRow, error) {
	var zero sqlc.GetAdminLoginChallengeRow
	adminUserID, err := q.ResolveAdminLoginChallengeUser(ctx, tokenHash)
	if err != nil {
		return zero, err
	}
	if err := lockAdminUser(ctx, q, adminUserID); err != nil {
		return zero, err
	}
	return q.GetAdminLoginChallenge(ctx, tokenHash)
}

func adminSecondFactorLogin(
	s *adminapi.Server, tokenHash []byte, now time.Time,
) handlerauth.SecondFactorLogin[sqlc.GetAdminLoginChallengeRow] {
	return handlerauth.SecondFactorLogin[sqlc.GetAdminLoginChallengeRow]{
		TokenHash: tokenHash,
		SessionDuration: func(sqlc.GetAdminLoginChallengeRow) time.Duration {
			return s.SessionDuration(false)
		},
		Now:       now,
		Problems:  adminTOTPProblems,
		Challenge: lockedAdminLoginChallenge,
	}
}

func adminSession(
	challenge sqlc.GetAdminLoginChallengeRow,
	session handlerauth.IssuedSession,
) adminauth.AuthenticatedSessionResponse {
	return adminauth.AuthenticatedSessionResponse{
		SessionToken:     adminauth.AdminSessionToken(session.Token),
		SessionExpiresAt: session.ExpiresAt.UTC(),
		PreferredLanguage: common.FrontendLocale(
			challenge.PreferredLanguage,
		),
	}
}

func VerifyTFA(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.VerifyTFARequest
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
			s, w, r, "admin:login-tfa", binding, key, request,
			handlerauth.LoginReplayExpiresAt(s.SessionDurations, now),
			func(q *sqlc.Queries) (
				handlerauth.Result[adminauth.AuthenticatedSessionResponse],
				*handlerauth.Problem, error,
			) {
				return handlerauth.VerifyTOTPLogin(
					r.Context(), q,
					adminSecondFactorLogin(s, challengeHash, now),
					s.CredentialSubkey("totp"), string(request.TOTPCode),
					adminChallengeSecret,
					completeAdminTOTPLogin(s.TenantID, key),
					adminSession,
				)
			},
		)
	}
}

func VerifyRecoveryCode(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.VerifyRecoveryCodeRequest
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
			s, w, r, "admin:login-recovery-code", binding, key, request,
			handlerauth.LoginReplayExpiresAt(s.SessionDurations, now),
			func(q *sqlc.Queries) (
				handlerauth.Result[adminauth.VerifyRecoveryCodeResponse],
				*handlerauth.Problem, error,
			) {
				return handlerauth.VerifyRecoveryCodeLogin(
					r.Context(), q,
					adminSecondFactorLogin(s, challengeHash, now),
					string(request.RecoveryCode),
					completeAdminRecoveryCodeLogin(s.TenantID, key),
					adminRecoveryCodeSession,
				)
			},
		)
	}
}

func StartTOTPEnrollment(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		binding := dbvalue.FormatUUID(identity.UserID)
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "admin:start-totp-enrollment", binding, key,
			struct{}{}, now.Add(handlerauth.TOTPEnrollmentTTL),
			func(q *sqlc.Queries) (
				handlerauth.Result[adminauth.StartTOTPEnrollmentResponse],
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
						Problems:       adminTOTPProblems,
						Lock:           lockAdminUser,
						Create:         createAdminTOTPEnrollment,
					},
					adminStartedEnrollment,
				)
			},
		)
	}
}

func ConfirmTOTPEnrollment(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.ConfirmTOTPEnrollmentRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		enrollmentHash := credentials.TokenHash(
			string(request.TOTPEnrollmentToken),
		)
		binding := dbvalue.FormatUUID(identity.UserID) + ":" +
			base64.RawURLEncoding.EncodeToString(enrollmentHash)
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "admin:confirm-totp-enrollment", binding, key,
			request, now.Add(handlerauth.TOTPEnrollmentTTL),
			func(q *sqlc.Queries) (
				handlerauth.Result[adminauth.ConfirmTOTPEnrollmentResponse],
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
						Problems:       adminTOTPProblems,
						Lock:           lockAdminUser,
						Enrollment:     adminTOTPEnrollment,
						Confirm: confirmAdminTOTPEnrollment(
							identity.SessionID,
						),
					},
					adminConfirmedEnrollment,
				)
			},
		)
	}
}

func DisableTOTP(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		disabled, err := handlerauth.WithCredentialLock(
			s, r, adminCredentialLocker(adminCredentialLock{
				userID: identity.UserID,
			}),
			func(q sqlc.Querier) (bool, error) {
				return q.DisableAdminTOTP(
					r.Context(), sqlc.DisableAdminTOTPParams{
						TargetAdminUserID:     identity.UserID,
						CurrentAdminSessionID: identity.SessionID,
						TenantID:              s.TenantID,
					},
				)
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "disable admin TOTP", err)
			return
		}
		if !disabled {
			s.Problem(
				r.Context(), w,
				adminproblem.AdminAuthenticationRequiredError,
				adminapi.BearerChallenge,
			)
			return
		}
		s.Empty(r.Context(), w, http.StatusNoContent)
	}
}

func RegenerateTOTPRecoveryCodes(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		binding := dbvalue.FormatUUID(identity.UserID)
		handlerauth.RunIdempotent(
			s, w, r, "admin:regenerate-totp-recovery-codes", binding,
			key, struct{}{},
			s.CurrentTime().Add(handlerauth.RecoveryCodeReplayWindow),
			func(q *sqlc.Queries) (
				handlerauth.Result[adminauth.RegenerateTOTPRecoveryCodesResponse],
				*handlerauth.Problem, error,
			) {
				return handlerauth.RegenerateRecoveryCodes(
					r.Context(), q,
					handlerauth.RegenerateRecoveryCodesFlow{
						Subject:        identity.UserID,
						TenantID:       s.TenantID,
						IdempotencyKey: key,
						Problems:       adminTOTPProblems,
						Lock:           lockAdminUser,
						Enabled:        adminTOTPEnabled,
						Regenerate: regenerateAdminRecoveryCodes(
							identity.SessionID,
						),
					},
					adminRegeneratedCodes,
				)
			},
		)
	}
}

func createAdminTOTPEnrollment(
	ctx context.Context, q *sqlc.Queries,
	enrollment handlerauth.TOTPEnrollmentRequest,
) (handlerauth.CreatedTOTPEnrollment, error) {
	created, err := q.CreateAdminTOTPEnrollment(
		ctx, sqlc.CreateAdminTOTPEnrollmentParams{
			TargetAdminUserID: enrollment.Subject,
			TokenHash:         enrollment.TokenHash,
			SecretCiphertext:  enrollment.SecretCiphertext,
			ExpiresAt:         dbvalue.Timestamp(enrollment.ExpiresAt),
			TenantID:          enrollment.TenantID,
			IdempotencyKey:    enrollment.IdempotencyKey,
		},
	)
	return handlerauth.CreatedTOTPEnrollment{
		ExpiresAt: created.ExpiresAt,
	}, err
}

func adminTOTPEnrollment(
	ctx context.Context, q *sqlc.Queries,
	tokenHash []byte, adminUserID pgtype.UUID,
) (handlerauth.PendingTOTPEnrollment, error) {
	enrollment, err := q.GetAdminTOTPEnrollment(
		ctx, sqlc.GetAdminTOTPEnrollmentParams{
			TokenHash: tokenHash, TargetAdminUserID: adminUserID,
		},
	)
	return handlerauth.PendingTOTPEnrollment{
		EnrollmentID:     enrollment.AdminTotpEnrollmentID,
		SecretCiphertext: enrollment.SecretCiphertext,
	}, err
}

func confirmAdminTOTPEnrollment(sessionID pgtype.UUID) func(
	context.Context, *sqlc.Queries, handlerauth.ConfirmedTOTPEnrollment,
) (bool, error) {
	return func(
		ctx context.Context, q *sqlc.Queries,
		enrollment handlerauth.ConfirmedTOTPEnrollment,
	) (bool, error) {
		return q.ConfirmAdminTOTPEnrollment(
			ctx, sqlc.ConfirmAdminTOTPEnrollmentParams{
				TargetEnrollmentID:    enrollment.EnrollmentID,
				TargetAdminUserID:     enrollment.Subject,
				SecretCiphertext:      enrollment.SecretCiphertext,
				TotpTimestep:          enrollment.Timestep,
				RecoveryCodeHashes:    enrollment.RecoveryCodeHashes,
				CurrentAdminSessionID: sessionID,
				TenantID:              enrollment.TenantID,
				IdempotencyKey:        enrollment.IdempotencyKey,
			},
		)
	}
}

func adminTOTPEnabled(
	ctx context.Context, q *sqlc.Queries, adminUserID pgtype.UUID,
) (bool, error) {
	return q.AdminTOTPEnabled(ctx, adminUserID)
}

func regenerateAdminRecoveryCodes(sessionID pgtype.UUID) func(
	context.Context, *sqlc.Queries, handlerauth.RegeneratedRecoveryCodes,
) (bool, error) {
	return func(
		ctx context.Context, q *sqlc.Queries,
		codes handlerauth.RegeneratedRecoveryCodes,
	) (bool, error) {
		return q.RegenerateAdminTOTPRecoveryCodes(
			ctx, sqlc.RegenerateAdminTOTPRecoveryCodesParams{
				TargetAdminUserID:     codes.Subject,
				RecoveryCodeHashes:    codes.RecoveryCodeHashes,
				CurrentAdminSessionID: sessionID,
				TenantID:              codes.TenantID,
				IdempotencyKey:        codes.IdempotencyKey,
			},
		)
	}
}

func adminChallengeSecret(challenge sqlc.GetAdminLoginChallengeRow) []byte {
	return challenge.TotpSecretCiphertext
}

func completeAdminTOTPLogin(
	tenantID string, key common.IdempotencyKey,
) func(
	context.Context, *sqlc.Queries, sqlc.GetAdminLoginChallengeRow,
	handlerauth.CompletedTOTPLogin,
) (pgtype.Timestamptz, error) {
	return func(
		ctx context.Context, q *sqlc.Queries,
		challenge sqlc.GetAdminLoginChallengeRow,
		login handlerauth.CompletedTOTPLogin,
	) (pgtype.Timestamptz, error) {
		session, err := q.CompleteAdminTOTPLogin(
			ctx, sqlc.CompleteAdminTOTPLoginParams{
				AdminLoginChallengeID: challenge.AdminLoginChallengeID,
				AdminUserID:           challenge.AdminUserID,
				LastTotpTimestep:      login.Timestep,
				SessionTokenHash:      login.SessionTokenHash,
				ExpiresAt:             login.ExpiresAt,
				TenantID:              tenantID,
				IdempotencyKey:        dbvalue.Text(string(key)),
			},
		)
		return session.ExpiresAt, err
	}
}

func completeAdminRecoveryCodeLogin(
	tenantID string, key common.IdempotencyKey,
) func(
	context.Context, *sqlc.Queries, sqlc.GetAdminLoginChallengeRow,
	handlerauth.CompletedRecoveryCodeLogin,
) (handlerauth.SpentRecoveryCode, error) {
	return func(
		ctx context.Context, q *sqlc.Queries,
		challenge sqlc.GetAdminLoginChallengeRow,
		login handlerauth.CompletedRecoveryCodeLogin,
	) (handlerauth.SpentRecoveryCode, error) {
		session, err := q.CompleteAdminRecoveryCodeLogin(
			ctx, sqlc.CompleteAdminRecoveryCodeLoginParams{
				TargetAdminUserID:     challenge.AdminUserID,
				RecoveryCodeHash:      login.RecoveryCodeHash,
				AdminLoginChallengeID: challenge.AdminLoginChallengeID,
				SessionTokenHash:      login.SessionTokenHash,
				SessionExpiresAt:      login.ExpiresAt,
				TenantID:              tenantID,
				IdempotencyKey:        dbvalue.Text(string(key)),
			},
		)
		return handlerauth.SpentRecoveryCode{
			ExpiresAt:      session.ExpiresAt,
			RemainingCodes: session.RemainingCodes,
		}, err
	}
}

func adminRecoveryCodeSession(
	challenge sqlc.GetAdminLoginChallengeRow,
	session handlerauth.IssuedSession, remaining int64,
) adminauth.VerifyRecoveryCodeResponse {
	return adminauth.VerifyRecoveryCodeResponse{
		AuthenticatedSessionResponse: adminSession(challenge, session),
		RemainingRecoveryCodes:       common.TOTPRecoveryCodeCount(remaining),
	}
}

func adminStartedEnrollment(
	enrollment handlerauth.StartedTOTPEnrollment,
) adminauth.StartTOTPEnrollmentResponse {
	return adminauth.StartTOTPEnrollmentResponse{
		TOTPEnrollmentToken: common.TOTPEnrollmentToken(enrollment.Token),
		ProvisioningURI:     enrollment.ProvisioningURI,
		ManualEntryKey:      common.TOTPManualEntryKey(enrollment.Secret),
		Configuration:       common.StandardTOTPConfiguration(),
		ExpiresAt:           enrollment.ExpiresAt.UTC(),
	}
}

func adminConfirmedEnrollment(
	codes []common.TOTPRecoveryCode,
) adminauth.ConfirmTOTPEnrollmentResponse {
	return adminauth.ConfirmTOTPEnrollmentResponse{RecoveryCodes: codes}
}

func adminRegeneratedCodes(
	codes []common.TOTPRecoveryCode,
) adminauth.RegenerateTOTPRecoveryCodesResponse {
	return adminauth.RegenerateTOTPRecoveryCodesResponse{RecoveryCodes: codes}
}
