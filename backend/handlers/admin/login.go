package admin

import (
	"crypto/rand"
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"backend/internal/adminapi"
	"backend/internal/auth"
	"backend/internal/db/sqlc"
	"backend/internal/httpx"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	adminspec "github.com/vetchium/src/typespec/admin"
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"
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
		log := adminLogger(s)
		request, ok := decodeLoginRequest(w, r)
		if !ok {
			return
		}

		adminUser, err := s.Queries.GetAdminUserForLogin(r.Context(), string(request.EmailAddress))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				_ = bcrypt.CompareHashAndPassword(decoyPasswordHash, []byte(request.Password))
				writeInvalidCredentials(w)
				return
			}
			log.ErrorContext(r.Context(), "get admin user for login", "error", err)
			httpx.WriteProblem(w, problem.NewInternalServerError())
			return
		}

		passwordMatches := bcrypt.CompareHashAndPassword([]byte(adminUser.PasswordHash), []byte(request.Password)) == nil
		if !passwordMatches || adminUser.AdminUserState != sqlc.VetchiumAdminUserStateActive {
			writeInvalidCredentials(w)
			return
		}

		token, tokenHash, err := auth.NewSessionToken()
		if err != nil {
			log.ErrorContext(r.Context(), "generate admin session token", "error", err)
			httpx.WriteProblem(w, problem.NewInternalServerError())
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
				writeInvalidCredentials(w)
				return
			}
			log.ErrorContext(r.Context(), "create admin session", "error", err)
			httpx.WriteProblem(w, problem.NewInternalServerError())
			return
		}
		if session.ExpiresAt.Valid {
			expiresAt = session.ExpiresAt.Time
		}

		w.Header().Set("Cache-Control", "no-store")
		if err := httpx.WriteJSON(w, http.StatusOK, adminspec.LoginResponse{SessionToken: adminspec.SessionToken(token), ExpiresAt: expiresAt}); err != nil {
			log.ErrorContext(r.Context(), "encode admin login response", "error", err)
		}
	}
}

func decodeLoginRequest(w http.ResponseWriter, r *http.Request) (adminspec.LoginRequest, bool) {
	var request adminspec.LoginRequest
	if err := httpx.DecodeJSON(w, r, &request); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			httpx.WriteProblem(w, problem.NewRequestBodyTooLarge())
			return adminspec.LoginRequest{}, false
		}
		httpx.WriteProblem(w, problem.NewMalformedRequestBody())
		return adminspec.LoginRequest{}, false
	}

	normalizedEmail := strings.ToLower(strings.TrimSpace(string(request.EmailAddress)))
	request.EmailAddress = common.EmailAddress(normalizedEmail)
	parsedEmail, err := mail.ParseAddress(normalizedEmail)
	if err != nil || parsedEmail.Address != normalizedEmail || request.Password == "" {
		httpx.WriteProblem(w, problem.NewInvalidLoginInput())
		return adminspec.LoginRequest{}, false
	}
	return request, true
}

func writeInvalidCredentials(w http.ResponseWriter) {
	httpx.WriteBearerProblem(w, auth.AdminBearerRealm, problem.NewInvalidCredentials())
}

func adminLogger(s *adminapi.Server) *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}
