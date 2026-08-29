package admin

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	adminauth "github.com/vetchium/src/typespec/admin/auth"
	"github.com/vetchium/src/typespec/common"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
)

const (
	totpEnrollmentTTL = 10 * time.Minute
	recentAuthAge     = 5 * time.Minute
)

func getLockedAdminLoginChallenge(
	ctx context.Context, q *sqlc.Queries, tokenHash []byte,
) (sqlc.GetAdminLoginChallengeRow, error) {
	var zero sqlc.GetAdminLoginChallengeRow
	adminUserID, err := q.ResolveAdminLoginChallengeUser(ctx, tokenHash)
	if err != nil {
		return zero, err
	}
	if _, err := q.LockAdminUserCredentialMutation(ctx, adminUserID); err != nil {
		return zero, err
	}
	return q.GetAdminLoginChallenge(ctx, tokenHash)
}

func VerifyTFA(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.VerifyTFARequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		binding := base64.RawURLEncoding.EncodeToString(credentials.TokenHash(
			string(request.LoginChallengeToken),
		))
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "admin:login-tfa", binding, key, request,
			handlerauth.LoginReplayExpiresAt(s.SessionDurations, now),
			func(q *sqlc.Queries) (
				handlerauth.Result[adminauth.AuthenticatedSessionResponse],
				*handlerauth.Problem, error,
			) {
				challenge, err := getLockedAdminLoginChallenge(
					r.Context(), q, credentials.TokenHash(
						string(request.LoginChallengeToken),
					),
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[adminauth.AuthenticatedSessionResponse](
						adminproblem.InvalidLoginChallengeError,
						adminapi.LoginTokenChallenge,
					)
				}
				if err != nil {
					return handlerauth.Result[adminauth.AuthenticatedSessionResponse]{}, nil, err
				}
				secret, err := credentials.Decrypt(
					s.CredentialSubkey("totp"), challenge.TotpSecretCiphertext,
				)
				if err != nil {
					return handlerauth.Result[adminauth.AuthenticatedSessionResponse]{}, nil, err
				}
				timestep, valid := credentials.VerifyTOTP(
					string(secret), string(request.TOTPCode), now,
				)
				if !valid {
					return handlerauth.Result[adminauth.AuthenticatedSessionResponse]{},
						&handlerauth.Problem{Details: adminproblem.IncorrectTOTPCodeError}, nil
				}
				token, tokenHash, err := credentials.NewToken()
				if err != nil {
					return handlerauth.Result[adminauth.AuthenticatedSessionResponse]{}, nil, err
				}
				expiresAt := now.Add(s.SessionDuration(false))
				session, err := q.CompleteAdminTOTPLogin(
					r.Context(), sqlc.CompleteAdminTOTPLoginParams{
						AdminLoginChallengeID: challenge.AdminLoginChallengeID,
						AdminUserID:           challenge.AdminUserID,
						LastTotpTimestep:      dbvalue.Int64(timestep),
						SessionTokenHash:      tokenHash,
						ExpiresAt:             dbvalue.Timestamp(expiresAt),
						TenantID:              s.TenantID,
						IdempotencyKey:        dbvalue.Text(string(key)),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Result[adminauth.AuthenticatedSessionResponse]{},
						&handlerauth.Problem{Details: adminproblem.IncorrectTOTPCodeError}, nil
				}
				if err != nil {
					return handlerauth.Result[adminauth.AuthenticatedSessionResponse]{}, nil, err
				}
				if session.ExpiresAt.Valid {
					expiresAt = session.ExpiresAt.Time
				}
				return handlerauth.Result[adminauth.AuthenticatedSessionResponse]{
					Status: http.StatusOK,
					Body: adminauth.AuthenticatedSessionResponse{
						SessionToken:      adminauth.AdminSessionToken(token),
						SessionExpiresAt:  expiresAt.UTC(),
						PreferredLanguage: common.FrontendLocale(challenge.PreferredLanguage),
					},
				}, nil, nil
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
			struct{}{}, now.Add(totpEnrollmentTTL),
			func(q *sqlc.Queries) (
				handlerauth.Result[adminauth.StartTOTPEnrollmentResponse],
				*handlerauth.Problem, error,
			) {
				if _, err := q.LockAdminUserCredentialMutation(
					r.Context(), identity.UserID,
				); err != nil {
					return handlerauth.Result[adminauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				secret, err := credentials.NewTOTPSecret()
				if err != nil {
					return handlerauth.Result[adminauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				ciphertext, err := credentials.Encrypt(
					s.CredentialSubkey("totp"), []byte(secret),
				)
				if err != nil {
					return handlerauth.Result[adminauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				token, tokenHash, err := credentials.NewToken()
				if err != nil {
					return handlerauth.Result[adminauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				expiresAt := now.Add(totpEnrollmentTTL)
				enrollment, err := q.CreateAdminTOTPEnrollment(
					r.Context(), sqlc.CreateAdminTOTPEnrollmentParams{
						TargetAdminUserID: identity.UserID,
						TokenHash:         tokenHash,
						SecretCiphertext:  ciphertext,
						ExpiresAt:         dbvalue.Timestamp(expiresAt),
						TenantID:          s.TenantID,
						IdempotencyKey:    dbvalue.Text(string(key)),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Result[adminauth.StartTOTPEnrollmentResponse]{},
						&handlerauth.Problem{Details: adminproblem.TOTPAlreadyEnabledError}, nil
				}
				if err != nil {
					return handlerauth.Result[adminauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				if enrollment.ExpiresAt.Valid {
					expiresAt = enrollment.ExpiresAt.Time
				}
				return handlerauth.Result[adminauth.StartTOTPEnrollmentResponse]{
					Status: http.StatusOK,
					Body: adminauth.StartTOTPEnrollmentResponse{
						TOTPEnrollmentToken: common.TOTPEnrollmentToken(token),
						ProvisioningURI: credentials.TOTPProvisioningURI(
							binding, "Vetchium "+s.TenantID, secret,
						),
						ManualEntryKey: common.TOTPManualEntryKey(secret),
						Configuration:  common.StandardTOTPConfiguration(),
						ExpiresAt:      expiresAt.UTC(),
					},
				}, nil, nil
			},
		)
	}
}

func ConfirmTOTPEnrollment(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.ConfirmTOTPEnrollmentRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		binding := dbvalue.FormatUUID(identity.UserID) + ":" +
			base64.RawURLEncoding.EncodeToString(credentials.TokenHash(
				string(request.TOTPEnrollmentToken),
			))
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "admin:confirm-totp-enrollment", binding, key,
			request, now.Add(totpEnrollmentTTL),
			func(q *sqlc.Queries) (
				handlerauth.Result[adminauth.ConfirmTOTPEnrollmentResponse],
				*handlerauth.Problem, error,
			) {
				if _, err := q.LockAdminUserCredentialMutation(
					r.Context(), identity.UserID,
				); err != nil {
					return handlerauth.Result[adminauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				enrollment, err := q.GetAdminTOTPEnrollment(
					r.Context(), sqlc.GetAdminTOTPEnrollmentParams{
						TokenHash: credentials.TokenHash(
							string(request.TOTPEnrollmentToken),
						),
						TargetAdminUserID: identity.UserID,
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Result[adminauth.ConfirmTOTPEnrollmentResponse]{},
						&handlerauth.Problem{Details: adminproblem.InvalidTOTPEnrollmentError}, nil
				}
				if err != nil {
					return handlerauth.Result[adminauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				secret, err := credentials.Decrypt(
					s.CredentialSubkey("totp"), enrollment.SecretCiphertext,
				)
				if err != nil {
					return handlerauth.Result[adminauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				timestep, valid := credentials.VerifyTOTP(
					string(secret), string(request.TOTPCode), now,
				)
				if !valid {
					return handlerauth.Result[adminauth.ConfirmTOTPEnrollmentResponse]{},
						&handlerauth.Problem{Details: adminproblem.IncorrectTOTPCodeError}, nil
				}
				codes, hashes, err := credentials.NewRecoveryCodes()
				if err != nil {
					return handlerauth.Result[adminauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				confirmed, err := q.ConfirmAdminTOTPEnrollment(
					r.Context(), sqlc.ConfirmAdminTOTPEnrollmentParams{
						TargetEnrollmentID:    enrollment.AdminTotpEnrollmentID,
						TargetAdminUserID:     identity.UserID,
						SecretCiphertext:      enrollment.SecretCiphertext,
						TotpTimestep:          dbvalue.Int64(timestep),
						RecoveryCodeHashes:    hashes,
						CurrentAdminSessionID: identity.SessionID,
						TenantID:              s.TenantID,
						IdempotencyKey:        dbvalue.Text(string(key)),
					},
				)
				if err != nil {
					return handlerauth.Result[adminauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				if !confirmed {
					return handlerauth.Result[adminauth.ConfirmTOTPEnrollmentResponse]{},
						&handlerauth.Problem{Details: adminproblem.InvalidTOTPEnrollmentError}, nil
				}
				wireCodes := make([]common.TOTPRecoveryCode, len(codes))
				for index, code := range codes {
					wireCodes[index] = common.TOTPRecoveryCode(code)
				}
				return handlerauth.Result[adminauth.ConfirmTOTPEnrollmentResponse]{
					Status: http.StatusOK,
					Body: adminauth.ConfirmTOTPEnrollmentResponse{
						RecoveryCodes: wireCodes,
					},
				}, nil, nil
			},
		)
	}
}

func VerifyRecoveryCode(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminauth.VerifyRecoveryCodeRequest
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		binding := base64.RawURLEncoding.EncodeToString(credentials.TokenHash(
			string(request.LoginChallengeToken),
		))
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "admin:login-recovery-code", binding, key, request,
			handlerauth.LoginReplayExpiresAt(s.SessionDurations, now),
			func(q *sqlc.Queries) (
				handlerauth.Result[adminauth.VerifyRecoveryCodeResponse],
				*handlerauth.Problem, error,
			) {
				challenge, err := getLockedAdminLoginChallenge(
					r.Context(), q, credentials.TokenHash(
						string(request.LoginChallengeToken),
					),
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[adminauth.VerifyRecoveryCodeResponse](
						adminproblem.InvalidLoginChallengeError,
						adminapi.LoginTokenChallenge,
					)
				}
				if err != nil {
					return handlerauth.Result[adminauth.VerifyRecoveryCodeResponse]{}, nil, err
				}
				token, tokenHash, err := credentials.NewToken()
				if err != nil {
					return handlerauth.Result[adminauth.VerifyRecoveryCodeResponse]{}, nil, err
				}
				expiresAt := now.Add(s.SessionDuration(false))
				session, err := q.CompleteAdminRecoveryCodeLogin(
					r.Context(), sqlc.CompleteAdminRecoveryCodeLoginParams{
						TargetAdminUserID:     challenge.AdminUserID,
						RecoveryCodeHash:      credentials.RecoveryCodeHash(string(request.RecoveryCode)),
						AdminLoginChallengeID: challenge.AdminLoginChallengeID,
						SessionTokenHash:      tokenHash,
						SessionExpiresAt:      dbvalue.Timestamp(expiresAt),
						TenantID:              s.TenantID,
						IdempotencyKey:        dbvalue.Text(string(key)),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Result[adminauth.VerifyRecoveryCodeResponse]{},
						&handlerauth.Problem{Details: adminproblem.IncorrectRecoveryCodeError}, nil
				}
				if err != nil {
					return handlerauth.Result[adminauth.VerifyRecoveryCodeResponse]{}, nil, err
				}
				if session.ExpiresAt.Valid {
					expiresAt = session.ExpiresAt.Time
				}
				return handlerauth.Result[adminauth.VerifyRecoveryCodeResponse]{
					Status: http.StatusOK,
					Body: adminauth.VerifyRecoveryCodeResponse{
						AuthenticatedSessionResponse: adminauth.AuthenticatedSessionResponse{
							SessionToken:      adminauth.AdminSessionToken(token),
							SessionExpiresAt:  expiresAt.UTC(),
							PreferredLanguage: common.FrontendLocale(challenge.PreferredLanguage),
						},
						RemainingRecoveryCodes: common.TOTPRecoveryCodeCount(session.RemainingCodes),
					},
				}, nil, nil
			},
		)
	}
}

func DisableTOTP(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		_, err := s.Queries.DisableAdminTOTP(
			r.Context(), sqlc.DisableAdminTOTPParams{
				TargetAdminUserID:     identity.UserID,
				CurrentAdminSessionID: identity.SessionID,
				TenantID:              s.TenantID,
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "disable admin TOTP", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
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
			key, struct{}{}, s.CurrentTime().Add(5*time.Minute),
			func(q *sqlc.Queries) (
				handlerauth.Result[adminauth.RegenerateTOTPRecoveryCodesResponse],
				*handlerauth.Problem, error,
			) {
				codes, hashes, err := credentials.NewRecoveryCodes()
				if err != nil {
					return handlerauth.Result[adminauth.RegenerateTOTPRecoveryCodesResponse]{}, nil, err
				}
				regenerated, err := q.RegenerateAdminTOTPRecoveryCodes(
					r.Context(), sqlc.RegenerateAdminTOTPRecoveryCodesParams{
						TargetAdminUserID:     identity.UserID,
						RecoveryCodeHashes:    hashes,
						CurrentAdminSessionID: identity.SessionID,
						TenantID:              s.TenantID,
						IdempotencyKey:        dbvalue.Text(string(key)),
					},
				)
				if err != nil {
					return handlerauth.Result[adminauth.RegenerateTOTPRecoveryCodesResponse]{}, nil, err
				}
				if !regenerated {
					return handlerauth.Result[adminauth.RegenerateTOTPRecoveryCodesResponse]{},
						&handlerauth.Problem{Details: adminproblem.TOTPNotEnabledError}, nil
				}
				wireCodes := make([]common.TOTPRecoveryCode, len(codes))
				for index, code := range codes {
					wireCodes[index] = common.TOTPRecoveryCode(code)
				}
				return handlerauth.Result[adminauth.RegenerateTOTPRecoveryCodesResponse]{
					Status: http.StatusOK,
					Body: adminauth.RegenerateTOTPRecoveryCodesResponse{
						RecoveryCodes: wireCodes,
					},
				}, nil, nil
			},
		)
	}
}
