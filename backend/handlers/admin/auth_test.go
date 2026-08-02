package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"backend/internal/adminapi"
	"backend/internal/auth"
	"backend/internal/db/sqlc"
	"backend/internal/httpx"
	"backend/internal/middleware"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	adminspec "github.com/vetchium/src/typespec/admin"
	"github.com/vetchium/src/typespec/problem"
	"golang.org/x/crypto/bcrypt"
)

type adminDBStub struct {
	createAdminSession         func(context.Context, sqlc.CreateAdminSessionParams) (sqlc.CreateAdminSessionRow, error)
	deleteAdminSession         func(context.Context, sqlc.DeleteAdminSessionParams) (int64, error)
	getAdminUserForLogin       func(context.Context, string) (sqlc.GetAdminUserForLoginRow, error)
	authenticateAdminSession   func(context.Context, []byte) (sqlc.AuthenticateAdminSessionRow, error)
	getAdminMyInfo             func(context.Context, sqlc.GetAdminMyInfoParams) (sqlc.GetAdminMyInfoRow, error)
	deleteExpiredAdminSessions func(context.Context) (int64, error)
}

func (s *adminDBStub) CreateAdminSession(ctx context.Context, arg sqlc.CreateAdminSessionParams) (sqlc.CreateAdminSessionRow, error) {
	return s.createAdminSession(ctx, arg)
}

func (s *adminDBStub) DeleteAdminSession(ctx context.Context, arg sqlc.DeleteAdminSessionParams) (int64, error) {
	return s.deleteAdminSession(ctx, arg)
}

func (s *adminDBStub) DeleteExpiredAdminSessions(ctx context.Context) (int64, error) {
	if s.deleteExpiredAdminSessions == nil {
		return 0, nil
	}
	return s.deleteExpiredAdminSessions(ctx)
}

func (s *adminDBStub) GetAdminUserForLogin(ctx context.Context, email string) (sqlc.GetAdminUserForLoginRow, error) {
	return s.getAdminUserForLogin(ctx, email)
}

func (s *adminDBStub) AuthenticateAdminSession(ctx context.Context, tokenHash []byte) (sqlc.AuthenticateAdminSessionRow, error) {
	return s.authenticateAdminSession(ctx, tokenHash)
}

func (s *adminDBStub) GetAdminMyInfo(ctx context.Context, arg sqlc.GetAdminMyInfoParams) (sqlc.GetAdminMyInfoRow, error) {
	return s.getAdminMyInfo(ctx, arg)
}

func TestLoginCreatesHashedSession(t *testing.T) {
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("correct horse battery staple"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	adminUserID := pgtype.UUID{Bytes: [16]byte{15: 1}, Valid: true}
	var storedHash []byte

	db := &adminDBStub{}
	db.getAdminUserForLogin = func(_ context.Context, email string) (sqlc.GetAdminUserForLoginRow, error) {
		if email != "admin@example.com" {
			t.Fatalf("normalized email = %q, want admin@example.com", email)
		}
		return sqlc.GetAdminUserForLoginRow{
			AdminUserID:    adminUserID,
			EmailAddress:   email,
			DisplayName:    "Test Admin",
			PasswordHash:   string(passwordHash),
			AdminUserState: sqlc.VetchiumAdminUserStateActive,
		}, nil
	}
	db.createAdminSession = func(_ context.Context, arg sqlc.CreateAdminSessionParams) (sqlc.CreateAdminSessionRow, error) {
		storedHash = append([]byte(nil), arg.SessionTokenHash...)
		if arg.AdminUserID != adminUserID {
			t.Fatalf("AdminUserID = %v, want %v", arg.AdminUserID, adminUserID)
		}
		if !arg.ExpiresAt.Valid || time.Until(arg.ExpiresAt.Time) < 23*time.Hour+59*time.Minute {
			t.Fatalf("ExpiresAt = %v, want approximately 24 hours", arg.ExpiresAt)
		}
		return sqlc.CreateAdminSessionRow{ExpiresAt: arg.ExpiresAt}, nil
	}

	s := testServer(db)
	request := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(`{
		"email_address":" ADMIN@example.com ",
		"password":"correct horse battery staple"
	}`))
	response := httptest.NewRecorder()
	Login(s).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", response.Code, response.Body.String())
	}
	var payload adminspec.LoginResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.SessionToken == "" {
		t.Fatal("session token is empty")
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	if !bytes.Equal(storedHash, auth.HashSessionToken(string(payload.SessionToken))) {
		t.Fatal("stored session hash does not match returned token")
	}
	if bytes.Equal(storedHash, []byte(payload.SessionToken)) {
		t.Fatal("plaintext token was stored")
	}
}

func TestLoginRejectsDisabledAdmin(t *testing.T) {
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	db := &adminDBStub{
		getAdminUserForLogin: func(context.Context, string) (sqlc.GetAdminUserForLoginRow, error) {
			return sqlc.GetAdminUserForLoginRow{
				PasswordHash:   string(passwordHash),
				AdminUserState: sqlc.VetchiumAdminUserStateDisabled,
			}, nil
		},
		createAdminSession: func(context.Context, sqlc.CreateAdminSessionParams) (sqlc.CreateAdminSessionRow, error) {
			t.Fatal("CreateAdminSession called for disabled user")
			return sqlc.CreateAdminSessionRow{}, nil
		},
	}
	request := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(`{
		"email_address":"admin@example.com",
		"password":"password"
	}`))
	response := httptest.NewRecorder()
	Login(testServer(db)).ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
	assertProblem(t, response, http.StatusUnauthorized, problem.TypeInvalidCredentials, "Invalid credentials", "The email address or password is incorrect.")
}

func TestAuthenticatedMyInfoAndLogout(t *testing.T) {
	token := "presented-session-token"
	tokenHash := auth.HashSessionToken(token)
	adminUserID := pgtype.UUID{Bytes: [16]byte{15: 7}, Valid: true}
	adminSessionID := pgtype.UUID{Bytes: [16]byte{15: 8}, Valid: true}
	createdAt := time.Date(2026, time.August, 1, 10, 0, 0, 0, time.UTC)
	lastLoginAt := createdAt.Add(time.Hour)
	sessionExpiresAt := createdAt.Add(24 * time.Hour)
	deleted := false

	db := &adminDBStub{}
	db.authenticateAdminSession = func(_ context.Context, gotHash []byte) (sqlc.AuthenticateAdminSessionRow, error) {
		if !bytes.Equal(gotHash, tokenHash) {
			t.Fatalf("auth hash = %x, want %x", gotHash, tokenHash)
		}
		return sqlc.AuthenticateAdminSessionRow{
			AdminUserID:    adminUserID,
			AdminSessionID: adminSessionID,
		}, nil
	}
	db.getAdminMyInfo = func(_ context.Context, arg sqlc.GetAdminMyInfoParams) (sqlc.GetAdminMyInfoRow, error) {
		if arg.AdminUserID != adminUserID || arg.AdminSessionID != adminSessionID {
			t.Fatalf("my-info identity = %+v, want user %v session %v", arg, adminUserID, adminSessionID)
		}
		return sqlc.GetAdminMyInfoRow{
			AdminUserID:    adminUserID,
			EmailAddress:   "admin@example.com",
			DisplayName:    "Test Admin",
			AdminUserState: sqlc.VetchiumAdminUserStateActive,
			LastLoginAt:    pgtype.Timestamptz{Time: lastLoginAt, Valid: true},
			CreatedAt:      pgtype.Timestamptz{Time: createdAt, Valid: true},
			ExpiresAt:      pgtype.Timestamptz{Time: sessionExpiresAt, Valid: true},
		}, nil
	}
	db.deleteAdminSession = func(_ context.Context, arg sqlc.DeleteAdminSessionParams) (int64, error) {
		if arg.AdminUserID != adminUserID || arg.AdminSessionID != adminSessionID {
			t.Fatalf("deleted identity = %+v, want user %v session %v", arg, adminUserID, adminSessionID)
		}
		deleted = true
		return 1, nil
	}
	s := testServer(db)

	myInfo := middleware.AdminAuth(s)(MyInfo(s))
	request := httptest.NewRequest(http.MethodGet, "/api/admin/my-info", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	myInfo.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("my-info status = %d, want 200; body = %s", response.Code, response.Body.String())
	}
	var info adminspec.MyInfoResponse
	if err := json.NewDecoder(response.Body).Decode(&info); err != nil {
		t.Fatal(err)
	}
	if info.AdminUserID != adminUserID.String() || info.EmailAddress != "admin@example.com" || info.AdminUserState != "active" {
		t.Fatalf("my-info = %+v", info)
	}
	if info.TenantID != "test" || !info.SessionExpiresAt.Equal(sessionExpiresAt) {
		t.Fatalf("my-info metadata = %+v", info)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("my-info Cache-Control = %q, want no-store", got)
	}

	logout := middleware.AdminAuth(s)(Logout(s))
	request = httptest.NewRequest(http.MethodPost, "/api/admin/logout", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response = httptest.NewRecorder()
	logout.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("logout status = %d, want 204", response.Code)
	}
	if !deleted {
		t.Fatal("presented session was not deleted")
	}
}

func TestAdminAuthRequiresBearerToken(t *testing.T) {
	db := &adminDBStub{
		authenticateAdminSession: func(context.Context, []byte) (sqlc.AuthenticateAdminSessionRow, error) {
			t.Fatal("AuthenticateAdminSession called without bearer token")
			return sqlc.AuthenticateAdminSessionRow{}, nil
		},
	}
	handler := middleware.AdminAuth(testServer(db))(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("protected handler called")
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
	if response.Header().Get("WWW-Authenticate") == "" {
		t.Fatal("WWW-Authenticate header is empty")
	}
	assertProblem(t, response, http.StatusUnauthorized, problem.TypeAuthenticationRequired, "Authentication required", "A valid bearer token is required.")
}

func TestAdminAuthRejectsInvalidBearerToken(t *testing.T) {
	db := &adminDBStub{
		authenticateAdminSession: func(context.Context, []byte) (sqlc.AuthenticateAdminSessionRow, error) {
			return sqlc.AuthenticateAdminSessionRow{}, pgx.ErrNoRows
		},
	}
	handler := middleware.AdminAuth(testServer(db))(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("protected handler called")
	}))
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("Authorization", "Bearer invalid-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	assertProblem(t, response, http.StatusUnauthorized, problem.TypeInvalidSession, "Invalid session", "The bearer token is invalid or expired.")
}

func TestMyInfoRejectsSessionInvalidatedAfterAuthentication(t *testing.T) {
	adminUserID := pgtype.UUID{Bytes: [16]byte{15: 7}, Valid: true}
	adminSessionID := pgtype.UUID{Bytes: [16]byte{15: 8}, Valid: true}
	db := &adminDBStub{
		authenticateAdminSession: func(context.Context, []byte) (sqlc.AuthenticateAdminSessionRow, error) {
			return sqlc.AuthenticateAdminSessionRow{
				AdminUserID:    adminUserID,
				AdminSessionID: adminSessionID,
			}, nil
		},
		getAdminMyInfo: func(_ context.Context, arg sqlc.GetAdminMyInfoParams) (sqlc.GetAdminMyInfoRow, error) {
			if arg.AdminUserID != adminUserID || arg.AdminSessionID != adminSessionID {
				t.Fatalf("my-info identity = %+v, want user %v session %v", arg, adminUserID, adminSessionID)
			}
			return sqlc.GetAdminMyInfoRow{}, pgx.ErrNoRows
		},
	}

	s := testServer(db)
	handler := middleware.AdminAuth(s)(MyInfo(s))
	request := httptest.NewRequest(http.MethodGet, "/api/admin/my-info", nil)
	request.Header.Set("Authorization", "Bearer valid-then-invalidated")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	assertProblem(t, response, http.StatusUnauthorized, problem.TypeInvalidSession, "Invalid session", "The bearer token is invalid or expired.")
}

func TestLoginErrorsUseProblemDetails(t *testing.T) {
	t.Run("malformed request", func(t *testing.T) {
		response := httptest.NewRecorder()
		Login(testServer(&adminDBStub{})).ServeHTTP(response,
			httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(`{"email_address":`)))
		assertProblem(t, response, http.StatusBadRequest, problem.TypeMalformedRequestBody, "Malformed request body", "The request body must contain one valid JSON object with no unknown fields.")
	})

	t.Run("oversized request", func(t *testing.T) {
		body := `{"email_address":"admin@example.com","password":"` +
			strings.Repeat("x", httpx.MaxRequestBody) + `"}`
		response := httptest.NewRecorder()
		Login(testServer(&adminDBStub{})).ServeHTTP(response,
			httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(body)))
		assertProblem(t, response, http.StatusRequestEntityTooLarge, problem.TypeRequestBodyTooLarge, "Request body too large", "The request body exceeds the maximum size.")
	})

	t.Run("oversized trailing content", func(t *testing.T) {
		body := `{"email_address":"admin@example.com","password":"password"} "` +
			strings.Repeat("x", httpx.MaxRequestBody) + `"`
		response := httptest.NewRecorder()
		Login(testServer(&adminDBStub{})).ServeHTTP(response,
			httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(body)))
		assertProblem(t, response, http.StatusRequestEntityTooLarge, problem.TypeRequestBodyTooLarge, "Request body too large", "The request body exceeds the maximum size.")
	})

	t.Run("invalid login input", func(t *testing.T) {
		response := httptest.NewRecorder()
		Login(testServer(&adminDBStub{})).ServeHTTP(response,
			httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(`{
				"email_address":"not-an-email",
				"password":"password"
			}`)))
		assertProblem(t, response, http.StatusBadRequest, problem.TypeInvalidLoginInput, "Invalid login input", "email_address must be valid and password must not be empty.")
	})

	t.Run("unknown account and wrong password responses match", func(t *testing.T) {
		unknownAccountDB := &adminDBStub{
			getAdminUserForLogin: func(context.Context, string) (sqlc.GetAdminUserForLoginRow, error) {
				return sqlc.GetAdminUserForLoginRow{}, pgx.ErrNoRows
			},
		}
		unknownAccountRequest := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(`{
			"email_address":"missing@example.com",
			"password":"wrong"
		}`))
		unknownAccountResponse := httptest.NewRecorder()
		Login(testServer(unknownAccountDB)).ServeHTTP(unknownAccountResponse, unknownAccountRequest)
		unknownAccountBody := unknownAccountResponse.Body.String()
		unknownAccountChallenge := unknownAccountResponse.Header().Get("WWW-Authenticate")
		assertProblem(t, unknownAccountResponse, http.StatusUnauthorized, problem.TypeInvalidCredentials, "Invalid credentials", "The email address or password is incorrect.")

		passwordHash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
		if err != nil {
			t.Fatal(err)
		}
		wrongPasswordDB := &adminDBStub{
			getAdminUserForLogin: func(context.Context, string) (sqlc.GetAdminUserForLoginRow, error) {
				return sqlc.GetAdminUserForLoginRow{
					PasswordHash:   string(passwordHash),
					AdminUserState: sqlc.VetchiumAdminUserStateActive,
				}, nil
			},
		}
		wrongPasswordRequest := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(`{
			"email_address":"admin@example.com",
			"password":"wrong"
		}`))
		wrongPasswordResponse := httptest.NewRecorder()
		Login(testServer(wrongPasswordDB)).ServeHTTP(wrongPasswordResponse, wrongPasswordRequest)
		if wrongPasswordResponse.Body.String() != unknownAccountBody {
			t.Fatalf("wrong-password body %q differs from unknown-account body %q", wrongPasswordResponse.Body.String(), unknownAccountBody)
		}
		if wrongPasswordResponse.Header().Get("WWW-Authenticate") != unknownAccountChallenge {
			t.Fatal("wrong-password and unknown-account challenges differ")
		}
		assertProblem(t, wrongPasswordResponse, http.StatusUnauthorized, problem.TypeInvalidCredentials, "Invalid credentials", "The email address or password is incorrect.")
	})
}

func assertProblem(t *testing.T, response *httptest.ResponseRecorder, status int, typeURI, title, detail string) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, status, response.Body.String())
	}
	if got := response.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Fatalf("Content-Type = %q, want application/problem+json", got)
	}
	if status == http.StatusUnauthorized {
		if got := response.Header().Get("WWW-Authenticate"); got != `Bearer realm="vetchium-admin"` {
			t.Fatalf("WWW-Authenticate = %q", got)
		}
	}
	var details problem.Details
	if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	if details.Type != typeURI || details.Title != title || details.Status != status || details.Detail != detail {
		t.Fatalf("problem = %+v", details)
	}
}

func testServer(db sqlc.Querier) *adminapi.Server {
	return &adminapi.Server{
		TenantID:        "test",
		Queries:         db,
		AdminSessionTTL: 24 * time.Hour,
		Log:             slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}
