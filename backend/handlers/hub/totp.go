package hub

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/vetchium/src/typespec/common"
	hubauth "github.com/vetchium/src/typespec/hub/auth"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/db/sqlc"
	"backend/internal/hubapi"
	"backend/internal/middleware"
)

const totpEnrollmentTTL = 10 * time.Minute

func getLockedHubLoginChallenge(
	ctx context.Context, q *sqlc.Queries, tokenHash []byte,
) (sqlc.GetHubLoginChallengeRow, error) {
	var zero sqlc.GetHubLoginChallengeRow
	userDID, err := q.ResolveHubLoginChallengeUser(ctx, tokenHash)
	if err != nil {
		return zero, err
	}
	if _, err := q.LockHubUserCredentialMutation(ctx, userDID); err != nil {
		return zero, err
	}
	return q.GetHubLoginChallenge(ctx, tokenHash)
}

func VerifyTFA(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.VerifyTFARequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		tokenHash := hubapi.TokenHash(string(request.LoginChallengeToken))
		binding := base64.RawURLEncoding.EncodeToString(tokenHash)
		now := s.CurrentTime()
		runIdempotent(
			s, w, r, "hub:login-tfa", binding, key, request,
			now.Add(5*time.Minute),
			func(q *sqlc.Queries) (
				idempotentResult[hubauth.AuthenticatedSessionResponse],
				*apiProblem, error,
			) {
				challenge, err := getLockedHubLoginChallenge(
					r.Context(), q, tokenHash,
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return invalidLoginChallengeResult[hubauth.AuthenticatedSessionResponse]()
				}
				if err != nil {
					return idempotentResult[hubauth.AuthenticatedSessionResponse]{}, nil, err
				}
				secret, err := hubapi.Decrypt(
					s.CredentialSubkey("totp"),
					challenge.TotpSecretCiphertext,
				)
				if err != nil {
					return idempotentResult[hubauth.AuthenticatedSessionResponse]{}, nil, err
				}
				timestep, valid := hubapi.VerifyTOTP(
					string(secret), string(request.TOTPCode), now,
				)
				if !valid {
					return idempotentResult[hubauth.AuthenticatedSessionResponse]{},
						&apiProblem{details: hubproblem.IncorrectTOTPCodeError}, nil
				}
				token, sessionHash, err := hubapi.NewToken()
				if err != nil {
					return idempotentResult[hubauth.AuthenticatedSessionResponse]{}, nil, err
				}
				expiresAt := now.Add(s.SessionDuration(challenge.Remembered))
				session, err := q.CompleteHubTOTPLogin(
					r.Context(), sqlc.CompleteHubTOTPLoginParams{
						LastTotpTimestep:    hubapi.Int64(timestep),
						HubUserDid:          challenge.HubUserDid,
						HubLoginChallengeID: challenge.HubLoginChallengeID,
						SessionTokenHash:    sessionHash,
						ExpiresAt:           hubapi.Timestamp(expiresAt),
						Remembered:          challenge.Remembered,
						TenantID:            s.TenantID,
						IdempotencyKey:      hubapi.Text(string(key)),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return idempotentResult[hubauth.AuthenticatedSessionResponse]{},
						&apiProblem{details: hubproblem.IncorrectTOTPCodeError}, nil
				}
				if err != nil {
					return idempotentResult[hubauth.AuthenticatedSessionResponse]{}, nil, err
				}
				if session.ExpiresAt.Valid {
					expiresAt = session.ExpiresAt.Time
				}
				return idempotentResult[hubauth.AuthenticatedSessionResponse]{
					status: http.StatusOK,
					body: authenticatedSessionResponse(
						token, expiresAt, challenge.HubUserDid,
						challenge.Handle, challenge.PreferredLanguage,
						challenge.ResidentCountry,
					),
				}, nil, nil
			},
		)
	}
}

func StartTOTPEnrollment(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		binding := hubapi.FormatUUID(identity.UserDID)
		now := s.CurrentTime()
		runIdempotent(
			s, w, r, "hub:start-totp-enrollment", binding, key,
			struct{}{}, now.Add(totpEnrollmentTTL),
			func(q *sqlc.Queries) (
				idempotentResult[hubauth.StartTOTPEnrollmentResponse],
				*apiProblem, error,
			) {
				if _, err := q.LockHubUserCredentialMutation(
					r.Context(), identity.UserDID,
				); err != nil {
					return idempotentResult[hubauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				secret, err := hubapi.NewTOTPSecret()
				if err != nil {
					return idempotentResult[hubauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				ciphertext, err := hubapi.Encrypt(
					s.CredentialSubkey("totp"), []byte(secret),
				)
				if err != nil {
					return idempotentResult[hubauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				token, tokenHash, err := hubapi.NewToken()
				if err != nil {
					return idempotentResult[hubauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				expiresAt := now.Add(totpEnrollmentTTL)
				enrollment, err := q.CreateHubTOTPEnrollment(
					r.Context(), sqlc.CreateHubTOTPEnrollmentParams{
						HubUserDid:       identity.UserDID,
						TokenHash:        tokenHash,
						SecretCiphertext: ciphertext,
						ExpiresAt:        hubapi.Timestamp(expiresAt),
						TenantID:         s.TenantID,
						IdempotencyKey:   hubapi.Text(string(key)),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return idempotentResult[hubauth.StartTOTPEnrollmentResponse]{},
						&apiProblem{details: hubproblem.TOTPAlreadyEnabledError}, nil
				}
				if err != nil {
					return idempotentResult[hubauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				if enrollment.ExpiresAt.Valid {
					expiresAt = enrollment.ExpiresAt.Time
				}
				return idempotentResult[hubauth.StartTOTPEnrollmentResponse]{
					status: http.StatusOK,
					body: hubauth.StartTOTPEnrollmentResponse{
						TOTPEnrollmentToken: common.TOTPEnrollmentToken(token),
						ProvisioningURI: hubapi.TOTPProvisioningURI(
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

func ConfirmTOTPEnrollment(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.ConfirmTOTPEnrollmentRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		binding := hubapi.FormatUUID(identity.UserDID) + ":" +
			base64.RawURLEncoding.EncodeToString(hubapi.TokenHash(
				string(request.TOTPEnrollmentToken),
			))
		now := s.CurrentTime()
		runIdempotent(
			s, w, r, "hub:confirm-totp-enrollment", binding, key,
			request, now.Add(totpEnrollmentTTL),
			func(q *sqlc.Queries) (
				idempotentResult[hubauth.ConfirmTOTPEnrollmentResponse],
				*apiProblem, error,
			) {
				if _, err := q.LockHubUserCredentialMutation(
					r.Context(), identity.UserDID,
				); err != nil {
					return idempotentResult[hubauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				enrollment, err := q.GetHubTOTPEnrollment(
					r.Context(), sqlc.GetHubTOTPEnrollmentParams{
						TokenHash: hubapi.TokenHash(
							string(request.TOTPEnrollmentToken),
						),
						HubUserDid: identity.UserDID,
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return idempotentResult[hubauth.ConfirmTOTPEnrollmentResponse]{},
						&apiProblem{details: hubproblem.InvalidTOTPEnrollmentError}, nil
				}
				if err != nil {
					return idempotentResult[hubauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				secret, err := hubapi.Decrypt(
					s.CredentialSubkey("totp"), enrollment.SecretCiphertext,
				)
				if err != nil {
					return idempotentResult[hubauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				timestep, valid := hubapi.VerifyTOTP(
					string(secret), string(request.TOTPCode), now,
				)
				if !valid {
					return idempotentResult[hubauth.ConfirmTOTPEnrollmentResponse]{},
						&apiProblem{details: hubproblem.IncorrectTOTPCodeError}, nil
				}
				codes, hashes, err := hubapi.NewRecoveryCodes()
				if err != nil {
					return idempotentResult[hubauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				confirmed, err := q.ConfirmHubTOTPEnrollment(
					r.Context(), sqlc.ConfirmHubTOTPEnrollmentParams{
						HubTotpEnrollmentID: enrollment.HubTotpEnrollmentID,
						HubUserDid:          identity.UserDID,
						SecretCiphertext:    enrollment.SecretCiphertext,
						TotpTimestep:        hubapi.Int64(timestep),
						RecoveryCodeHashes:  hashes,
						CurrentHubSessionID: identity.SessionID,
						TenantID:            s.TenantID,
						IdempotencyKey:      hubapi.Text(string(key)),
					},
				)
				if err != nil {
					return idempotentResult[hubauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				if !confirmed {
					return idempotentResult[hubauth.ConfirmTOTPEnrollmentResponse]{},
						&apiProblem{details: hubproblem.InvalidTOTPEnrollmentError}, nil
				}
				wireCodes := make([]common.TOTPRecoveryCode, len(codes))
				for index, code := range codes {
					wireCodes[index] = common.TOTPRecoveryCode(code)
				}
				return idempotentResult[hubauth.ConfirmTOTPEnrollmentResponse]{
					status: http.StatusOK,
					body: hubauth.ConfirmTOTPEnrollmentResponse{
						RecoveryCodes: wireCodes,
					},
				}, nil, nil
			},
		)
	}
}

func VerifyRecoveryCode(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.VerifyRecoveryCodeRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		tokenHash := hubapi.TokenHash(string(request.LoginChallengeToken))
		binding := base64.RawURLEncoding.EncodeToString(tokenHash)
		now := s.CurrentTime()
		runIdempotent(
			s, w, r, "hub:login-recovery-code", binding, key, request,
			now.Add(5*time.Minute),
			func(q *sqlc.Queries) (
				idempotentResult[hubauth.VerifyRecoveryCodeResponse],
				*apiProblem, error,
			) {
				challenge, err := getLockedHubLoginChallenge(
					r.Context(), q, tokenHash,
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return invalidLoginChallengeResult[hubauth.VerifyRecoveryCodeResponse]()
				}
				if err != nil {
					return idempotentResult[hubauth.VerifyRecoveryCodeResponse]{}, nil, err
				}
				token, sessionHash, err := hubapi.NewToken()
				if err != nil {
					return idempotentResult[hubauth.VerifyRecoveryCodeResponse]{}, nil, err
				}
				expiresAt := now.Add(s.SessionDuration(challenge.Remembered))
				session, err := q.CompleteHubRecoveryCodeLogin(
					r.Context(), sqlc.CompleteHubRecoveryCodeLoginParams{
						HubUserDid: challenge.HubUserDid,
						RecoveryCodeHash: hubapi.RecoveryCodeHash(
							string(request.RecoveryCode),
						),
						HubLoginChallengeID: challenge.HubLoginChallengeID,
						SessionTokenHash:    sessionHash,
						ExpiresAt:           hubapi.Timestamp(expiresAt),
						Remembered:          challenge.Remembered,
						TenantID:            s.TenantID,
						IdempotencyKey:      hubapi.Text(string(key)),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return idempotentResult[hubauth.VerifyRecoveryCodeResponse]{},
						&apiProblem{details: hubproblem.IncorrectRecoveryCodeError}, nil
				}
				if err != nil {
					return idempotentResult[hubauth.VerifyRecoveryCodeResponse]{}, nil, err
				}
				if session.ExpiresAt.Valid {
					expiresAt = session.ExpiresAt.Time
				}
				return idempotentResult[hubauth.VerifyRecoveryCodeResponse]{
					status: http.StatusOK,
					body: hubauth.VerifyRecoveryCodeResponse{
						AuthenticatedSessionResponse: authenticatedSessionResponse(
							token, expiresAt, challenge.HubUserDid,
							challenge.Handle, challenge.PreferredLanguage,
							challenge.ResidentCountry,
						),
						RemainingRecoveryCodes: common.TOTPRecoveryCodeCount(
							session.RemainingCodes,
						),
					},
				}, nil, nil
			},
		)
	}
}

func DisableTOTP(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		disabled, err := withHubCredentialLock(
			s, r, hubCredentialLock{userDID: identity.UserDID},
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
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		binding := hubapi.FormatUUID(identity.UserDID)
		runIdempotent(
			s, w, r, "hub:regenerate-totp-recovery-codes", binding,
			key, struct{}{}, s.CurrentTime().Add(5*time.Minute),
			func(q *sqlc.Queries) (
				idempotentResult[hubauth.RegenerateTOTPRecoveryCodesResponse],
				*apiProblem, error,
			) {
				if _, err := q.LockHubUserCredentialMutation(
					r.Context(), identity.UserDID,
				); err != nil {
					return idempotentResult[hubauth.RegenerateTOTPRecoveryCodesResponse]{}, nil, err
				}
				enabled, err := q.HubTOTPEnabled(r.Context(), identity.UserDID)
				if errors.Is(err, pgx.ErrNoRows) {
					return idempotentResult[hubauth.RegenerateTOTPRecoveryCodesResponse]{},
						&apiProblem{details: hubproblem.TOTPNotEnabledError}, nil
				}
				if err != nil {
					return idempotentResult[hubauth.RegenerateTOTPRecoveryCodesResponse]{}, nil, err
				}
				if !enabled {
					return idempotentResult[hubauth.RegenerateTOTPRecoveryCodesResponse]{},
						&apiProblem{details: hubproblem.TOTPNotEnabledError}, nil
				}
				codes, hashes, err := hubapi.NewRecoveryCodes()
				if err != nil {
					return idempotentResult[hubauth.RegenerateTOTPRecoveryCodesResponse]{}, nil, err
				}
				regenerated, err := q.RegenerateHubTOTPRecoveryCodes(
					r.Context(), sqlc.RegenerateHubTOTPRecoveryCodesParams{
						HubUserDid:          identity.UserDID,
						RecoveryCodeHashes:  hashes,
						CurrentHubSessionID: identity.SessionID,
						TenantID:            s.TenantID,
						IdempotencyKey:      hubapi.Text(string(key)),
					},
				)
				if err != nil {
					return idempotentResult[hubauth.RegenerateTOTPRecoveryCodesResponse]{}, nil, err
				}
				if !regenerated {
					return idempotentResult[hubauth.RegenerateTOTPRecoveryCodesResponse]{},
						&apiProblem{details: hubproblem.TOTPNotEnabledError}, nil
				}
				wireCodes := make([]common.TOTPRecoveryCode, len(codes))
				for index, code := range codes {
					wireCodes[index] = common.TOTPRecoveryCode(code)
				}
				return idempotentResult[hubauth.RegenerateTOTPRecoveryCodesResponse]{
					status: http.StatusOK,
					body: hubauth.RegenerateTOTPRecoveryCodesResponse{
						RecoveryCodes: wireCodes,
					},
				}, nil, nil
			},
		)
	}
}

func invalidLoginChallengeResult[T any]() (
	idempotentResult[T], *apiProblem, error,
) {
	return idempotentResult[T]{}, &apiProblem{
		details:         hubproblem.InvalidLoginChallengeError,
		wwwAuthenticate: hubapi.LoginTokenChallenge,
	}, nil
}
