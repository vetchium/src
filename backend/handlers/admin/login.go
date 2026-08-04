package admin

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	adminspec "github.com/vetchium/src/typespec/admin"
	"golang.org/x/crypto/bcrypt"
)

// decoyPasswordHash makes an unknown email address perform the same bcrypt
// work as a known address. It is generated from random bytes once, so it cannot
// accidentally correspond to a useful password.
var decoyPasswordHash = func() []byte {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		panic("generate decoy password: " + err.Error())
	}
	hash, err := bcrypt.GenerateFromPassword(secret, bcrypt.DefaultCost)
	if err != nil {
		panic("hash decoy password: " + err.Error())
	}
	return hash
}()

func Login(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request adminspec.LoginRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			s.DebugContext(r.Context(), "decode admin login request", "error", err)
			s.MalformedJSON(w)
			return
		}

		if invalidFields := request.Validate(); len(invalidFields) != 0 {
			s.InvalidRequest(w, invalidFields)
			return
		}
		request = request.Normalize()
		emailAddress := string(request.EmailAddress)

		adminUser, err := s.Queries.GetAdminUserForLogin(r.Context(), emailAddress)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				_ = bcrypt.CompareHashAndPassword(decoyPasswordHash, []byte(request.Password))
				s.Unauthorized(w)
				return
			}
			s.ErrorContext(r.Context(), "get admin user for login", "error", err)
			s.InternalError(w)
			return
		}

		passwordMatches := bcrypt.CompareHashAndPassword([]byte(adminUser.PasswordHash), []byte(request.Password)) == nil
		if !passwordMatches {
			s.Unauthorized(w)
			return
		}
		if adminUser.AdminUserState != sqlc.VetchiumAdminUserStateActive {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		secret := make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			s.ErrorContext(r.Context(), "generate admin session token", "error", err)
			s.InternalError(w)
			return
		}
		// Only the hash of the token is stored, so a database disclosure does
		// not hand out usable sessions.
		token := base64.RawURLEncoding.EncodeToString(secret)
		tokenHash := sha256.Sum256([]byte(token))

		expiresAt := time.Now().UTC().Add(s.AdminSessionTTL)
		session, err := s.Queries.CreateAdminSession(r.Context(), sqlc.CreateAdminSessionParams{
			SessionTokenHash: tokenHash[:],
			AdminUserID:      adminUser.AdminUserID,
			ExpiresAt:        pgtype.Timestamptz{Time: expiresAt, Valid: true},
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// The account was active when its credentials were checked but
				// became unavailable before the session was created.
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
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(adminspec.LoginResponse{SessionToken: token, ExpiresAt: expiresAt}); err != nil {
			s.ErrorContext(r.Context(), "encode admin login response", "error", err)
		}
	}
}
