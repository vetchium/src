package auth

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/vetchium/src/typespec/orgs"
	orgsauth "github.com/vetchium/src/typespec/orgs/auth"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	orgsauthn "backend/internal/orgs/auth"
)

const loginChallengeTTL = 5 * time.Minute

func Login(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request orgsauth.LoginRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		user, err := s.Queries.GetOrgUserForLogin(
			r.Context(), sqlc.GetOrgUserForLoginParams{
				Domain:       string(request.Domain),
				EmailAddress: string(request.EmailAddress),
			},
		)
		if errors.Is(err, pgx.ErrNoRows) {
			credentials.CompareUnknownPassword(string(request.Password))
			invalidCredentials(s, w, r)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get Org user for login", err)
			return
		}
		if err := credentials.ComparePassword(
			user.PasswordHash, string(request.Password),
		); err != nil {
			if !errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
				s.InternalError(r.Context(), w, "compare Org password", err)
				return
			}
			invalidCredentials(s, w, r)
			return
		}
		if user.OrgUserState != sqlc.VetchiumOrgUserStateActive {
			if user.DisabledReason.String == "nonpayment" {
				s.Problem(
					r.Context(), w, orgsproblem.OrgUserDisabledNonpaymentError,
				)
				return
			}
			s.Problem(r.Context(), w, orgsproblem.OrgUserDisabledError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if user.TotpEnabled {
			loginWithTOTP(s, w, r, user)
			return
		}
		loginWithoutTOTP(s, w, r, user)
	}
}

func invalidCredentials(
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request,
) {
	s.AuthenticationProblem(
		r.Context(), w, orgsproblem.InvalidCredentialsError,
		orgsauthn.LoginChallenge,
	)
}

func loginWithoutTOTP(
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request,
	user sqlc.GetOrgUserForLoginRow,
) {
	token, tokenHash, err := credentials.NewToken()
	if err != nil {
		s.InternalError(r.Context(), w, "generate Org session token", err)
		return
	}
	expiresAt := s.CurrentTime().Add(s.SessionTTL)
	session, err := s.Queries.CreateOrgSession(
		r.Context(), sqlc.CreateOrgSessionParams{
			OrgUserID:            user.OrgUserID,
			VerifiedPasswordHash: user.PasswordHash,
			SessionTokenHash:     tokenHash,
			ExpiresAt:            dbvalue.Timestamp(expiresAt),
			TenantID:             s.TenantID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		invalidCredentials(s, w, r)
		return
	}
	if err != nil {
		s.InternalError(r.Context(), w, "create Org session", err)
		return
	}
	if session.ExpiresAt.Valid {
		expiresAt = session.ExpiresAt.Time
	}
	s.JSON(r.Context(), w, http.StatusOK, orgsauth.LoginAuthenticatedResponse{
		AuthenticationState: orgsauth.AuthenticationStateAuthenticated,
		AuthenticatedSessionResponse: sessionResponse(
			token, expiresAt, user.PreferredLanguage,
		),
	})
}

func loginWithTOTP(
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request,
	user sqlc.GetOrgUserForLoginRow,
) {
	token, tokenHash, err := credentials.NewToken()
	if err != nil {
		s.InternalError(r.Context(), w, "generate Org login challenge", err)
		return
	}
	expiresAt := s.CurrentTime().Add(loginChallengeTTL)
	challenge, err := handlerauth.WithCredentialLock(
		s, r, orgCredentialLocker(user.OrgUserID),
		func(q sqlc.Querier) (sqlc.CreateOrgLoginChallengeRow, error) {
			return q.CreateOrgLoginChallenge(
				r.Context(), sqlc.CreateOrgLoginChallengeParams{
					OrgUserID:            user.OrgUserID,
					VerifiedPasswordHash: user.PasswordHash,
					TokenHash:            tokenHash,
					ExpiresAt:            dbvalue.Timestamp(expiresAt),
					TenantID:             s.TenantID,
				},
			)
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		invalidCredentials(s, w, r)
		return
	}
	if err != nil {
		s.InternalError(r.Context(), w, "create Org login challenge", err)
		return
	}
	if challenge.ExpiresAt.Valid {
		expiresAt = challenge.ExpiresAt.Time
	}
	s.JSON(r.Context(), w, http.StatusOK, orgsauth.LoginTOTPRequiredResponse{
		AuthenticationState:     orgsauth.AuthenticationStateTOTPRequired,
		LoginChallengeToken:     orgsauth.OrgLoginChallengeToken(token),
		LoginChallengeExpiresAt: expiresAt.UTC(),
	})
}

func Reauthenticate(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request orgsauth.ReauthenticateRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		passwordHash, err := s.Queries.GetOrgPasswordForReauthentication(
			r.Context(), sqlc.GetOrgPasswordForReauthenticationParams{
				OrgSessionID: identity.SessionID, OrgUserID: identity.UserID,
			},
		)
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.IncorrectPasswordError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get Org password", err)
			return
		}
		if err := credentials.ComparePassword(
			passwordHash, string(request.Password),
		); err != nil {
			if !errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
				s.InternalError(r.Context(), w, "compare Org password", err)
				return
			}
			s.Problem(r.Context(), w, orgsproblem.IncorrectPasswordError)
			return
		}
		authenticatedAt, err := s.Queries.ReauthenticateOrgSession(
			r.Context(), sqlc.ReauthenticateOrgSessionParams{
				OrgSessionID:         identity.SessionID,
				OrgUserID:            identity.UserID,
				VerifiedPasswordHash: passwordHash,
				TenantID:             s.TenantID,
			},
		)
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(r.Context(), w, orgsproblem.IncorrectPasswordError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "reauthenticate Org session", err)
			return
		}
		s.JSON(r.Context(), w, http.StatusOK, orgsauth.ReauthenticateResponse{
			SessionAuthenticatedAt: authenticatedAt.Time.UTC(),
		})
	}
}

func sessionResponse(
	token string, expiresAt time.Time, preferredLanguage string,
) orgsauth.AuthenticatedSessionResponse {
	return orgsauth.AuthenticatedSessionResponse{
		SessionToken:      orgsauth.OrgSessionToken(token),
		SessionExpiresAt:  expiresAt.UTC(),
		PreferredLanguage: orgs.FrontendLocale(preferredLanguage),
	}
}

func orgsDomain(domain string) orgs.OrgDomain {
	return orgs.OrgDomain(domain)
}
