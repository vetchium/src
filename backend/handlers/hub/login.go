package hub

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	hubspec "github.com/vetchium/src/typespec/hub"
	hubauth "github.com/vetchium/src/typespec/hub/auth"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"golang.org/x/crypto/bcrypt"

	"backend/internal/db/sqlc"
	"backend/internal/hubapi"
	"backend/internal/middleware"
)

const loginChallengeTTL = 5 * time.Minute

func Login(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.LoginRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
			return
		}
		request = request.Normalize()
		user, err := s.Queries.GetHubUserForLogin(
			r.Context(), string(request.EmailAddress),
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				hubapi.CompareUnknownPassword(string(request.Password))
				s.Problem(
					r.Context(), w, hubproblem.InvalidCredentialsError,
					hubapi.LoginChallenge,
				)
				return
			}
			s.InternalError(r.Context(), w, "get Hub user for login", err)
			return
		}
		if err := hubapi.ComparePassword(
			user.PasswordHash, string(request.Password),
		); err != nil {
			if !errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
				s.InternalError(r.Context(), w, "compare Hub password", err)
				return
			}
			s.Problem(
				r.Context(), w, hubproblem.InvalidCredentialsError,
				hubapi.LoginChallenge,
			)
			return
		}
		if user.HubUserState != sqlc.VetchiumHubUserStateActive {
			s.Problem(r.Context(), w, hubproblem.HubUserDisabledError)
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
	s *hubapi.Server, w http.ResponseWriter, r *http.Request,
	user sqlc.GetHubUserForLoginRow, remembered bool,
) {
	token, tokenHash, err := hubapi.NewToken()
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
			ExpiresAt:            hubapi.Timestamp(expiresAt),
			Remembered:           remembered,
			TenantID:             s.TenantID,
		},
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(
				r.Context(), w, hubproblem.InvalidCredentialsError,
				hubapi.LoginChallenge,
			)
			return
		}
		s.InternalError(r.Context(), w, "create Hub session", err)
		return
	}
	if session.ExpiresAt.Valid {
		expiresAt = session.ExpiresAt.Time
	}
	s.JSON(r.Context(), w, http.StatusOK, hubauth.LoginAuthenticatedResponse{
		AuthenticationState: hubauth.AuthenticationStateAuthenticated,
		AuthenticatedSessionResponse: authenticatedSessionResponse(
			token, expiresAt, user.HubUserDid, user.Handle,
			user.PreferredLanguage, user.ResidentCountry,
		),
	})
}

func loginWithTOTP(
	s *hubapi.Server, w http.ResponseWriter, r *http.Request,
	user sqlc.GetHubUserForLoginRow, remembered bool,
) {
	token, tokenHash, err := hubapi.NewToken()
	if err != nil {
		s.InternalError(r.Context(), w, "generate Hub login challenge", err)
		return
	}
	expiresAt := s.CurrentTime().Add(loginChallengeTTL)
	challenge, err := withHubCredentialLock(
		s, r, hubCredentialLock{userDID: user.HubUserDid},
		func(q sqlc.Querier) (sqlc.CreateHubLoginChallengeRow, error) {
			return q.CreateHubLoginChallenge(
				r.Context(), sqlc.CreateHubLoginChallengeParams{
					HubUserDid:           user.HubUserDid,
					VerifiedPasswordHash: user.PasswordHash,
					TokenHash:            tokenHash,
					Remembered:           remembered,
					ExpiresAt:            hubapi.Timestamp(expiresAt),
					TenantID:             s.TenantID,
				},
			)
		},
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(
				r.Context(), w, hubproblem.InvalidCredentialsError,
				hubapi.LoginChallenge,
			)
			return
		}
		s.InternalError(r.Context(), w, "create Hub login challenge", err)
		return
	}
	if challenge.ExpiresAt.Valid {
		expiresAt = challenge.ExpiresAt.Time
	}
	s.JSON(r.Context(), w, http.StatusOK, hubauth.LoginTOTPRequiredResponse{
		AuthenticationState:     hubauth.AuthenticationStateTOTPRequired,
		LoginChallengeToken:     hubauth.HubLoginChallengeToken(token),
		LoginChallengeExpiresAt: expiresAt.UTC(),
	})
}

func Reauthenticate(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request hubauth.ReauthenticateRequest
		if !decodeAndValidate(s, w, r, &request, func() []string {
			return request.Validate()
		}) {
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
				s.Problem(r.Context(), w, hubproblem.IncorrectPasswordError)
				return
			}
			s.InternalError(r.Context(), w, "get Hub password", err)
			return
		}
		if err := hubapi.ComparePassword(
			passwordHash, string(request.Password),
		); err != nil {
			if !errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
				s.InternalError(r.Context(), w, "compare Hub password", err)
				return
			}
			s.Problem(r.Context(), w, hubproblem.IncorrectPasswordError)
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
				s.Problem(r.Context(), w, hubproblem.IncorrectPasswordError)
				return
			}
			s.InternalError(r.Context(), w, "reauthenticate Hub session", err)
			return
		}
		s.JSON(r.Context(), w, http.StatusOK, hubauth.ReauthenticateResponse{
			SessionAuthenticatedAt: authenticatedAt.Time.UTC(),
		})
	}
}

func authenticatedSessionResponse(
	token string, expiresAt time.Time, did pgtype.UUID, handle string,
	preferredLanguage, residentCountry string,
) hubauth.AuthenticatedSessionResponse {
	return hubauth.AuthenticatedSessionResponse{
		SessionToken:      hubauth.HubSessionToken(token),
		SessionExpiresAt:  expiresAt.UTC(),
		PreferredLanguage: common.FrontendLocale(preferredLanguage),
		ResidentCountry:   common.CountryCode(residentCountry),
		HubUserDID:        hubspec.HubUserDID(hubapi.FormatUUID(did)),
		Handle:            hubspec.HubHandle(handle),
	}
}
