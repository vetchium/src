package admin

import (
	"crypto/rand"
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"backend/internal/auth"
	"backend/internal/db/sqlc"
	"backend/internal/httpx"
	"backend/internal/server"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

type loginRequest struct {
	EmailAddress string `json:"email_address"`
	Password     string `json:"password"`
}

type loginResponse struct {
	SessionToken string    `json:"session_token"`
	ExpiresAt    time.Time `json:"expires_at"`
}

const (
	problemTypeMalformedRequest   = "urn:vetchium:problem:malformed-request-body"
	problemTypeRequestTooLarge    = "urn:vetchium:problem:request-body-too-large"
	problemTypeInvalidLoginInput  = "urn:vetchium:problem:invalid-login-input"
	problemTypeInvalidCredentials = "urn:vetchium:problem:invalid-credentials"
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

func Login(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log := adminLogger(s)
		request, ok := decodeLoginRequest(w, r)
		if !ok {
			return
		}

		adminUser, err := s.AdminDB.GetAdminUserForLogin(r.Context(), request.EmailAddress)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				_ = bcrypt.CompareHashAndPassword(decoyPasswordHash, []byte(request.Password))
				writeInvalidCredentials(w)
				return
			}
			log.ErrorContext(r.Context(), "get admin user for login", "error", err)
			httpx.WriteProblem(w, http.StatusInternalServerError, "The request could not be completed.")
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
			httpx.WriteProblem(w, http.StatusInternalServerError, "The request could not be completed.")
			return
		}
		expiresAt := time.Now().UTC().Add(s.AdminSessionTTL)
		session, err := s.AdminDB.CreateAdminSession(r.Context(), sqlc.CreateAdminSessionParams{
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
			httpx.WriteProblem(w, http.StatusInternalServerError, "The request could not be completed.")
			return
		}
		if session.ExpiresAt.Valid {
			expiresAt = session.ExpiresAt.Time
		}

		w.Header().Set("Cache-Control", "no-store")
		if err := httpx.WriteJSON(w, http.StatusOK, loginResponse{SessionToken: token, ExpiresAt: expiresAt}); err != nil {
			log.ErrorContext(r.Context(), "encode admin login response", "error", err)
		}
	}
}

func decodeLoginRequest(w http.ResponseWriter, r *http.Request) (loginRequest, bool) {
	var request loginRequest
	if err := httpx.DecodeJSON(w, r, &request); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			httpx.WriteProblemType(w, http.StatusRequestEntityTooLarge, problemTypeRequestTooLarge, "Request body too large", "The request body exceeds the maximum size.")
			return loginRequest{}, false
		}
		httpx.WriteProblemType(w, http.StatusBadRequest, problemTypeMalformedRequest, "Malformed request body", "The request body must contain one valid JSON object with no unknown fields.")
		return loginRequest{}, false
	}

	request.EmailAddress = strings.ToLower(strings.TrimSpace(request.EmailAddress))
	parsedEmail, err := mail.ParseAddress(request.EmailAddress)
	if err != nil || parsedEmail.Address != request.EmailAddress || request.Password == "" {
		httpx.WriteProblemType(w, http.StatusBadRequest, problemTypeInvalidLoginInput, "Invalid login input", "email_address must be valid and password must not be empty.")
		return loginRequest{}, false
	}
	return request, true
}

func writeInvalidCredentials(w http.ResponseWriter) {
	httpx.WriteBearerProblem(w, auth.AdminBearerRealm, problemTypeInvalidCredentials, "Invalid credentials", "The email address or password is incorrect.")
}

func adminLogger(s *server.Server) *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}
