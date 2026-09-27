package auth

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
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

// signupRegisteredElsewhereEmailPayload deliberately carries no signup link:
// the recipient already has an account, so the only useful action is signing
// in at their home region (GU-SIG-003).
type signupRegisteredElsewhereEmailPayload struct {
	DisplayName string `json:"display_name"`
	HomeTenant  string `json:"home_tenant"`
	SignInURL   string `json:"sign_in_url"`
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

		// Resolved once, outside the idempotent transaction: this is a
		// network call, and an errored or not-found result must not block
		// signup or code delivery (GU-SIG-002). The response stays the
		// identical 202 either way, so this can never be used to test
		// whether an address is registered.
		accountDigest := s.DigestKey.HubAccountEmail(emailAddress)
		var registeredElsewhereTenantID string
		resolved, details, err := s.Directory.ResolveHubAccountEmail(
			r.Context(), directoryspec.ResolveHubAccountEmailRequest{
				EmailDigest: directoryspec.EmailDigest(
					hex.EncodeToString(accountDigest),
				),
				DigestKeyID: directoryspec.DigestKeyID(s.DigestKey.ID()),
			},
		)
		if err == nil && details == nil &&
			string(resolved.HomeTenantID) != s.TenantID {
			registeredElsewhereTenantID = string(resolved.HomeTenantID)
		}
		var elsewhereCiphertext []byte
		if registeredElsewhereTenantID != "" {
			if signInURL, ok := s.Regions.HubURL(registeredElsewhereTenantID); ok {
				elsewhereCiphertext, err = encryptElsewherePayload(
					s, string(request.DisplayName),
					registeredElsewhereTenantID, signInURL,
				)
				if err != nil {
					s.InternalError(
						r.Context(), w, "encrypt registered-elsewhere notice", err,
					)
					return
				}
			} else {
				s.WarnContext(
					r.Context(), "Hub account home tenant missing from region catalog",
					"event", "hub_account_home_tenant_unknown",
					"tenantID", registeredElsewhereTenantID,
				)
				registeredElsewhereTenantID = ""
			}
		}

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
						RegisteredElsewhereTenantID: dbvalue.NullText(
							nilIfEmpty(registeredElsewhereTenantID),
						),
						PayloadCiphertext:          ciphertext,
						ElsewherePayloadCiphertext: elsewhereCiphertext,
						TenantID:                   s.TenantID,
						IdempotencyKey:             dbvalue.Text(string(key)),
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

func encryptElsewherePayload(
	s *hubruntime.Server, displayName, homeTenant, signInURL string,
) ([]byte, error) {
	payload, err := json.Marshal(signupRegisteredElsewhereEmailPayload{
		DisplayName: displayName, HomeTenant: homeTenant,
		SignInURL: signInURL,
	})
	if err != nil {
		return nil, err
	}
	return credentials.Encrypt(s.CredentialSubkey("outbox"), payload)
}

func nilIfEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
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
		var elsewhere *signupcompletion.ErrRegisteredElsewhere
		switch {
		case errors.Is(err, signupcompletion.ErrInvalidToken),
			errors.Is(err, signupcompletion.ErrExpired):
			s.AuthenticationProblem(
				r.Context(), w, hubproblem.InvalidSignupTokenError,
				hubauthn.SignupChallenge,
			)
		case errors.As(err, &elsewhere):
			// The home tenant is unknown only when the coordinator lookup at
			// completion time itself failed or named a tenant this catalog
			// does not have a Hub URL for; either way there is nothing
			// useful to redirect to (GU-SIG-005).
			var hubURL string
			var ok bool
			if elsewhere.HomeTenantID != "" {
				hubURL, ok = s.Regions.HubURL(elsewhere.HomeTenantID)
			}
			if !ok {
				s.AuthenticationProblem(
					r.Context(), w, hubproblem.InvalidSignupTokenError,
					hubauthn.SignupChallenge,
				)
				return
			}
			s.Problem(r.Context(), w, hubproblem.HubAccountHomedElsewhereError(
				elsewhere.HomeTenantID, hubURL,
			))
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
