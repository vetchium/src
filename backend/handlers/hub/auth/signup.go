package auth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/vetchium/src/typespec/common"
	hubspec "github.com/vetchium/src/typespec/hub"
	hubauth "github.com/vetchium/src/typespec/hub/auth"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	hubusers "backend/internal/hub/users"
	"backend/internal/regions"
)

const signupTTL = 24 * time.Hour

type signupEmailPayload struct {
	DisplayName     string    `json:"display_name"`
	VerificationURL string    `json:"verification_url"`
	ExpiresAt       time.Time `json:"expires_at"`
}

func RequestSignup(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.RequestSignupRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		emailAddress := string(request.EmailAddress)
		domain := emailAddress[strings.LastIndexByte(emailAddress, '@')+1:]
		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, "hub:request-signup", emailAddress, key, request,
			now.Add(signupTTL),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				if !s.Signup.Enabled || !s.Regions.Allows(s.TenantID, request.ResidentCountry) {
					return handlerauth.Failure[struct{}](hubproblem.SignupUnavailableError)
				}
				token, tokenHash, err := credentials.NewToken()
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				requestID, err := dbvalue.NewUUID()
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				expiresAt := now.Add(signupTTL)
				payload, err := json.Marshal(signupEmailPayload{
					DisplayName: string(request.DisplayName),
					VerificationURL: s.PublicBaseURL +
						"/complete-signup?token=" + url.QueryEscape(token),
					ExpiresAt: expiresAt,
				})
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				ciphertext, err := credentials.Encrypt(
					s.CredentialSubkey("outbox"), payload,
				)
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				result, err := q.CreateHubSignupRequest(
					r.Context(), sqlc.CreateHubSignupRequestParams{
						EmailDomain:        domain,
						AllowAnyDomain:     s.Signup.EmailDomainMode == regions.AnyDomain,
						EmailAddress:       emailAddress,
						HubSignupRequestID: requestID,
						DisplayName:        string(request.DisplayName),
						PreferredLanguage:  string(request.PreferredLanguage),
						ResidentCountry:    string(request.ResidentCountry),
						TokenHash:          tokenHash,
						ExpiresAt:          dbvalue.Timestamp(expiresAt),
						PayloadCiphertext:  ciphertext,
						TenantID:           s.TenantID,
						IdempotencyKey:     dbvalue.Text(string(key)),
					},
				)
				if err != nil {
					return handlerauth.Result[struct{}]{}, nil, err
				}
				if result == "domain_not_allowed" {
					return handlerauth.Result[struct{}]{}, &handlerauth.Problem{
						Details: hubproblem.SignupDomainNotAllowedError,
					}, nil
				}
				return handlerauth.Result[struct{}]{
					Status: http.StatusAccepted, Body: struct{}{},
				}, nil, nil
			},
		)
	}
}

func CompleteSignup(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.CompleteSignupRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		tokenHash := credentials.TokenHash(string(request.SignupToken))
		binding := base64.RawURLEncoding.EncodeToString(tokenHash)
		handlerauth.RunIdempotent(
			s, w, r, "hub:complete-signup", binding, key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[hubauth.CompleteSignupResponse],
				*handlerauth.Problem, error,
			) {
				signup, err := q.ResolveHubSignupForCompletion(
					r.Context(), tokenHash,
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.AuthenticationFailure[hubauth.CompleteSignupResponse](
						hubproblem.InvalidSignupTokenError,
						hubauthn.SignupChallenge,
					)
				}
				if err != nil {
					return handlerauth.Result[hubauth.CompleteSignupResponse]{}, nil, err
				}
				if !s.Signup.Enabled || !s.Regions.Allows(s.TenantID, common.CountryCode(signup.ResidentCountry)) {
					return handlerauth.Failure[hubauth.CompleteSignupResponse](hubproblem.SignupUnavailableError)
				}
				passwordHash, err := credentials.HashPassword(string(request.Password))
				if err != nil {
					return handlerauth.Result[hubauth.CompleteSignupResponse]{}, nil, err
				}
				did, err := dbvalue.NewUUIDv7(s.CurrentTime())
				if err != nil {
					return handlerauth.Result[hubauth.CompleteSignupResponse]{}, nil, err
				}
				handle := hubusers.Handle(signup.DisplayName, hubspec.HubUserDID(did.String()))
				created, err := q.CompleteHubSignup(
					r.Context(), sqlc.CompleteHubSignupParams{
						HubSignupRequestID: signup.HubSignupRequestID,
						AllowAnyDomain:     s.Signup.EmailDomainMode == regions.AnyDomain,
						HubUserDid:         did,
						Handle:             string(handle),
						PasswordHash:       passwordHash,
						TenantID:           s.TenantID,
						IdempotencyKey:     dbvalue.Text(string(key)),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.AuthenticationFailure[hubauth.CompleteSignupResponse](
						hubproblem.InvalidSignupTokenError,
						hubauthn.SignupChallenge,
					)
				}
				if err != nil {
					return handlerauth.Result[hubauth.CompleteSignupResponse]{}, nil, err
				}
				return handlerauth.Result[hubauth.CompleteSignupResponse]{
					Status: http.StatusCreated,
					Body: hubauth.CompleteSignupResponse{
						HubUserDID: hubspec.HubUserDID(
							dbvalue.FormatUUID(created.HubUserDid),
						),
						Handle: hubspec.HubHandle(created.Handle),
					},
				}, nil, nil
			},
		)
	}
}
