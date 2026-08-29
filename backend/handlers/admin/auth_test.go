package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	adminauth "github.com/vetchium/src/typespec/admin/auth"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/adminapi"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
)

type adminDBStub struct {
	sqlc.Querier
	authenticateSession func(context.Context, []byte) (
		sqlc.AuthenticateAdminSessionRow, error,
	)
	getAdminUserForLogin func(context.Context, string) (
		sqlc.GetAdminUserForLoginRow, error,
	)
	getPasswordForReauthentication func(
		context.Context, sqlc.GetAdminPasswordForReauthenticationParams,
	) (string, error)
	reauthenticateSession func(
		context.Context, sqlc.ReauthenticateAdminSessionParams,
	) (pgtype.Timestamptz, error)
	createAdminSession func(context.Context, sqlc.CreateAdminSessionParams) (
		sqlc.CreateAdminSessionRow, error,
	)
	createLoginChallenge func(
		context.Context, sqlc.CreateAdminLoginChallengeParams,
	) (sqlc.CreateAdminLoginChallengeRow, error)
	deleteSessionByToken func(
		context.Context, sqlc.DeleteAdminSessionByTokenHashParams,
	) (int64, error)
}

func (s *adminDBStub) AuthenticateAdminSession(
	ctx context.Context, tokenHash []byte,
) (sqlc.AuthenticateAdminSessionRow, error) {
	return s.authenticateSession(ctx, tokenHash)
}

func (s *adminDBStub) GetAdminUserForLogin(
	ctx context.Context, email string,
) (sqlc.GetAdminUserForLoginRow, error) {
	return s.getAdminUserForLogin(ctx, email)
}

func (s *adminDBStub) GetAdminPasswordForReauthentication(
	ctx context.Context, arg sqlc.GetAdminPasswordForReauthenticationParams,
) (string, error) {
	return s.getPasswordForReauthentication(ctx, arg)
}

func (s *adminDBStub) ReauthenticateAdminSession(
	ctx context.Context, arg sqlc.ReauthenticateAdminSessionParams,
) (pgtype.Timestamptz, error) {
	return s.reauthenticateSession(ctx, arg)
}

func (s *adminDBStub) CreateAdminSession(
	ctx context.Context, arg sqlc.CreateAdminSessionParams,
) (sqlc.CreateAdminSessionRow, error) {
	return s.createAdminSession(ctx, arg)
}

func (s *adminDBStub) CreateAdminLoginChallenge(
	ctx context.Context, arg sqlc.CreateAdminLoginChallengeParams,
) (sqlc.CreateAdminLoginChallengeRow, error) {
	return s.createLoginChallenge(ctx, arg)
}

func (s *adminDBStub) DeleteAdminSessionByTokenHash(
	ctx context.Context, params sqlc.DeleteAdminSessionByTokenHashParams,
) (int64, error) {
	return s.deleteSessionByToken(ctx, params)
}

func TestLoginPasswordOnly(t *testing.T) {
	now := time.Date(2026, 8, 9, 10, 0, 0, 0, time.UTC)
	passwordHash, err := adminapi.HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	userID := testUUID(1)
	db := &adminDBStub{}
	db.getAdminUserForLogin = func(
		_ context.Context, email string,
	) (sqlc.GetAdminUserForLoginRow, error) {
		if email != "admin@example.com" {
			t.Fatalf("normalized email = %q", email)
		}
		return sqlc.GetAdminUserForLoginRow{
			AdminUserID:       userID,
			PasswordHash:      passwordHash,
			AdminUserState:    sqlc.VetchiumAdminUserStateActive,
			PreferredLanguage: "en-US",
		}, nil
	}
	db.createAdminSession = func(
		_ context.Context, arg sqlc.CreateAdminSessionParams,
	) (sqlc.CreateAdminSessionRow, error) {
		if arg.AdminUserID != userID || len(arg.SessionTokenHash) != 32 ||
			arg.VerifiedPasswordHash != passwordHash {
			t.Fatalf("session params = %+v", arg)
		}
		return sqlc.CreateAdminSessionRow{ExpiresAt: arg.ExpiresAt}, nil
	}

	response := performJSONRequest(
		t, Login(testAdminServer(db, now)), "/api/admin/login",
		`{"email_address":" ADMIN@example.com ",`+
			`"password":"correct horse battery staple"}`,
	)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload adminauth.LoginAuthenticatedResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	wantState := adminauth.AuthenticationStateAuthenticated
	if payload.AuthenticationState != wantState ||
		len(payload.SessionToken) < 32 ||
		payload.PreferredLanguage != "en-US" {
		t.Fatalf("response = %+v", payload)
	}
}

func TestReauthenticateRefreshesCurrentSession(t *testing.T) {
	now := time.Date(2026, 8, 15, 12, 0, 0, 0, time.UTC)
	passwordHash, err := adminapi.HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	userID := testUUID(10)
	sessionID := testUUID(11)
	db := &adminDBStub{}
	db.authenticateSession = func(
		_ context.Context, tokenHash []byte,
	) (sqlc.AuthenticateAdminSessionRow, error) {
		if len(tokenHash) != 32 {
			t.Fatalf("token hash length = %d", len(tokenHash))
		}
		return sqlc.AuthenticateAdminSessionRow{
			AdminUserID: userID, AdminSessionID: sessionID,
			AuthenticatedAt: adminapi.Timestamp(now.Add(-10 * time.Minute)),
			Permissions:     []string{},
		}, nil
	}
	db.getPasswordForReauthentication = func(
		_ context.Context, arg sqlc.GetAdminPasswordForReauthenticationParams,
	) (string, error) {
		if arg.AdminUserID != userID || arg.AdminSessionID != sessionID {
			t.Fatalf("password lookup params = %+v", arg)
		}
		return passwordHash, nil
	}
	db.reauthenticateSession = func(
		_ context.Context, arg sqlc.ReauthenticateAdminSessionParams,
	) (pgtype.Timestamptz, error) {
		if arg.AdminUserID != userID || arg.AdminSessionID != sessionID ||
			arg.VerifiedPasswordHash != passwordHash {
			t.Fatalf("reauthentication params = %+v", arg)
		}
		return adminapi.Timestamp(now), nil
	}

	server := testAdminServer(db, now)
	handler := middleware.AdminAuth(server)(Reauthenticate(server))
	request := httptest.NewRequest(
		http.MethodPost, "/api/admin/reauthenticate",
		bytes.NewBufferString(`{"password":"correct horse battery staple"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer current-session")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload adminauth.ReauthenticateResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.SessionAuthenticatedAt != now {
		t.Fatalf("authenticated at = %v, want %v", payload.SessionAuthenticatedAt, now)
	}
}

func TestReauthenticateRequiresCurrentSession(t *testing.T) {
	db := &adminDBStub{}
	db.authenticateSession = func(
		context.Context, []byte,
	) (sqlc.AuthenticateAdminSessionRow, error) {
		return sqlc.AuthenticateAdminSessionRow{}, pgx.ErrNoRows
	}
	server := testAdminServer(db, time.Now())
	handler := middleware.AdminAuth(server)(Reauthenticate(server))

	for _, authorization := range []string{
		"", "Basic credentials", "Bearer unknown-session",
	} {
		request := httptest.NewRequest(
			http.MethodPost, "/api/admin/reauthenticate",
			bytes.NewBufferString(`{"password":"password"}`),
		)
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", authorization)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)

		assertProblemResponse(
			t, response, http.StatusUnauthorized,
			"vetchium-problem-details/admin-authentication-required", nil,
		)
		challenge := response.Header().Get("WWW-Authenticate")
		if challenge != adminapi.BearerChallenge {
			t.Fatalf("WWW-Authenticate = %q", challenge)
		}
	}
}

func TestReauthenticateFailureResponses(t *testing.T) {
	now := time.Date(2026, 8, 15, 12, 0, 0, 0, time.UTC)
	passwordHash, err := adminapi.HashPassword("correct password")
	if err != nil {
		t.Fatal(err)
	}
	databaseError := errors.New("database unavailable")
	tests := []struct {
		name              string
		body              string
		passwordHash      string
		passwordError     error
		reauthenticateErr error
		status            int
		problemType       string
		fields            []string
	}{
		{
			name: "malformed JSON", body: `{`,
			status:      http.StatusBadRequest,
			problemType: "vetchium-problem-details/invalid-json",
		},
		{
			name: "empty password", body: `{"password":""}`,
			status:      http.StatusBadRequest,
			problemType: "vetchium-problem-details/validation-failed",
			fields:      []string{"password"},
		},
		{
			name:          "account or session is no longer eligible",
			body:          `{"password":"correct password"}`,
			passwordError: pgx.ErrNoRows,
			status:        http.StatusUnprocessableEntity,
			problemType:   "vetchium-problem-details/incorrect-password",
		},
		{
			name:         "incorrect password",
			body:         `{"password":"incorrect password"}`,
			passwordHash: passwordHash,
			status:       http.StatusUnprocessableEntity,
			problemType:  "vetchium-problem-details/incorrect-password",
		},
		{
			name:              "session changes after password verification",
			body:              `{"password":"correct password"}`,
			passwordHash:      passwordHash,
			reauthenticateErr: pgx.ErrNoRows,
			status:            http.StatusUnprocessableEntity,
			problemType:       "vetchium-problem-details/incorrect-password",
		},
		{
			name:          "password lookup dependency failure",
			body:          `{"password":"correct password"}`,
			passwordError: databaseError,
			status:        http.StatusInternalServerError,
			problemType:   "vetchium-problem-details/internal-server-error",
		},
		{
			name:         "invalid stored password hash",
			body:         `{"password":"correct password"}`,
			passwordHash: "not-a-password-hash",
			status:       http.StatusInternalServerError,
			problemType:  "vetchium-problem-details/internal-server-error",
		},
		{
			name:              "session update dependency failure",
			body:              `{"password":"correct password"}`,
			passwordHash:      passwordHash,
			reauthenticateErr: databaseError,
			status:            http.StatusInternalServerError,
			problemType:       "vetchium-problem-details/internal-server-error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := &adminDBStub{}
			db.authenticateSession = func(
				context.Context, []byte,
			) (sqlc.AuthenticateAdminSessionRow, error) {
				return sqlc.AuthenticateAdminSessionRow{
					AdminUserID:     testUUID(10),
					AdminSessionID:  testUUID(11),
					AuthenticatedAt: adminapi.Timestamp(now),
					Permissions:     []string{},
				}, nil
			}
			db.getPasswordForReauthentication = func(
				context.Context,
				sqlc.GetAdminPasswordForReauthenticationParams,
			) (string, error) {
				return tt.passwordHash, tt.passwordError
			}
			db.reauthenticateSession = func(
				context.Context, sqlc.ReauthenticateAdminSessionParams,
			) (pgtype.Timestamptz, error) {
				return pgtype.Timestamptz{}, tt.reauthenticateErr
			}
			request := httptest.NewRequest(
				http.MethodPost, "/api/admin/reauthenticate",
				bytes.NewBufferString(tt.body),
			)
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Authorization", "Bearer current-session")
			response := httptest.NewRecorder()
			server := testAdminServer(db, now)
			handler := middleware.AdminAuth(server)(Reauthenticate(server))
			handler.ServeHTTP(response, request)

			assertProblemResponse(
				t, response, tt.status, tt.problemType, tt.fields,
			)
		})
	}
}

func assertProblemResponse(
	t *testing.T,
	response *httptest.ResponseRecorder,
	status int,
	problemType string,
	fields []string,
) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	contentType := response.Header().Get("Content-Type")
	if contentType != problem.MediaType {
		t.Fatalf("Content-Type = %q", contentType)
	}
	var details problem.Details
	if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	if details.Type != problemType || details.Status != status {
		t.Fatalf("problem = %+v", details)
	}
	if fields != nil && !slices.Equal(details.Fields, fields) {
		t.Fatalf("fields = %v, want %v", details.Fields, fields)
	}
}

func TestLoginWithTOTPReturnsChallenge(t *testing.T) {
	now := time.Date(2026, 8, 9, 10, 0, 0, 0, time.UTC)
	passwordHash, err := adminapi.HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	db := &adminDBStub{}
	db.getAdminUserForLogin = func(
		context.Context, string,
	) (sqlc.GetAdminUserForLoginRow, error) {
		return sqlc.GetAdminUserForLoginRow{
			AdminUserID:       testUUID(2),
			PasswordHash:      passwordHash,
			AdminUserState:    sqlc.VetchiumAdminUserStateActive,
			TotpEnabled:       true,
			PreferredLanguage: "de-DE",
		}, nil
	}
	db.createLoginChallenge = func(
		_ context.Context, arg sqlc.CreateAdminLoginChallengeParams,
	) (sqlc.CreateAdminLoginChallengeRow, error) {
		if arg.VerifiedPasswordHash != passwordHash {
			t.Fatalf("verified password hash = %q", arg.VerifiedPasswordHash)
		}
		return sqlc.CreateAdminLoginChallengeRow{ExpiresAt: arg.ExpiresAt}, nil
	}
	response := performJSONRequest(
		t, Login(testAdminServer(db, now)), "/api/admin/login",
		`{"email_address":"admin@example.com",`+
			`"password":"correct horse battery staple"}`,
	)
	var payload adminauth.LoginTOTPRequiredResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	wantState := adminauth.AuthenticationStateTOTPRequired
	if payload.AuthenticationState != wantState ||
		payload.LoginChallengeExpiresAt != now.Add(loginChallengeTTL) {
		t.Fatalf("response = %+v", payload)
	}
}

func TestLoginFailuresUseStableProblems(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		lookup      func(context.Context, string) (sqlc.GetAdminUserForLoginRow, error)
		status      int
		problemType string
		challenge   string
	}{
		{
			name: "malformed JSON", body: `{`,
			status:      http.StatusBadRequest,
			problemType: problem.InvalidJSONError.Type,
		},
		{
			name: "validation", body: `{"email_address":"bad","password":""}`,
			status:      http.StatusBadRequest,
			problemType: problem.ValidationFailedError.Type,
		},
		{
			name: "unknown account",
			body: `{"email_address":"none@example.com","password":"password"}`,
			lookup: func(context.Context, string) (sqlc.GetAdminUserForLoginRow, error) {
				return sqlc.GetAdminUserForLoginRow{}, pgx.ErrNoRows
			},
			status:      http.StatusUnauthorized,
			problemType: "vetchium-problem-details/invalid-credentials",
			challenge:   adminapi.LoginChallenge,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := &adminDBStub{getAdminUserForLogin: tt.lookup}
			response := performJSONRequest(
				t, Login(testAdminServer(db, time.Now())),
				"/api/admin/login", tt.body,
			)
			if response.Code != tt.status {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
			var details problem.Details
			if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
				t.Fatal(err)
			}
			if details.Type != tt.problemType {
				t.Fatalf("problem = %+v", details)
			}
			challenge := response.Header().Get("WWW-Authenticate")
			if challenge != tt.challenge {
				t.Fatalf(
					"WWW-Authenticate = %q, want %q",
					challenge, tt.challenge,
				)
			}
		})
	}
}

func TestLogoutIsAnonymousAndIdempotent(t *testing.T) {
	db := &adminDBStub{deleteSessionByToken: func(
		_ context.Context, params sqlc.DeleteAdminSessionByTokenHashParams,
	) (int64, error) {
		if len(params.SessionTokenHash) != 32 {
			t.Fatalf("hash length = %d", len(params.SessionTokenHash))
		}
		if params.TenantID != "test" {
			t.Fatalf("tenant ID = %q", params.TenantID)
		}
		return 0, nil
	}}
	handler := Logout(testAdminServer(db, time.Now()))
	for _, authorization := range []string{"", "malformed", "Bearer revoked-token"} {
		request := httptest.NewRequest(http.MethodPost, "/api/admin/logout", nil)
		request.Header.Set("Authorization", authorization)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusNoContent || response.Body.Len() != 0 {
			t.Fatalf("authorization %q: status=%d body=%q", authorization,
				response.Code, response.Body.String())
		}
	}
}

func performJSONRequest(
	t *testing.T, handler http.Handler, path, body string,
) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func testAdminServer(db sqlc.Querier, now time.Time) *adminapi.Server {
	return &adminapi.Server{
		Runtime: apiserver.New(
			nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
		),
		Queries: db, TenantID: "test", AdminSessionTTL: time.Hour,
		CredentialKey: adminapi.DeriveCredentialKey("test", "secret"),
		Now:           func() time.Time { return now },
	}
}

func testUUID(last byte) pgtype.UUID {
	value := [16]byte{15: last}
	return pgtype.UUID{Bytes: value, Valid: true}
}
