package admin

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	adminauth "github.com/vetchium/src/typespec/admin/auth"
	"github.com/vetchium/src/typespec/common"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"golang.org/x/crypto/bcrypt"

	"backend/internal/adminapi"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
)

const loginChallengeTTL = 5 * time.Minute

func Reauthenticate(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		var request adminauth.ReauthenticateRequest
		if err := apiserver.DecodeJSON(r, &request); err != nil {
			s.InvalidJSON(ctx, w, err)
			return
		}
		if fields := request.Validate(); len(fields) != 0 {
			s.ValidationFailed(ctx, w, fields)
			return
		}
		identity, _ := middleware.AdminIdentityFromContext(ctx)
		passwordHash, err := s.Queries.GetAdminPasswordForReauthentication(
			ctx, sqlc.GetAdminPasswordForReauthenticationParams{
				AdminSessionID: identity.SessionID,
				AdminUserID:    identity.UserID,
			},
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Problem(ctx, w, adminproblem.IncorrectPasswordError)
				return
			}
			s.InternalError(ctx, w, "get admin password for reauthentication", err)
			return
		}
		if err := adminapi.ComparePassword(
			passwordHash, string(request.Password),
		); err != nil {
			if !errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
				s.InternalError(ctx, w, "compare admin password", err)
				return
			}
			s.Problem(ctx, w, adminproblem.IncorrectPasswordError)
			return
		}
		authenticatedAt, err := s.Queries.ReauthenticateAdminSession(
			ctx, sqlc.ReauthenticateAdminSessionParams{
				AdminSessionID:       identity.SessionID,
				AdminUserID:          identity.UserID,
				VerifiedPasswordHash: passwordHash,
				TenantID:             s.TenantID,
			},
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Problem(ctx, w, adminproblem.IncorrectPasswordError)
				return
			}
			s.InternalError(ctx, w, "reauthenticate admin session", err)
			return
		}
		s.JSON(ctx, w, http.StatusOK, adminauth.ReauthenticateResponse{
			SessionAuthenticatedAt: authenticatedAt.Time.UTC(),
		})
	}
}

func Login(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		var request adminauth.LoginRequest
		if err := apiserver.DecodeJSON(r, &request); err != nil {
			s.InvalidJSON(ctx, w, err)
			return
		}
		request = request.Normalize()
		if fields := request.Validate(); len(fields) != 0 {
			s.ValidationFailed(ctx, w, fields)
			return
		}
		adminUser, err := s.Queries.GetAdminUserForLogin(
			ctx, string(request.EmailAddress),
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				adminapi.CompareUnknownPassword(string(request.Password))
				s.Problem(
					ctx, w, adminproblem.InvalidCredentialsError,
					adminapi.LoginChallenge,
				)
				return
			}
			s.InternalError(ctx, w, "get admin user for login", err)
			return
		}
		if err := adminapi.ComparePassword(
			adminUser.PasswordHash, string(request.Password),
		); err != nil {
			if !errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
				s.InternalError(ctx, w, "compare admin password", err)
				return
			}
			s.Problem(
				ctx, w, adminproblem.InvalidCredentialsError,
				adminapi.LoginChallenge,
			)
			return
		}
		if adminUser.AdminUserState != sqlc.VetchiumAdminUserStateActive {
			s.Problem(ctx, w, adminproblem.AdminUserDisabledError)
			return
		}

		w.Header().Set("Cache-Control", "no-store")
		if adminUser.TotpEnabled {
			loginWithTOTP(s, w, r, adminUser)
			return
		}
		loginWithoutTOTP(s, w, r, adminUser)
	}
}

func loginWithoutTOTP(
	s *adminapi.Server, w http.ResponseWriter, r *http.Request,
	adminUser sqlc.GetAdminUserForLoginRow,
) {
	token, tokenHash, err := adminapi.NewToken()
	if err != nil {
		s.InternalError(r.Context(), w, "generate admin session token", err)
		return
	}
	expiresAt := s.CurrentTime().Add(s.AdminSessionTTL)
	session, err := s.Queries.CreateAdminSession(
		r.Context(), sqlc.CreateAdminSessionParams{
			SessionTokenHash:     tokenHash,
			AdminUserID:          adminUser.AdminUserID,
			ExpiresAt:            adminapi.Timestamp(expiresAt),
			VerifiedPasswordHash: adminUser.PasswordHash,
			TenantID:             s.TenantID,
		},
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(
				r.Context(), w, adminproblem.InvalidCredentialsError,
				adminapi.LoginChallenge,
			)
			return
		}
		s.InternalError(r.Context(), w, "create admin session", err)
		return
	}
	if session.ExpiresAt.Valid {
		expiresAt = session.ExpiresAt.Time
	}
	s.JSON(r.Context(), w, http.StatusOK, adminauth.LoginAuthenticatedResponse{
		AuthenticationState: adminauth.AuthenticationStateAuthenticated,
		AuthenticatedSessionResponse: adminauth.AuthenticatedSessionResponse{
			SessionToken:      adminauth.AdminSessionToken(token),
			SessionExpiresAt:  expiresAt.UTC(),
			PreferredLanguage: common.FrontendLocale(adminUser.PreferredLanguage),
		},
	})
}

func loginWithTOTP(
	s *adminapi.Server, w http.ResponseWriter, r *http.Request,
	adminUser sqlc.GetAdminUserForLoginRow,
) {
	token, tokenHash, err := adminapi.NewToken()
	if err != nil {
		s.InternalError(r.Context(), w, "generate login challenge token", err)
		return
	}
	expiresAt := s.CurrentTime().Add(loginChallengeTTL)
	challenge, err := withAdminCredentialLock(
		s, r, adminCredentialLock{userID: adminUser.AdminUserID},
		func(q sqlc.Querier) (sqlc.CreateAdminLoginChallengeRow, error) {
			return q.CreateAdminLoginChallenge(
				r.Context(), sqlc.CreateAdminLoginChallengeParams{
					AdminUserID:          adminUser.AdminUserID,
					TokenHash:            tokenHash,
					VerifiedPasswordHash: adminUser.PasswordHash,
					ExpiresAt: pgtype.Timestamptz{
						Time: expiresAt, Valid: true,
					},
					TenantID: s.TenantID,
				},
			)
		},
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.Problem(
				r.Context(), w, adminproblem.InvalidCredentialsError,
				adminapi.LoginChallenge,
			)
			return
		}
		s.InternalError(r.Context(), w, "create login challenge", err)
		return
	}
	if challenge.ExpiresAt.Valid {
		expiresAt = challenge.ExpiresAt.Time
	}
	s.JSON(r.Context(), w, http.StatusOK, adminauth.LoginTOTPRequiredResponse{
		AuthenticationState:     adminauth.AuthenticationStateTOTPRequired,
		LoginChallengeToken:     adminauth.AdminLoginChallengeToken(token),
		LoginChallengeExpiresAt: expiresAt.UTC(),
	})
}
