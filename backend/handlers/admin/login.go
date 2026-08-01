package admin

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"backend/internal/auth"
	"backend/internal/db/sqlc"
	"backend/internal/server"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

const (
	maxLoginBodyBytes = 1 << 20
	dummyPasswordHash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
)

type loginRequest struct {
	EmailAddress string `json:"email_address"`
	Password     string `json:"password"`
}

type loginResponse struct {
	SessionToken string    `json:"session_token"`
	ExpiresAt    time.Time `json:"expires_at"`
}

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
				_ = bcrypt.CompareHashAndPassword([]byte(dummyPasswordHash), []byte(request.Password))
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.ErrorContext(r.Context(), "get admin user for login", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		passwordMatches := bcrypt.CompareHashAndPassword([]byte(adminUser.PasswordHash), []byte(request.Password)) == nil
		if !passwordMatches || adminUser.AdminUserState != sqlc.VetchiumAdminUserStateActive {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		token, tokenHash, err := auth.NewSessionToken()
		if err != nil {
			log.ErrorContext(r.Context(), "generate admin session token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
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
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			log.ErrorContext(r.Context(), "create admin session", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if session.ExpiresAt.Valid {
			expiresAt = session.ExpiresAt.Time
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(loginResponse{SessionToken: token, ExpiresAt: expiresAt}); err != nil {
			log.ErrorContext(r.Context(), "encode admin login response", "error", err)
		}
	}
}

func decodeLoginRequest(w http.ResponseWriter, r *http.Request) (loginRequest, bool) {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxLoginBodyBytes))
	decoder.DisallowUnknownFields()
	var request loginRequest
	if err := decoder.Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return loginRequest{}, false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		http.Error(w, "request body must contain one JSON object", http.StatusBadRequest)
		return loginRequest{}, false
	}

	request.EmailAddress = strings.ToLower(strings.TrimSpace(request.EmailAddress))
	parsedEmail, err := mail.ParseAddress(request.EmailAddress)
	if err != nil || parsedEmail.Address != request.EmailAddress || request.Password == "" {
		http.Error(w, "invalid email_address or password", http.StatusBadRequest)
		return loginRequest{}, false
	}
	return request, true
}

func adminLogger(s *server.Server) *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}
