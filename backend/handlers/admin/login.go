package admin

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"slices"
	"sort"
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

const maxLoginRequestBody = 64 << 10

func Login(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
			s.ErrorContext(r.Context(), "get admin user for login", "error", err)
			w.Header().Set("Content-Type", problemspec.MediaType)
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(problemspec.InternalServerErrorBody))
			return
		}

		passwordMatches := bcrypt.CompareHashAndPassword([]byte(adminUser.PasswordHash), []byte(request.Password)) == nil
		if !passwordMatches {
			writeInvalidCredentials(w)
			return
		}
		if adminUser.AdminUserState != sqlc.VetchiumAdminUserStateActive {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		token, tokenHash, err := auth.NewSessionToken()
		if err != nil {
			s.ErrorContext(r.Context(), "generate admin session token", "error", err)
			w.Header().Set("Content-Type", problemspec.MediaType)
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(problemspec.InternalServerErrorBody))
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
			w.Header().Set("Content-Type", problemspec.MediaType)
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(problemspec.InternalServerErrorBody))
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

func decodeLoginRequest(w http.ResponseWriter, r *http.Request) (adminspec.LoginRequest, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxLoginRequestBody))
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			w.Header().Set("Content-Type", problemspec.MediaType)
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			_, _ = w.Write([]byte(problemspec.RequestBodyTooLargeBody))
			return adminspec.LoginRequest{}, false
		}
		w.Header().Set("Content-Type", problemspec.MediaType)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(problemspec.InvalidJSONBody))
		return adminspec.LoginRequest{}, false
	}
	if !json.Valid(body) {
		w.Header().Set("Content-Type", problemspec.MediaType)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(problemspec.InvalidJSONBody))
		return adminspec.LoginRequest{}, false
	}

	var members map[string]json.RawMessage
	validShape := json.Unmarshal(body, &members) == nil && members != nil
	var request adminspec.LoginRequest
	invalidFields := make([]string, 0, 2)
	if validShape {
		if value, exists := members["email_address"]; !exists || json.Unmarshal(value, &request.EmailAddress) != nil {
			invalidFields = append(invalidFields, "email_address")
		}
		if value, exists := members["password"]; !exists || json.Unmarshal(value, &request.Password) != nil {
			invalidFields = append(invalidFields, "password")
		}

		request = request.Normalized()
		for _, field := range request.InvalidFields() {
			if !slices.Contains(invalidFields, field) {
				invalidFields = append(invalidFields, field)
			}
		}

		unknownFields := make([]string, 0)
		for field := range members {
			if field != "email_address" && field != "password" {
				unknownFields = append(unknownFields, field)
			}
		}
		sort.Strings(unknownFields)
		invalidFields = append(invalidFields, unknownFields...)
	}

	if !validShape || len(invalidFields) != 0 {
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
		return adminspec.LoginRequest{}, false
	}
	return request, true
}

func writeInvalidCredentials(w http.ResponseWriter) {
	auth.Unauthorized(w, auth.LoginBearerRealm)
}
