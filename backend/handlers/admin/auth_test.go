package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	adminauth "github.com/vetchium/src/typespec/admin/auth"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/adminapi"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
)

type adminDBStub struct {
	sqlc.Querier
	getAdminUserForLogin func(context.Context, string) (
		sqlc.GetAdminUserForLoginRow, error,
	)
	createAdminSession func(context.Context, sqlc.CreateAdminSessionParams) (
		sqlc.CreateAdminSessionRow, error,
	)
	createLoginChallenge func(
		context.Context, sqlc.CreateAdminLoginChallengeParams,
	) (sqlc.CreateAdminLoginChallengeRow, error)
	deleteSessionByToken func(context.Context, []byte) (int64, error)
}

func (s *adminDBStub) GetAdminUserForLogin(
	ctx context.Context, email string,
) (sqlc.GetAdminUserForLoginRow, error) {
	return s.getAdminUserForLogin(ctx, email)
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
	ctx context.Context, hash []byte,
) (int64, error) {
	return s.deleteSessionByToken(ctx, hash)
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
			EffectiveLanguage: "en-US",
			EffectiveTimezone: "Asia/Kolkata",
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
	if payload.AuthenticationState != "authenticated" ||
		len(payload.SessionToken) < 32 ||
		payload.EffectiveLanguage != "en-US" ||
		payload.EffectiveTimezone != "Asia/Kolkata" {
		t.Fatalf("response = %+v", payload)
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
			EffectiveLanguage: "de-DE",
			EffectiveTimezone: "Europe/Berlin",
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
	if payload.AuthenticationState != "totp_required" ||
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
		_ context.Context, hash []byte,
	) (int64, error) {
		if len(hash) != 32 {
			t.Fatalf("hash length = %d", len(hash))
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
