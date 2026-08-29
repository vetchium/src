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
	"backend/internal/db/sqlc"
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
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		binding := base64.RawURLEncoding.EncodeToString(adminapi.TokenHash(
			string(request.LoginChallengeToken),
		))
		now := s.CurrentTime()
		replayExpiresAt := now.Add(5 * time.Minute)
		if sessionExpiry := now.Add(s.AdminSessionTTL); sessionExpiry.Before(
			replayExpiresAt,
		) {
			replayExpiresAt = sessionExpiry
		}
		runIdempotent(
			s, w, r, "admin:login-tfa", binding, key, request,
			replayExpiresAt,
			func(q *sqlc.Queries) (
				idempotentResult[adminauth.AuthenticatedSessionResponse],
				*apiProblem, error,
			) {
				challenge, err := getLockedAdminLoginChallenge(
					r.Context(), q, adminapi.TokenHash(
						string(request.LoginChallengeToken),
					),
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return idempotentResult[adminauth.AuthenticatedSessionResponse]{},
						&apiProblem{
							details:         adminproblem.InvalidLoginChallengeError,
							wwwAuthenticate: adminapi.LoginTokenChallenge,
						}, nil
				}
				if err != nil {
					return idempotentResult[adminauth.AuthenticatedSessionResponse]{}, nil, err
				}
				secret, err := adminapi.Decrypt(
					s.CredentialSubkey("totp"), challenge.TotpSecretCiphertext,
				)
				if err != nil {
					return idempotentResult[adminauth.AuthenticatedSessionResponse]{}, nil, err
				}
				timestep, valid := adminapi.VerifyTOTP(
					string(secret), string(request.TOTPCode), now,
				)
				if !valid {
					return idempotentResult[adminauth.AuthenticatedSessionResponse]{},
						&apiProblem{details: adminproblem.IncorrectTOTPCodeError}, nil
				}
				token, tokenHash, err := adminapi.NewToken()
				if err != nil {
					return idempotentResult[adminauth.AuthenticatedSessionResponse]{}, nil, err
				}
				expiresAt := now.Add(s.AdminSessionTTL)
				session, err := q.CompleteAdminTOTPLogin(
					r.Context(), sqlc.CompleteAdminTOTPLoginParams{
						AdminLoginChallengeID: challenge.AdminLoginChallengeID,
						AdminUserID:           challenge.AdminUserID,
						LastTotpTimestep:      adminapi.Int64(timestep),
						SessionTokenHash:      tokenHash,
						ExpiresAt:             adminapi.Timestamp(expiresAt),
						TenantID:              s.TenantID,
						IdempotencyKey: adminapi.Text(
							pointer(string(key)),
						),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return idempotentResult[adminauth.AuthenticatedSessionResponse]{},
						&apiProblem{details: adminproblem.IncorrectTOTPCodeError}, nil
				}
				if err != nil {
					return idempotentResult[adminauth.AuthenticatedSessionResponse]{}, nil, err
				}
				if session.ExpiresAt.Valid {
					expiresAt = session.ExpiresAt.Time
				}
				return idempotentResult[adminauth.AuthenticatedSessionResponse]{
					status: http.StatusOK,
					body: adminauth.AuthenticatedSessionResponse{
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
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		binding := adminapi.FormatUUID(identity.UserID)
		now := s.CurrentTime()
		runIdempotent(
			s, w, r, "admin:start-totp-enrollment", binding, key,
			struct{}{}, now.Add(totpEnrollmentTTL),
			func(q *sqlc.Queries) (
				idempotentResult[adminauth.StartTOTPEnrollmentResponse],
				*apiProblem, error,
			) {
				if _, err := q.LockAdminUserCredentialMutation(
					r.Context(), identity.UserID,
				); err != nil {
					return idempotentResult[adminauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				secret, err := adminapi.NewTOTPSecret()
				if err != nil {
					return idempotentResult[adminauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				ciphertext, err := adminapi.Encrypt(
					s.CredentialSubkey("totp"), []byte(secret),
				)
				if err != nil {
					return idempotentResult[adminauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				token, tokenHash, err := adminapi.NewToken()
				if err != nil {
					return idempotentResult[adminauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				expiresAt := now.Add(totpEnrollmentTTL)
				enrollment, err := q.CreateAdminTOTPEnrollment(
					r.Context(), sqlc.CreateAdminTOTPEnrollmentParams{
						TargetAdminUserID: identity.UserID,
						TokenHash:         tokenHash,
						SecretCiphertext:  ciphertext,
						ExpiresAt:         adminapi.Timestamp(expiresAt),
						TenantID:          s.TenantID,
						IdempotencyKey: adminapi.Text(
							pointer(string(key)),
						),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return idempotentResult[adminauth.StartTOTPEnrollmentResponse]{},
						&apiProblem{details: adminproblem.TOTPAlreadyEnabledError}, nil
				}
				if err != nil {
					return idempotentResult[adminauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				if enrollment.ExpiresAt.Valid {
					expiresAt = enrollment.ExpiresAt.Time
				}
				return idempotentResult[adminauth.StartTOTPEnrollmentResponse]{
					status: http.StatusOK,
					body: adminauth.StartTOTPEnrollmentResponse{
						TOTPEnrollmentToken: common.TOTPEnrollmentToken(token),
						ProvisioningURI: adminapi.TOTPProvisioningURI(
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
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		binding := adminapi.FormatUUID(identity.UserID) + ":" +
			base64.RawURLEncoding.EncodeToString(adminapi.TokenHash(
				string(request.TOTPEnrollmentToken),
			))
		now := s.CurrentTime()
		runIdempotent(
			s, w, r, "admin:confirm-totp-enrollment", binding, key,
			request, now.Add(totpEnrollmentTTL),
			func(q *sqlc.Queries) (
				idempotentResult[adminauth.ConfirmTOTPEnrollmentResponse],
				*apiProblem, error,
			) {
				if _, err := q.LockAdminUserCredentialMutation(
					r.Context(), identity.UserID,
				); err != nil {
					return idempotentResult[adminauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				enrollment, err := q.GetAdminTOTPEnrollment(
					r.Context(), sqlc.GetAdminTOTPEnrollmentParams{
						TokenHash: adminapi.TokenHash(
							string(request.TOTPEnrollmentToken),
						),
						TargetAdminUserID: identity.UserID,
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return idempotentResult[adminauth.ConfirmTOTPEnrollmentResponse]{},
						&apiProblem{details: adminproblem.InvalidTOTPEnrollmentError}, nil
				}
				if err != nil {
					return idempotentResult[adminauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				secret, err := adminapi.Decrypt(
					s.CredentialSubkey("totp"), enrollment.SecretCiphertext,
				)
				if err != nil {
					return idempotentResult[adminauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				timestep, valid := adminapi.VerifyTOTP(
					string(secret), string(request.TOTPCode), now,
				)
				if !valid {
					return idempotentResult[adminauth.ConfirmTOTPEnrollmentResponse]{},
						&apiProblem{details: adminproblem.IncorrectTOTPCodeError}, nil
				}
				codes, hashes, err := adminapi.NewRecoveryCodes()
				if err != nil {
					return idempotentResult[adminauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				confirmed, err := q.ConfirmAdminTOTPEnrollment(
					r.Context(), sqlc.ConfirmAdminTOTPEnrollmentParams{
						TargetEnrollmentID:    enrollment.AdminTotpEnrollmentID,
						TargetAdminUserID:     identity.UserID,
						SecretCiphertext:      enrollment.SecretCiphertext,
						TotpTimestep:          adminapi.Int64(timestep),
						RecoveryCodeHashes:    hashes,
						CurrentAdminSessionID: identity.SessionID,
						TenantID:              s.TenantID,
						IdempotencyKey: adminapi.Text(
							pointer(string(key)),
						),
					},
				)
				if err != nil {
					return idempotentResult[adminauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				if !confirmed {
					return idempotentResult[adminauth.ConfirmTOTPEnrollmentResponse]{},
						&apiProblem{details: adminproblem.InvalidTOTPEnrollmentError}, nil
				}
				wireCodes := make([]common.TOTPRecoveryCode, len(codes))
				for index, code := range codes {
					wireCodes[index] = common.TOTPRecoveryCode(code)
				}
				return idempotentResult[adminauth.ConfirmTOTPEnrollmentResponse]{
					status: http.StatusOK,
					body: adminauth.ConfirmTOTPEnrollmentResponse{
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
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		binding := base64.RawURLEncoding.EncodeToString(adminapi.TokenHash(
			string(request.LoginChallengeToken),
		))
		now := s.CurrentTime()
		replayExpiresAt := now.Add(5 * time.Minute)
		if sessionExpiry := now.Add(s.AdminSessionTTL); sessionExpiry.Before(
			replayExpiresAt,
		) {
			replayExpiresAt = sessionExpiry
		}
		runIdempotent(
			s, w, r, "admin:login-recovery-code", binding, key, request,
			replayExpiresAt,
			func(q *sqlc.Queries) (
				idempotentResult[adminauth.VerifyRecoveryCodeResponse],
				*apiProblem, error,
			) {
				challenge, err := getLockedAdminLoginChallenge(
					r.Context(), q, adminapi.TokenHash(
						string(request.LoginChallengeToken),
					),
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return idempotentResult[adminauth.VerifyRecoveryCodeResponse]{},
						&apiProblem{
							details:         adminproblem.InvalidLoginChallengeError,
							wwwAuthenticate: adminapi.LoginTokenChallenge,
						}, nil
				}
				if err != nil {
					return idempotentResult[adminauth.VerifyRecoveryCodeResponse]{}, nil, err
				}
				token, tokenHash, err := adminapi.NewToken()
				if err != nil {
					return idempotentResult[adminauth.VerifyRecoveryCodeResponse]{}, nil, err
				}
				expiresAt := now.Add(s.AdminSessionTTL)
				session, err := q.CompleteAdminRecoveryCodeLogin(
					r.Context(), sqlc.CompleteAdminRecoveryCodeLoginParams{
						TargetAdminUserID:     challenge.AdminUserID,
						RecoveryCodeHash:      adminapi.RecoveryCodeHash(string(request.RecoveryCode)),
						AdminLoginChallengeID: challenge.AdminLoginChallengeID,
						SessionTokenHash:      tokenHash,
						SessionExpiresAt:      adminapi.Timestamp(expiresAt),
						TenantID:              s.TenantID,
						IdempotencyKey: adminapi.Text(
							pointer(string(key)),
						),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return idempotentResult[adminauth.VerifyRecoveryCodeResponse]{},
						&apiProblem{details: adminproblem.IncorrectRecoveryCodeError}, nil
				}
				if err != nil {
					return idempotentResult[adminauth.VerifyRecoveryCodeResponse]{}, nil, err
				}
				if session.ExpiresAt.Valid {
					expiresAt = session.ExpiresAt.Time
				}
				return idempotentResult[adminauth.VerifyRecoveryCodeResponse]{
					status: http.StatusOK,
					body: adminauth.VerifyRecoveryCodeResponse{
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
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(r.Context())
		binding := adminapi.FormatUUID(identity.UserID)
		runIdempotent(
			s, w, r, "admin:regenerate-totp-recovery-codes", binding,
			key, struct{}{}, s.CurrentTime().Add(5*time.Minute),
			func(q *sqlc.Queries) (
				idempotentResult[adminauth.RegenerateTOTPRecoveryCodesResponse],
				*apiProblem, error,
			) {
				codes, hashes, err := adminapi.NewRecoveryCodes()
				if err != nil {
					return idempotentResult[adminauth.RegenerateTOTPRecoveryCodesResponse]{}, nil, err
				}
				regenerated, err := q.RegenerateAdminTOTPRecoveryCodes(
					r.Context(), sqlc.RegenerateAdminTOTPRecoveryCodesParams{
						TargetAdminUserID:     identity.UserID,
						RecoveryCodeHashes:    hashes,
						CurrentAdminSessionID: identity.SessionID,
						TenantID:              s.TenantID,
						IdempotencyKey: adminapi.Text(
							pointer(string(key)),
						),
					},
				)
				if err != nil {
					return idempotentResult[adminauth.RegenerateTOTPRecoveryCodesResponse]{}, nil, err
				}
				if !regenerated {
					return idempotentResult[adminauth.RegenerateTOTPRecoveryCodesResponse]{},
						&apiProblem{details: adminproblem.TOTPNotEnabledError}, nil
				}
				wireCodes := make([]common.TOTPRecoveryCode, len(codes))
				for index, code := range codes {
					wireCodes[index] = common.TOTPRecoveryCode(code)
				}
				return idempotentResult[adminauth.RegenerateTOTPRecoveryCodesResponse]{
					status: http.StatusOK,
					body: adminauth.RegenerateTOTPRecoveryCodesResponse{
						RecoveryCodes: wireCodes,
					},
				}, nil, nil
			},
		)
	}
}
