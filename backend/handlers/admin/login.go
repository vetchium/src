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
		var request admin.LoginRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			s.DebugContext(r.Context(), "decode http request", "error", err)
			s.InvalidJSON(w)
			return
		}

		request = request.Normalize()

		if invalidFields := request.Validate(); len(invalidFields) != 0 {
			s.DebugContext(r.Context(), "invalid req", "fields", invalidFields)
			s.ValidationFailed(w, invalidFields)
			return
		}

		emailAddress := string(request.EmailAddress)

		// Sleep for random time to prevent timing attacks
		time.Sleep(time.Duration(mrand.IntN(5)) * time.Second)

		adminUser, err := s.Queries.GetAdminUserForLogin(
			r.Context(), emailAddress)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.DebugContext(r.Context(), "user not found")
				s.Unauthorized(w)
				return
			}
			s.ErrorContext(r.Context(), "get admin user", "error", err)
			s.InternalError(w)
			return
		}

		if bcrypt.CompareHashAndPassword(
			[]byte(adminUser.PasswordHash),
			[]byte(request.Password),
		) != nil {
			s.DebugContext(r.Context(), "invalid password")
			s.Unauthorized(w)
			return
		}

		if adminUser.AdminUserState != sqlc.VetchiumAdminUserStateActive {
			s.DebugContext(r.Context(), "disabled user")
			w.WriteHeader(http.StatusForbidden)
			return
		}

		secret := make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			s.ErrorContext(r.Context(), "generate session token", "error", err)
			s.InternalError(w)
			return
		}
		// Only the hash of the token is stored, so a database disclosure does
		// not hand out usable sessions.
		token := base64.RawURLEncoding.EncodeToString(secret)
		tokenHash := sha256.Sum256([]byte(token))

		expiresAt := time.Now().UTC().Add(s.AdminSessionTTL)
		session, err := s.Queries.CreateAdminSession(r.Context(),
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
				// The account was active when its credentials were checked but
				// became unavailable before the session was created.
				s.DebugContext(r.Context(), "user disabled", "user", adminUser)
				w.WriteHeader(http.StatusForbidden)
				return
			}
			s.ErrorContext(r.Context(), "create admin session", "error", err)
			s.InternalError(w)
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
			s.ErrorContext(r.Context(), "json encode", "error", err)
			s.InternalError(w)
		}
	}
}
