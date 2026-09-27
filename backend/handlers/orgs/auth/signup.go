package auth

import (
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"

	directoryspec "github.com/vetchium/src/typespec/directory"
	orgsauth "github.com/vetchium/src/typespec/orgs/auth"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/dnsverify"
	"backend/internal/handlerauth"
	orgsruntime "backend/internal/orgs"
	orgsauthn "backend/internal/orgs/auth"
	"backend/internal/orgs/orgmail"
	"backend/internal/orgs/signupcompletion"
)

const requestSignupOperation = "orgs:request-signup"

func RequestSignup(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request orgsauth.RequestSignupRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		if !s.Signup.Enabled {
			s.Problem(r.Context(), w, orgsproblem.SignupUnavailableError)
			return
		}
		emailAddress := string(request.EmailAddress)
		domain := string(request.Domain())

		// The global lookup is a network call, so it runs before the
		// idempotent transaction. A key that already holds a response skips
		// it: a replay keeps its original result even if the domain was
		// claimed since.
		ownedElsewhere := false
		_, err := s.Queries.GetIdempotency(
			r.Context(), sqlc.GetIdempotencyParams{
				Operation: requestSignupOperation, BindingID: emailAddress,
				IdempotencyKey: string(key),
			},
		)
		if errors.Is(err, pgx.ErrNoRows) {
			owned, available := resolveDomainOwner(s, r, domain)
			if !available {
				s.Problem(r.Context(), w, orgsproblem.DirectoryUnavailableError)
				return
			}
			ownedElsewhere = owned
		} else if err != nil {
			s.InternalError(r.Context(), w, "get Org signup idempotency", err)
			return
		}

		now := s.CurrentTime()
		handlerauth.RunIdempotent(
			s, w, r, requestSignupOperation, emailAddress, key, request,
			now.Add(24*time.Hour),
			func(q *sqlc.Queries) (
				handlerauth.Result[struct{}], *handlerauth.Problem, error,
			) {
				if ownedElsewhere {
					return handlerauth.Failure[struct{}](
						orgsproblem.DomainAlreadyOwnedError,
					)
				}
				return createSignupRequest(
					s, r, q, request, string(key), now,
				)
			},
		)
	}
}

func createSignupRequest(
	s *orgsruntime.Server, r *http.Request, q *sqlc.Queries,
	request orgsauth.RequestSignupRequest, key string, now time.Time,
) (handlerauth.Result[struct{}], *handlerauth.Problem, error) {
	emailAddress := string(request.EmailAddress)
	domain := string(request.Domain())
	linkToken, linkHash, err := credentials.NewToken()
	if err != nil {
		return handlerauth.Result[struct{}]{}, nil, err
	}
	dnsToken, err := dnsverify.NewToken()
	if err != nil {
		return handlerauth.Result[struct{}]{}, nil, err
	}
	requestID, err := dbvalue.NewUUID()
	if err != nil {
		return handlerauth.Result[struct{}]{}, nil, err
	}
	expiresAt := now.Add(s.SignupTTL)
	outboxKey := s.CredentialSubkey("outbox")
	dnsPayload, err := orgmail.Encrypt(outboxKey, orgmail.Payload{
		Domain:      domain,
		RecordName:  dnsverify.RecordName(domain),
		RecordValue: dnsverify.RecordValue(dnsToken),
		ExpiresAt:   expiresAt,
	})
	if err != nil {
		return handlerauth.Result[struct{}]{}, nil, err
	}
	linkPayload, err := orgmail.Encrypt(outboxKey, orgmail.Payload{
		Domain: domain,
		ActionURL: s.PublicBaseURL + "/complete-signup?token=" +
			url.QueryEscape(linkToken),
		ExpiresAt: expiresAt,
	})
	if err != nil {
		return handlerauth.Result[struct{}]{}, nil, err
	}
	result, err := q.CreateOrgSignupRequest(
		r.Context(), sqlc.CreateOrgSignupRequestParams{
			OrgSignupRequestID:    requestID,
			EmailAddress:          emailAddress,
			Domain:                domain,
			PreferredLanguage:     string(request.PreferredLanguage),
			VerificationToken:     dnsToken,
			TokenHash:             linkHash,
			ExpiresAt:             dbvalue.Timestamp(expiresAt),
			DnsPayloadCiphertext:  dnsPayload,
			LinkPayloadCiphertext: linkPayload,
			TenantID:              s.TenantID,
			IdempotencyKey:        dbvalue.Text(key),
		},
	)
	if err != nil {
		return handlerauth.Result[struct{}]{}, nil, err
	}
	switch result {
	case "blocked":
		return handlerauth.Failure[struct{}](
			orgsproblem.SignupDomainBlockedError,
		)
	case "owned":
		return handlerauth.Failure[struct{}](
			orgsproblem.DomainAlreadyOwnedError,
		)
	}
	return handlerauth.Result[struct{}]{
		Status: http.StatusAccepted, Body: struct{}{},
	}, nil, nil
}

// resolveDomainOwner reports whether an active Org in any tenant owns the
// domain. available is false when the directory cannot answer, and the caller
// fails closed.
func resolveDomainOwner(
	s *orgsruntime.Server, r *http.Request, domain string,
) (owned, available bool) {
	_, details, err := s.Directory.ResolveOrgDomain(
		r.Context(), directoryspec.ResolveOrgDomainRequest{
			Domain: orgsDomain(domain),
		},
	)
	switch {
	case err != nil:
		s.WarnContext(
			r.Context(), "global directory unavailable",
			"event", "org_directory_unavailable", "error", err,
		)
		return false, false
	case details == nil:
		return true, true
	case details.Status == http.StatusNotFound:
		return false, true
	default:
		s.WarnContext(
			r.Context(), "global directory refused Org domain lookup",
			"event", "org_directory_unavailable",
			"problemType", details.Type,
		)
		return false, false
	}
}

func GetSignupDetails(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request orgsauth.GetSignupDetailsRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		details, err := s.Queries.GetOrgSignupDetails(
			r.Context(), credentials.TokenHash(string(request.SignupToken)),
		)
		if errors.Is(err, pgx.ErrNoRows) {
			s.AuthenticationProblem(
				r.Context(), w, orgsproblem.InvalidSignupTokenError,
				orgsauthn.SignupChallenge,
			)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get Org signup details", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, orgsauth.SignupDetailsResponse{
			Domain:         orgsDomain(details.Domain),
			DNSRecordName:  dnsverify.RecordName(details.Domain),
			DNSRecordValue: dnsverify.RecordValue(details.VerificationToken),
			ExpiresAt:      details.ExpiresAt.Time.UTC(),
		})
	}
}

func CompleteSignup(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request orgsauth.CompleteSignupRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		if !s.Signup.Enabled {
			s.Problem(r.Context(), w, orgsproblem.SignupUnavailableError)
			return
		}
		result, err := s.SignupCompletion.Start(r.Context(), request, key)
		switch {
		case errors.Is(err, signupcompletion.ErrInvalidToken),
			errors.Is(err, signupcompletion.ErrExpired):
			s.AuthenticationProblem(
				r.Context(), w, orgsproblem.InvalidSignupTokenError,
				orgsauthn.SignupChallenge,
			)
		case errors.Is(err, signupcompletion.ErrIdempotencyConflict):
			s.Problem(r.Context(), w, problem.IdempotencyKeyConflictError)
		case errors.Is(err, signupcompletion.ErrDomainBlocked):
			s.Problem(r.Context(), w, orgsproblem.SignupDomainBlockedError)
		case errors.Is(err, signupcompletion.ErrDomainOwned):
			s.Problem(r.Context(), w, orgsproblem.DomainAlreadyOwnedError)
		case errors.Is(err, signupcompletion.ErrRecordNotFound):
			s.Problem(r.Context(), w, orgsproblem.DNSRecordNotFoundError)
		case errors.Is(err, signupcompletion.ErrDirectoryUnavailable):
			s.WarnContext(
				r.Context(), "global directory unavailable",
				"event", "org_directory_unavailable", "error", err,
			)
			s.Problem(r.Context(), w, orgsproblem.DirectoryUnavailableError)
		case errors.Is(err, signupcompletion.ErrPending):
			w.Header().Set("Cache-Control", "no-store")
			s.JSON(r.Context(), w, http.StatusAccepted,
				orgsauth.SignupCompletionPendingResponse{
					OperationID: result.OperationID,
				},
			)
		case err != nil:
			s.InternalError(r.Context(), w, "complete Org signup", err)
		default:
			w.Header().Set("Cache-Control", "no-store")
			s.JSON(r.Context(), w, http.StatusCreated, result.Response)
		}
	}
}
