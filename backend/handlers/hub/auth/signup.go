package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	hubauth "github.com/vetchium/src/typespec/hub/auth"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/hub/signupcompletion"
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
		if !s.Signup.Enabled {
			s.Problem(r.Context(), w, hubproblem.SignupUnavailableError)
			return
		}
		result, err := s.SignupCompletion.Start(
			r.Context(), request, key,
			func(country common.CountryCode) bool {
				return s.Regions.Allows(s.TenantID, country)
			},
		)
		switch {
		case errors.Is(err, signupcompletion.ErrInvalidToken),
			errors.Is(err, signupcompletion.ErrExpired):
			s.AuthenticationProblem(
				r.Context(), w, hubproblem.InvalidSignupTokenError,
				hubauthn.SignupChallenge,
			)
		case errors.Is(err, signupcompletion.ErrIdempotencyConflict):
			s.Problem(r.Context(), w, problem.IdempotencyKeyConflictError)
		case errors.Is(err, signupcompletion.ErrPending):
			w.Header().Set("Cache-Control", "no-store")
			s.JSON(r.Context(), w, http.StatusAccepted,
				hubauth.SignupCompletionPendingResponse{
					OperationID: result.OperationID,
				},
			)
		case err != nil:
			s.InternalError(r.Context(), w, "complete Hub signup", err)
		default:
			w.Header().Set("Cache-Control", "no-store")
			s.JSON(r.Context(), w, http.StatusCreated, result.Response)
		}
	}
}
