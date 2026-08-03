package admin

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"backend/internal/adminapi"
	"backend/internal/auth"
	"backend/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	adminspec "github.com/vetchium/src/typespec/admin"
	problemspec "github.com/vetchium/src/typespec/problem"
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

		invalidFields := make([]string, 0, 2)
		emailAddress := strings.ToLower(strings.TrimSpace(string(request.EmailAddress)))
		parsedEmail, err := mail.ParseAddress(emailAddress)
		if err != nil || parsedEmail.Address != emailAddress {
			invalidFields = append(invalidFields, "email_address")
		}
		if request.Password == "" {
			invalidFields = append(invalidFields, "password")
		}
		if len(invalidFields) != 0 {
			w.Header().Set("Content-Type", problemspec.MediaType)
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(problemspec.InvalidRequestDetails{
				Details: problemspec.Details{
					Type:   problemspec.TypeInvalidRequest,
					Title:  problemspec.InvalidRequestTitle,
					Status: http.StatusBadRequest,
					Detail: problemspec.InvalidRequestDetail,
				},
				InvalidFields: invalidFields,
			})
			return
		}

		adminUser, err := s.Queries.GetAdminUserForLogin(r.Context(), emailAddress)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				_ = bcrypt.CompareHashAndPassword(decoyPasswordHash, []byte(request.Password))
				auth.Unauthorized(w)
				return
			}
			s.ErrorContext(r.Context(), "get admin user for login", "error", err)
			s.InternalError(w)
			return
		}

		passwordMatches := bcrypt.CompareHashAndPassword([]byte(adminUser.PasswordHash), []byte(request.Password)) == nil
		if !passwordMatches {
			auth.Unauthorized(w)
			return
		}
		if adminUser.AdminUserState != sqlc.VetchiumAdminUserStateActive {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		token, tokenHash, err := auth.NewSessionToken()
		if err != nil {
			s.ErrorContext(r.Context(), "generate admin session token", "error", err)
			s.InternalError(w)
			return
		}
		expiresAt := time.Now().UTC().Add(s.AdminSessionTTL)
		session, err := s.Queries.CreateAdminSession(r.Context(), sqlc.CreateAdminSessionParams{
			SessionTokenHash: tokenHash,
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
		if err := json.NewEncoder(w).Encode(adminspec.LoginResponse{SessionToken: adminspec.SessionToken(token), ExpiresAt: expiresAt}); err != nil {
			s.ErrorContext(r.Context(), "encode admin login response", "error", err)
		}
	}
}
