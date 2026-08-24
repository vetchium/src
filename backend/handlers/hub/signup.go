package hub

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	hubspec "github.com/vetchium/src/typespec/hub"
	hubauth "github.com/vetchium/src/typespec/hub/auth"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/db/sqlc"
	"backend/internal/hubapi"
)

const signupTTL = 24 * time.Hour

type signupEmailPayload struct {
	DisplayName     string    `json:"display_name"`
	VerificationURL string    `json:"verification_url"`
	ExpiresAt       time.Time `json:"expires_at"`
}

func RequestSignup(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.RequestSignupRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		request = request.Normalize()
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		emailAddress := string(request.EmailAddress)
		domain := emailAddress[strings.LastIndexByte(emailAddress, '@')+1:]
		now := s.CurrentTime()
		runIdempotent(
			s, w, r, "hub:request-signup", emailAddress, key, request,
			now.Add(signupTTL),
			func(q *sqlc.Queries) (
				idempotentResult[struct{}], *apiProblem, error,
			) {
				token, tokenHash, err := hubapi.NewToken()
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				requestID, err := hubapi.NewUUID()
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				expiresAt := now.Add(signupTTL)
				payload, err := json.Marshal(signupEmailPayload{
					DisplayName: string(request.DisplayName),
					VerificationURL: s.PublicBaseURL +
						"/complete-signup?token=" + url.QueryEscape(token),
					ExpiresAt: expiresAt,
				})
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				ciphertext, err := hubapi.Encrypt(
					s.CredentialSubkey("outbox"), payload,
				)
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				result, err := q.CreateHubSignupRequest(
					r.Context(), sqlc.CreateHubSignupRequestParams{
						EmailDomain:        domain,
						EmailAddress:       emailAddress,
						HubSignupRequestID: requestID,
						DisplayName:        string(request.DisplayName),
						PreferredLanguage:  string(request.PreferredLanguage),
						ResidentCountry:    string(request.ResidentCountry),
						TokenHash:          tokenHash,
						ExpiresAt:          hubapi.Timestamp(expiresAt),
						PayloadCiphertext:  ciphertext,
						TenantID:           s.TenantID,
						IdempotencyKey:     hubapi.Text(string(key)),
					},
				)
				if err != nil {
					return idempotentResult[struct{}]{}, nil, err
				}
				if result == "domain_not_allowed" {
					return idempotentResult[struct{}]{}, &apiProblem{
						details: hubproblem.SignupDomainNotAllowedError,
					}, nil
				}
				return idempotentResult[struct{}]{
					status: http.StatusAccepted, body: struct{}{},
				}, nil, nil
			},
		)
	}
}

func CompleteSignup(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.CompleteSignupRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		key, ok := idempotencyKey(s, w, r)
		if !ok {
			return
		}
		tokenHash := hubapi.TokenHash(string(request.SignupToken))
		binding := base64.RawURLEncoding.EncodeToString(tokenHash)
		runIdempotent(
			s, w, r, "hub:complete-signup", binding, key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (
				idempotentResult[hubauth.CompleteSignupResponse],
				*apiProblem, error,
			) {
				signup, err := q.ResolveHubSignupForCompletion(
					r.Context(), tokenHash,
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return invalidSignupTokenResult()
				}
				if err != nil {
					return idempotentResult[hubauth.CompleteSignupResponse]{}, nil, err
				}
				passwordHash, err := hubapi.HashPassword(string(request.Password))
				if err != nil {
					return idempotentResult[hubauth.CompleteSignupResponse]{}, nil, err
				}
				shortID, err := s.Coordinator.GenerateShortID(r.Context())
				if err != nil {
					return idempotentResult[hubauth.CompleteSignupResponse]{}, nil, err
				}
				did, err := hubapi.NewUUIDv7(s.CurrentTime())
				if err != nil {
					return idempotentResult[hubauth.CompleteSignupResponse]{}, nil, err
				}
				handle := hubapi.Handle(signup.DisplayName, shortID)
				created, err := q.CompleteHubSignup(
					r.Context(), sqlc.CompleteHubSignupParams{
						HubSignupRequestID: signup.HubSignupRequestID,
						HubUserDid:         did,
						Handle:             string(handle),
						PasswordHash:       passwordHash,
						TenantID:           s.TenantID,
						IdempotencyKey:     hubapi.Text(string(key)),
					},
				)
				if errors.Is(err, pgx.ErrNoRows) {
					return invalidSignupTokenResult()
				}
				if err != nil {
					return idempotentResult[hubauth.CompleteSignupResponse]{}, nil, err
				}
				return idempotentResult[hubauth.CompleteSignupResponse]{
					status: http.StatusCreated,
					body: hubauth.CompleteSignupResponse{
						HubUserDID: hubspec.HubUserDID(
							hubapi.FormatUUID(created.HubUserDid),
						),
						Handle: hubspec.HubHandle(created.Handle),
					},
				}, nil, nil
			},
		)
	}
}

func invalidSignupTokenResult() (
	idempotentResult[hubauth.CompleteSignupResponse], *apiProblem, error,
) {
	return idempotentResult[hubauth.CompleteSignupResponse]{}, &apiProblem{
		details:         hubproblem.InvalidSignupTokenError,
		wwwAuthenticate: hubapi.SignupChallenge,
	}, nil
}
