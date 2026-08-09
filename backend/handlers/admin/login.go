package admin

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	adminauth "github.com/vetchium/src/typespec/admin/auth"
	admincommon "github.com/vetchium/src/typespec/admin/common"
	"github.com/vetchium/src/typespec/common"
	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"golang.org/x/crypto/bcrypt"

	"backend/internal/adminapi"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
)

const loginChallengeTTL = 5 * time.Minute

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
		AuthenticationState: "authenticated",
		AuthenticatedSessionResponse: admincommon.AuthenticatedSessionResponse{
			SessionToken:      admincommon.AdminSessionToken(token),
			SessionExpiresAt:  expiresAt,
			EffectiveLanguage: admincommon.LanguageCode(adminUser.EffectiveLanguage),
			EffectiveTimezone: common.TimeZoneID(adminUser.EffectiveTimezone),
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
		AuthenticationState:     "totp_required",
		LoginChallengeToken:     admincommon.AdminLoginChallengeToken(token),
		LoginChallengeExpiresAt: expiresAt,
		EffectiveLanguage:       admincommon.LanguageCode(adminUser.EffectiveLanguage),
		EffectiveTimezone:       common.TimeZoneID(adminUser.EffectiveTimezone),
	})
}
