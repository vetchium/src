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
	"backend/internal/handlerauth"
	"backend/internal/hubapi"
	"backend/internal/middleware"
)

const totpEnrollmentTTL = 10 * time.Minute

func loginReplayExpiresAt(s *hubapi.Server, now time.Time) time.Time {
	replayExpiresAt := now.Add(5 * time.Minute)
	sessionExpiry := now.Add(s.SessionDurations.Shortest())
	if sessionExpiry.Before(replayExpiresAt) {
		replayExpiresAt = sessionExpiry
	}
	return replayExpiresAt
}

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
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		tokenHash := hubapi.TokenHash(string(request.LoginChallengeToken))
		binding := base64.RawURLEncoding.EncodeToString(tokenHash)
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "hub:login-tfa", binding, key, request,
			loginReplayExpiresAt(s, now),
			func(q *sqlc.Queries) (
				handlerauth.Result[hubauth.AuthenticatedSessionResponse],
				*handlerauth.Problem, error,
			) {
				challenge, err := getLockedHubLoginChallenge(
					r.Context(), q, tokenHash,
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[hubauth.AuthenticatedSessionResponse](
						hubproblem.InvalidLoginChallengeError,
						hubapi.LoginTokenChallenge,
					)
				}
				if err != nil {
					return handlerauth.Result[hubauth.AuthenticatedSessionResponse]{}, nil, err
				}
				secret, err := hubapi.Decrypt(
					s.CredentialSubkey("totp"),
					challenge.TotpSecretCiphertext,
				)
				if err != nil {
					return handlerauth.Result[hubauth.AuthenticatedSessionResponse]{}, nil, err
				}
				timestep, valid := hubapi.VerifyTOTP(
					string(secret), string(request.TOTPCode), now,
				)
				if !valid {
					return handlerauth.Result[hubauth.AuthenticatedSessionResponse]{},
						&handlerauth.Problem{Details: hubproblem.IncorrectTOTPCodeError}, nil
				}
				token, sessionHash, err := hubapi.NewToken()
				if err != nil {
					return handlerauth.Result[hubauth.AuthenticatedSessionResponse]{}, nil, err
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
					return handlerauth.Result[hubauth.AuthenticatedSessionResponse]{},
						&handlerauth.Problem{Details: hubproblem.IncorrectTOTPCodeError}, nil
				}
				if err != nil {
					return handlerauth.Result[hubauth.AuthenticatedSessionResponse]{}, nil, err
				}
				if session.ExpiresAt.Valid {
					expiresAt = session.ExpiresAt.Time
				}
				return handlerauth.Result[hubauth.AuthenticatedSessionResponse]{
					Status: http.StatusOK,
					Body: authenticatedSessionResponse(
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
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		binding := hubapi.FormatUUID(identity.UserDID)
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "hub:start-totp-enrollment", binding, key,
			struct{}{}, now.Add(totpEnrollmentTTL),
			func(q *sqlc.Queries) (
				handlerauth.Result[hubauth.StartTOTPEnrollmentResponse],
				*handlerauth.Problem, error,
			) {
				if _, err := q.LockHubUserCredentialMutation(
					r.Context(), identity.UserDID,
				); err != nil {
					return handlerauth.Result[hubauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				secret, err := hubapi.NewTOTPSecret()
				if err != nil {
					return handlerauth.Result[hubauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				ciphertext, err := hubapi.Encrypt(
					s.CredentialSubkey("totp"), []byte(secret),
				)
				if err != nil {
					return handlerauth.Result[hubauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				token, tokenHash, err := hubapi.NewToken()
				if err != nil {
					return handlerauth.Result[hubauth.StartTOTPEnrollmentResponse]{}, nil, err
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
					return handlerauth.Result[hubauth.StartTOTPEnrollmentResponse]{},
						&handlerauth.Problem{Details: hubproblem.TOTPAlreadyEnabledError}, nil
				}
				if err != nil {
					return handlerauth.Result[hubauth.StartTOTPEnrollmentResponse]{}, nil, err
				}
				if enrollment.ExpiresAt.Valid {
					expiresAt = enrollment.ExpiresAt.Time
				}
				return handlerauth.Result[hubauth.StartTOTPEnrollmentResponse]{
					Status: http.StatusOK,
					Body: hubauth.StartTOTPEnrollmentResponse{
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
		binding := hubapi.FormatUUID(identity.UserDID) + ":" +
			base64.RawURLEncoding.EncodeToString(hubapi.TokenHash(
				string(request.TOTPEnrollmentToken),
			))
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "hub:confirm-totp-enrollment", binding, key,
			request, now.Add(totpEnrollmentTTL),
			func(q *sqlc.Queries) (
				handlerauth.Result[hubauth.ConfirmTOTPEnrollmentResponse],
				*handlerauth.Problem, error,
			) {
				if _, err := q.LockHubUserCredentialMutation(
					r.Context(), identity.UserDID,
				); err != nil {
					return handlerauth.Result[hubauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
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
					return handlerauth.Result[hubauth.ConfirmTOTPEnrollmentResponse]{},
						&handlerauth.Problem{Details: hubproblem.InvalidTOTPEnrollmentError}, nil
				}
				if err != nil {
					return handlerauth.Result[hubauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				secret, err := hubapi.Decrypt(
					s.CredentialSubkey("totp"), enrollment.SecretCiphertext,
				)
				if err != nil {
					return handlerauth.Result[hubauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				timestep, valid := hubapi.VerifyTOTP(
					string(secret), string(request.TOTPCode), now,
				)
				if !valid {
					return handlerauth.Result[hubauth.ConfirmTOTPEnrollmentResponse]{},
						&handlerauth.Problem{Details: hubproblem.IncorrectTOTPCodeError}, nil
				}
				codes, hashes, err := hubapi.NewRecoveryCodes()
				if err != nil {
					return handlerauth.Result[hubauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
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
					return handlerauth.Result[hubauth.ConfirmTOTPEnrollmentResponse]{}, nil, err
				}
				if !confirmed {
					return handlerauth.Result[hubauth.ConfirmTOTPEnrollmentResponse]{},
						&handlerauth.Problem{Details: hubproblem.InvalidTOTPEnrollmentError}, nil
				}
				wireCodes := make([]common.TOTPRecoveryCode, len(codes))
				for index, code := range codes {
					wireCodes[index] = common.TOTPRecoveryCode(code)
				}
				return handlerauth.Result[hubauth.ConfirmTOTPEnrollmentResponse]{
					Status: http.StatusOK,
					Body: hubauth.ConfirmTOTPEnrollmentResponse{
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
		if !handlerauth.DecodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		tokenHash := hubapi.TokenHash(string(request.LoginChallengeToken))
		binding := base64.RawURLEncoding.EncodeToString(tokenHash)
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "hub:login-recovery-code", binding, key, request,
			loginReplayExpiresAt(s, now),
			func(q *sqlc.Queries) (
				handlerauth.Result[hubauth.VerifyRecoveryCodeResponse],
				*handlerauth.Problem, error,
			) {
				challenge, err := getLockedHubLoginChallenge(
					r.Context(), q, tokenHash,
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Failure[hubauth.VerifyRecoveryCodeResponse](
						hubproblem.InvalidLoginChallengeError,
						hubapi.LoginTokenChallenge,
					)
				}
				if err != nil {
					return handlerauth.Result[hubauth.VerifyRecoveryCodeResponse]{}, nil, err
				}
				token, sessionHash, err := hubapi.NewToken()
				if err != nil {
					return handlerauth.Result[hubauth.VerifyRecoveryCodeResponse]{}, nil, err
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
					return handlerauth.Result[hubauth.VerifyRecoveryCodeResponse]{},
						&handlerauth.Problem{Details: hubproblem.IncorrectRecoveryCodeError}, nil
				}
				if err != nil {
					return handlerauth.Result[hubauth.VerifyRecoveryCodeResponse]{}, nil, err
				}
				if session.ExpiresAt.Valid {
					expiresAt = session.ExpiresAt.Time
				}
				return handlerauth.Result[hubauth.VerifyRecoveryCodeResponse]{
					Status: http.StatusOK,
					Body: hubauth.VerifyRecoveryCodeResponse{
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
		binding := hubapi.FormatUUID(identity.UserDID)
		handlerauth.RunIdempotent(
			s, w, r, "hub:regenerate-totp-recovery-codes", binding,
			key, struct{}{}, s.CurrentTime().Add(5*time.Minute),
			func(q *sqlc.Queries) (
				handlerauth.Result[hubauth.RegenerateTOTPRecoveryCodesResponse],
				*handlerauth.Problem, error,
			) {
				if _, err := q.LockHubUserCredentialMutation(
					r.Context(), identity.UserDID,
				); err != nil {
					return handlerauth.Result[hubauth.RegenerateTOTPRecoveryCodesResponse]{}, nil, err
				}
				enabled, err := q.HubTOTPEnabled(r.Context(), identity.UserDID)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.Result[hubauth.RegenerateTOTPRecoveryCodesResponse]{},
						&handlerauth.Problem{Details: hubproblem.TOTPNotEnabledError}, nil
				}
				if err != nil {
					return handlerauth.Result[hubauth.RegenerateTOTPRecoveryCodesResponse]{}, nil, err
				}
				if !enabled {
					return handlerauth.Result[hubauth.RegenerateTOTPRecoveryCodesResponse]{},
						&handlerauth.Problem{Details: hubproblem.TOTPNotEnabledError}, nil
				}
				codes, hashes, err := hubapi.NewRecoveryCodes()
				if err != nil {
					return handlerauth.Result[hubauth.RegenerateTOTPRecoveryCodesResponse]{}, nil, err
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
					return handlerauth.Result[hubauth.RegenerateTOTPRecoveryCodesResponse]{}, nil, err
				}
				if !regenerated {
					return handlerauth.Result[hubauth.RegenerateTOTPRecoveryCodesResponse]{},
						&handlerauth.Problem{Details: hubproblem.TOTPNotEnabledError}, nil
				}
				wireCodes := make([]common.TOTPRecoveryCode, len(codes))
				for index, code := range codes {
					wireCodes[index] = common.TOTPRecoveryCode(code)
				}
				return handlerauth.Result[hubauth.RegenerateTOTPRecoveryCodesResponse]{
					Status: http.StatusOK,
					Body: hubauth.RegenerateTOTPRecoveryCodesResponse{
						RecoveryCodes: wireCodes,
					},
				}, nil, nil
			},
		)
	}
}
