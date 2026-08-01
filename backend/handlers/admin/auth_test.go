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

	"backend/internal/auth"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
	"backend/internal/server"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

type adminDBStub struct {
	createAdminSession         func(context.Context, sqlc.CreateAdminSessionParams) (sqlc.CreateAdminSessionRow, error)
	deleteAdminSession         func(context.Context, []byte) (int64, error)
	getAdminUserForLogin       func(context.Context, string) (sqlc.GetAdminUserForLoginRow, error)
	getAuthenticatedAdmin      func(context.Context, []byte) (sqlc.GetAuthenticatedAdminRow, error)
	deleteExpiredAdminSessions func(context.Context) (int64, error)
}

func (s *adminDBStub) CreateAdminSession(ctx context.Context, arg sqlc.CreateAdminSessionParams) (sqlc.CreateAdminSessionRow, error) {
	return s.createAdminSession(ctx, arg)
}

func (s *adminDBStub) DeleteAdminSession(ctx context.Context, tokenHash []byte) (int64, error) {
	return s.deleteAdminSession(ctx, tokenHash)
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

func (s *adminDBStub) GetAuthenticatedAdmin(ctx context.Context, tokenHash []byte) (sqlc.GetAuthenticatedAdminRow, error) {
	return s.getAuthenticatedAdmin(ctx, tokenHash)
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
	var payload loginResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.SessionToken == "" {
		t.Fatal("session token is empty")
	}
	if !bytes.Equal(storedHash, auth.HashSessionToken(payload.SessionToken)) {
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
}

func TestAuthenticatedMyInfoAndLogout(t *testing.T) {
	token := "presented-session-token"
	tokenHash := auth.HashSessionToken(token)
	adminUserID := pgtype.UUID{Bytes: [16]byte{15: 7}, Valid: true}
	createdAt := time.Date(2026, time.August, 1, 10, 0, 0, 0, time.UTC)
	lastLoginAt := createdAt.Add(time.Hour)
	deleted := false

	db := &adminDBStub{}
	db.getAuthenticatedAdmin = func(_ context.Context, gotHash []byte) (sqlc.GetAuthenticatedAdminRow, error) {
		if !bytes.Equal(gotHash, tokenHash) {
			t.Fatalf("auth hash = %x, want %x", gotHash, tokenHash)
		}
		return sqlc.GetAuthenticatedAdminRow{
			AdminUserID:      adminUserID,
			EmailAddress:     "admin@example.com",
			DisplayName:      "Test Admin",
			AdminUserState:   sqlc.VetchiumAdminUserStateActive,
			LastLoginAt:      pgtype.Timestamptz{Time: lastLoginAt, Valid: true},
			CreatedAt:        pgtype.Timestamptz{Time: createdAt, Valid: true},
			SessionTokenHash: append([]byte(nil), tokenHash...),
		}, nil
	}
	db.deleteAdminSession = func(_ context.Context, gotHash []byte) (int64, error) {
		if !bytes.Equal(gotHash, tokenHash) {
			t.Fatalf("deleted hash = %x, want %x", gotHash, tokenHash)
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
	var info myInfoResponse
	if err := json.NewDecoder(response.Body).Decode(&info); err != nil {
		t.Fatal(err)
	}
	if info.AdminUserID != adminUserID.String() || info.EmailAddress != "admin@example.com" || info.AdminUserState != "active" {
		t.Fatalf("my-info = %+v", info)
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
		getAuthenticatedAdmin: func(context.Context, []byte) (sqlc.GetAuthenticatedAdminRow, error) {
			t.Fatal("GetAuthenticatedAdmin called without bearer token")
			return sqlc.GetAuthenticatedAdminRow{}, nil
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
}

func testServer(db sqlc.Querier) *server.Server {
	return &server.Server{
		AdminDB:         db,
		AdminSessionTTL: 24 * time.Hour,
		Log:             slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}
