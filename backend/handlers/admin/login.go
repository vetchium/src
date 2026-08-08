package admin

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	mrand "math/rand/v2"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/admin"

	"golang.org/x/crypto/bcrypt"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
)

func Login(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		var request admin.LoginRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			s.InvalidJSON(ctx, w, err)
			return
		}

		request = request.Normalize()

		invalidFields := request.Validate()
		if len(invalidFields) != 0 {
			s.DebugContext(
				ctx, "invalid req",
				"fields", invalidFields,
			)
			s.ValidationFailed(ctx, w, invalidFields)
			return
		}

		emailAddress := string(request.EmailAddress)

		// Sleep for random time to prevent timing attacks
		time.Sleep(time.Duration(mrand.IntN(5)) * time.Second)

		adminUser, err := s.Queries.GetAdminUserForLogin(
			ctx, emailAddress)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.WarnContext(
					ctx, "admin login failed",
					"event", "authentication_failed",
					"reason", "user_not_found",
					"error", err,
				)
				s.Unauthorized(w)
				return
			}
			s.InternalError(ctx, w, "get admin user", err)
			return
		}

		if err := bcrypt.CompareHashAndPassword(
			[]byte(adminUser.PasswordHash),
			[]byte(request.Password),
		); err != nil {
			if !errors.Is(
				err, bcrypt.ErrMismatchedHashAndPassword,
			) {
				s.InternalError(
					ctx, w, "compare admin password", err,
				)
				return
			}
			s.WarnContext(
				ctx, "admin login failed",
				"event", "authentication_failed",
				"reason", "invalid_password",
				"error", err,
			)
			s.Unauthorized(w)
			return
		}

		if adminUser.AdminUserState !=
			sqlc.VetchiumAdminUserStateActive {
			s.DebugContext(ctx, "disabled user")
			w.WriteHeader(http.StatusForbidden)
			return
		}

		secret := make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			s.InternalError(ctx, w, "generate session token", err)
			return
		}
		// Only the token hash is stored. A database disclosure therefore does
		// not hand out usable sessions.
		token := base64.RawURLEncoding.EncodeToString(secret)
		tokenHash := sha256.Sum256([]byte(token))

		expiresAt := time.Now().UTC().Add(s.AdminSessionTTL)
		session, err := s.Queries.CreateAdminSession(ctx,
			sqlc.CreateAdminSessionParams{
				SessionTokenHash: tokenHash[:],
				AdminUserID:      adminUser.AdminUserID,
				ExpiresAt: pgtype.Timestamptz{
					Time:  expiresAt,
					Valid: true,
				},
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// The account was active when checked, but it became
				// unavailable before the session was created.
				s.WarnContext(
					ctx,
					"admin session creation rejected",
					"event", "authentication_failed",
					"reason", "user_unavailable",
					"error", err,
				)
				w.WriteHeader(http.StatusForbidden)
				return
			}
			s.InternalError(
				ctx, w, "create admin session", err,
			)
			return
		}
		if session.ExpiresAt.Valid {
			expiresAt = session.ExpiresAt.Time
		}

		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if err := json.NewEncoder(w).Encode(admin.LoginResponse{
			SessionToken: token, ExpiresAt: expiresAt,
		}); err != nil {
			s.InternalError(
				ctx, w, "encode admin login response", err,
			)
		}
	}
}
