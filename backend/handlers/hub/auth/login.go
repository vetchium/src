package auth

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/hub/auth"
	problem "github.com/vetchium/src/typespec/problem/hub"

	"golang.org/x/crypto/bcrypt"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/middleware"
)

const loginChallengeTTL = 5 * time.Minute

func Login(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request auth.LoginRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		user, err := s.Queries.GetHubUserForLogin(
			r.Context(), string(request.EmailAddress),
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				credentials.CompareUnknownPassword(string(request.Password))
				s.AuthenticationProblem(
					r.Context(), w, problem.InvalidCredentialsError,
					hubauthn.LoginChallenge,
				)
				return
			}
			s.InternalError(r.Context(), w, "get Hub user for login", err)
			return
		}
		if err := credentials.ComparePassword(
			user.PasswordHash, string(request.Password),
		); err != nil {
			if !errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
				s.InternalError(r.Context(), w, "compare Hub password", err)
				return
			}
			s.AuthenticationProblem(
				r.Context(), w, problem.InvalidCredentialsError,
				hubauthn.LoginChallenge,
			)
			return
		}
		if user.HubUserState != sqlc.VetchiumHubUserStateActive {
			s.Problem(r.Context(), w, problem.HubUserDisabledError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if user.TotpEnabled {
			loginWithTOTP(s, w, r, user, request.EffectiveRememberMe())
			return
		}
		loginWithoutTOTP(s, w, r, user, request.EffectiveRememberMe())
	}
}

func loginWithoutTOTP(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	user sqlc.GetHubUserForLoginRow, remembered bool,
) {
	token, tokenHash, err := credentials.NewToken()
	if err != nil {
		s.InternalError(r.Context(), w, "generate Hub session token", err)
		return
	}
	expiresAt := s.CurrentTime().Add(s.SessionDuration(remembered))
	session, err := s.Queries.CreateHubSession(
		r.Context(), sqlc.CreateHubSessionParams{
			HubUserDid:           user.HubUserDid,
			VerifiedPasswordHash: user.PasswordHash,
			SessionTokenHash:     tokenHash,
			ExpiresAt:            dbvalue.Timestamp(expiresAt),
			Remembered:           remembered,
			TenantID:             s.TenantID,
		},
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.AuthenticationProblem(
				r.Context(), w, problem.InvalidCredentialsError,
				hubauthn.LoginChallenge,
			)
			return
		}
		s.InternalError(r.Context(), w, "create Hub session", err)
		return
	}
	if session.ExpiresAt.Valid {
		expiresAt = session.ExpiresAt.Time
	}
	s.JSON(r.Context(), w, http.StatusOK, auth.LoginAuthenticatedResponse{
		AuthenticationState: auth.AuthenticationStateAuthenticated,
		AuthenticatedSessionResponse: authenticatedSessionResponse(
			token, expiresAt, user.HubUserDid, user.Handle,
			user.PreferredLanguage, user.ResidentCountry,
		),
	})
}

func loginWithTOTP(
	s *hubruntime.Server, w http.ResponseWriter, r *http.Request,
	user sqlc.GetHubUserForLoginRow, remembered bool,
) {
	token, tokenHash, err := credentials.NewToken()
	if err != nil {
		s.InternalError(r.Context(), w, "generate Hub login challenge", err)
		return
	}
	expiresAt := s.CurrentTime().Add(loginChallengeTTL)
	challenge, err := handlerauth.WithCredentialLock(
		s, r, hubCredentialLocker(hubCredentialLock{
			userDID: user.HubUserDid,
		}),
		func(q sqlc.Querier) (sqlc.CreateHubLoginChallengeRow, error) {
			return q.CreateHubLoginChallenge(
				r.Context(), sqlc.CreateHubLoginChallengeParams{
					HubUserDid:           user.HubUserDid,
					VerifiedPasswordHash: user.PasswordHash,
					TokenHash:            tokenHash,
					Remembered:           remembered,
					ExpiresAt:            dbvalue.Timestamp(expiresAt),
					TenantID:             s.TenantID,
				},
			)
		},
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.AuthenticationProblem(
				r.Context(), w, problem.InvalidCredentialsError,
				hubauthn.LoginChallenge,
			)
			return
		}
		s.InternalError(r.Context(), w, "create Hub login challenge", err)
		return
	}
	if challenge.ExpiresAt.Valid {
		expiresAt = challenge.ExpiresAt.Time
	}
	s.JSON(r.Context(), w, http.StatusOK, auth.LoginTOTPRequiredResponse{
		AuthenticationState:     auth.AuthenticationStateTOTPRequired,
		LoginChallengeToken:     auth.HubLoginChallengeToken(token),
		LoginChallengeExpiresAt: expiresAt.UTC(),
	})
}

func Reauthenticate(s *hubruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request auth.ReauthenticateRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.HubIdentityFromContext(r.Context())
		passwordHash, err := s.Queries.GetHubPasswordForReauthentication(
			r.Context(), sqlc.GetHubPasswordForReauthenticationParams{
				HubSessionID: identity.SessionID,
				HubUserDid:   identity.UserDID,
			},
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Problem(r.Context(), w, problem.IncorrectPasswordError)
				return
			}
			s.InternalError(r.Context(), w, "get Hub password", err)
			return
		}
		if err := credentials.ComparePassword(
			passwordHash, string(request.Password),
		); err != nil {
			if !errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
				s.InternalError(r.Context(), w, "compare Hub password", err)
				return
			}
			s.Problem(r.Context(), w, problem.IncorrectPasswordError)
			return
		}
		authenticatedAt, err := s.Queries.ReauthenticateHubSession(
			r.Context(), sqlc.ReauthenticateHubSessionParams{
				HubSessionID:         identity.SessionID,
				HubUserDid:           identity.UserDID,
				VerifiedPasswordHash: passwordHash,
				TenantID:             s.TenantID,
			},
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Problem(r.Context(), w, problem.IncorrectPasswordError)
				return
			}
			s.InternalError(r.Context(), w, "reauthenticate Hub session", err)
			return
		}
		s.JSON(r.Context(), w, http.StatusOK, auth.ReauthenticateResponse{
			SessionAuthenticatedAt: authenticatedAt.Time.UTC(),
		})
	}
}

func authenticatedSessionResponse(
	token string, expiresAt time.Time, did pgtype.UUID, handle string,
	preferredLanguage, residentCountry string,
) auth.AuthenticatedSessionResponse {
	return auth.AuthenticatedSessionResponse{
		SessionToken:      auth.HubSessionToken(token),
		SessionExpiresAt:  expiresAt.UTC(),
		PreferredLanguage: common.FrontendLocale(preferredLanguage),
		ResidentCountry:   common.CountryCode(residentCountry),
		HubUserDID:        hub.HubUserDID(dbvalue.FormatUUID(did)),
		Handle:            hub.HubHandle(handle),
	}
}
