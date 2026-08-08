package admin

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	adminspec "github.com/vetchium/src/typespec/admin"
	adminuser "github.com/vetchium/src/typespec/admin/user"
	"github.com/vetchium/src/typespec/problem"

	"golang.org/x/crypto/bcrypt"

	"backend/internal/adminapi"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
)

type adminDBStub struct {
	createAdminSession         createAdminSessionFunc
	deleteAdminSession         deleteAdminSessionFunc
	getAdminUserForLogin       getAdminUserForLoginFunc
	authenticateAdminSession   authenticateAdminSessionFunc
	getAdminMyInfo             getAdminMyInfoFunc
	deleteExpiredAdminSessions func(context.Context) (int64, error)
}

type createAdminSessionFunc func(
	context.Context,
	sqlc.CreateAdminSessionParams,
) (sqlc.CreateAdminSessionRow, error)

type deleteAdminSessionFunc func(
	context.Context,
	sqlc.DeleteAdminSessionParams,
) (int64, error)

type getAdminUserForLoginFunc func(
	context.Context,
	string,
) (sqlc.GetAdminUserForLoginRow, error)

type authenticateAdminSessionFunc func(
	context.Context,
	[]byte,
) (sqlc.AuthenticateAdminSessionRow, error)

type getAdminMyInfoFunc func(
	context.Context,
	sqlc.GetAdminMyInfoParams,
) (sqlc.GetAdminMyInfoRow, error)

func (s *adminDBStub) CreateAdminSession(
	ctx context.Context,
	arg sqlc.CreateAdminSessionParams,
) (sqlc.CreateAdminSessionRow, error) {
	return s.createAdminSession(ctx, arg)
}

func (s *adminDBStub) DeleteAdminSession(
	ctx context.Context,
	arg sqlc.DeleteAdminSessionParams,
) (int64, error) {
	return s.deleteAdminSession(ctx, arg)
}

func (s *adminDBStub) DeleteExpiredAdminSessions(
	ctx context.Context,
) (int64, error) {
	if s.deleteExpiredAdminSessions == nil {
		return 0, nil
	}
	return s.deleteExpiredAdminSessions(ctx)
}

func (s *adminDBStub) GetAdminUserForLogin(
	ctx context.Context,
	email string,
) (sqlc.GetAdminUserForLoginRow, error) {
	return s.getAdminUserForLogin(ctx, email)
}

func (s *adminDBStub) AuthenticateAdminSession(
	ctx context.Context,
	tokenHash []byte,
) (sqlc.AuthenticateAdminSessionRow, error) {
	return s.authenticateAdminSession(ctx, tokenHash)
}

func (s *adminDBStub) GetAdminMyInfo(
	ctx context.Context,
	arg sqlc.GetAdminMyInfoParams,
) (sqlc.GetAdminMyInfoRow, error) {
	return s.getAdminMyInfo(ctx, arg)
}

func TestLoginCreatesHashedSession(t *testing.T) {
	passwordHash, err := bcrypt.GenerateFromPassword(
		[]byte("correct horse battery staple"), bcrypt.MinCost,
	)
	if err != nil {
		t.Fatal(err)
	}
	adminUserID := pgtype.UUID{Bytes: [16]byte{15: 1}, Valid: true}
	var storedHash []byte

	db := &adminDBStub{}
	db.getAdminUserForLogin = func(
		_ context.Context,
		email string,
	) (sqlc.GetAdminUserForLoginRow, error) {
		if email != "admin@example.com" {
			t.Fatalf(
				"normalized email = %q, want admin@example.com", email,
			)
		}
		return sqlc.GetAdminUserForLoginRow{
			AdminUserID:    adminUserID,
			EmailAddress:   email,
			DisplayName:    "Test Admin",
			PasswordHash:   string(passwordHash),
			AdminUserState: sqlc.VetchiumAdminUserStateActive,
		}, nil
	}
	db.createAdminSession = func(
		_ context.Context,
		arg sqlc.CreateAdminSessionParams,
	) (sqlc.CreateAdminSessionRow, error) {
		storedHash = append([]byte(nil), arg.SessionTokenHash...)
		if arg.AdminUserID != adminUserID {
			t.Fatalf(
				"AdminUserID = %v, want %v", arg.AdminUserID, adminUserID,
			)
		}
		minimumTTL := 23*time.Hour + 59*time.Minute
		if !arg.ExpiresAt.Valid ||
			time.Until(arg.ExpiresAt.Time) < minimumTTL {
			t.Fatalf(
				"ExpiresAt = %v, want approximately 24 hours",
				arg.ExpiresAt,
			)
		}
		return sqlc.CreateAdminSessionRow{ExpiresAt: arg.ExpiresAt}, nil
	}

	s := testServer(db)
	requestBody := strings.NewReader(`{
		"email_address":" ADMIN@example.com ",
		"password":"correct horse battery staple"
	}`)
	request := httptest.NewRequest(
		http.MethodPost, "/api/admin/login", requestBody,
	)
	response := httptest.NewRecorder()
	Login(s).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf(
			"status = %d, want 200; body = %s",
			response.Code, response.Body.String(),
		)
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
	assertJSONHeaders(t, response)
	issuedHash := sha256.Sum256([]byte(payload.SessionToken))
	if !bytes.Equal(storedHash, issuedHash[:]) {
		t.Fatal("stored session hash does not match returned token")
	}
	if bytes.Equal(storedHash, []byte(payload.SessionToken)) {
		t.Fatal("plaintext token was stored")
	}
}

func TestLoginRejectsDisabledAdmin(t *testing.T) {
	passwordHash, err := bcrypt.GenerateFromPassword(
		[]byte("password"), bcrypt.MinCost,
	)
	if err != nil {
		t.Fatal(err)
	}
	db := &adminDBStub{
		getAdminUserForLogin: func(
			context.Context,
			string,
		) (sqlc.GetAdminUserForLoginRow, error) {
			return sqlc.GetAdminUserForLoginRow{
				PasswordHash:   string(passwordHash),
				AdminUserState: sqlc.VetchiumAdminUserStateDisabled,
			}, nil
		},
		createAdminSession: func(
			context.Context,
			sqlc.CreateAdminSessionParams,
		) (sqlc.CreateAdminSessionRow, error) {
			t.Fatal("CreateAdminSession called for disabled user")
			return sqlc.CreateAdminSessionRow{}, nil
		},
	}
	requestBody := strings.NewReader(`{
		"email_address":"admin@example.com",
		"password":"password"
	}`)
	request := httptest.NewRequest(
		http.MethodPost, "/api/admin/login", requestBody,
	)
	response := httptest.NewRecorder()
	Login(testServer(db)).ServeHTTP(response, request)
	assertEmptyResponse(t, response, http.StatusForbidden, "")
}

func TestLoginDoesNotRevealDisabledAccountForWrongPassword(t *testing.T) {
	passwordHash, err := bcrypt.GenerateFromPassword(
		[]byte("correct-password"), bcrypt.MinCost,
	)
	if err != nil {
		t.Fatal(err)
	}
	db := &adminDBStub{
		getAdminUserForLogin: func(
			context.Context,
			string,
		) (sqlc.GetAdminUserForLoginRow, error) {
			return sqlc.GetAdminUserForLoginRow{
				PasswordHash:   string(passwordHash),
				AdminUserState: sqlc.VetchiumAdminUserStateDisabled,
			}, nil
		},
	}
	requestBody := strings.NewReader(`{
		"email_address":"admin@example.com",
		"password":"wrong-password"
	}`)
	request := httptest.NewRequest(
		http.MethodPost, "/api/admin/login", requestBody,
	)
	response := httptest.NewRecorder()
	Login(testServer(db)).ServeHTTP(response, request)

	assertUnauthorized(t, response)
}

func TestAuthenticatedMyInfoAndLogout(t *testing.T) {
	token := "presented-session-token"
	tokenHash := sha256.Sum256([]byte(token))
	adminUserID := pgtype.UUID{Bytes: [16]byte{15: 7}, Valid: true}
	adminSessionID := pgtype.UUID{Bytes: [16]byte{15: 8}, Valid: true}
	createdAt := time.Date(2026, time.August, 1, 10, 0, 0, 0, time.UTC)
	lastLoginAt := createdAt.Add(time.Hour)
	sessionExpiresAt := createdAt.Add(24 * time.Hour)
	deleted := false

	db := &adminDBStub{}
	db.authenticateAdminSession = func(
		_ context.Context,
		gotHash []byte,
	) (sqlc.AuthenticateAdminSessionRow, error) {
		if !bytes.Equal(gotHash, tokenHash[:]) {
			t.Fatalf("auth hash = %x, want %x", gotHash, tokenHash)
		}
		return sqlc.AuthenticateAdminSessionRow{
			AdminUserID:    adminUserID,
			AdminSessionID: adminSessionID,
		}, nil
	}
	db.getAdminMyInfo = func(
		_ context.Context,
		arg sqlc.GetAdminMyInfoParams,
	) (sqlc.GetAdminMyInfoRow, error) {
		if arg.AdminUserID != adminUserID || arg.AdminSessionID != adminSessionID {
			t.Fatalf(
				"my-info identity = %+v, want user %v session %v",
				arg, adminUserID, adminSessionID,
			)
		}
		return sqlc.GetAdminMyInfoRow{
			AdminUserID:    adminUserID,
			EmailAddress:   "admin@example.com",
			DisplayName:    "Test Admin",
			AdminUserState: sqlc.VetchiumAdminUserStateActive,
			LastLoginAt: pgtype.Timestamptz{
				Time: lastLoginAt, Valid: true,
			},
			CreatedAt: pgtype.Timestamptz{
				Time: createdAt, Valid: true,
			},
			ExpiresAt: pgtype.Timestamptz{
				Time: sessionExpiresAt, Valid: true,
			},
		}, nil
	}
	db.deleteAdminSession = func(
		_ context.Context,
		arg sqlc.DeleteAdminSessionParams,
	) (int64, error) {
		if arg.AdminUserID != adminUserID || arg.AdminSessionID != adminSessionID {
			t.Fatalf(
				"deleted identity = %+v, want user %v session %v",
				arg, adminUserID, adminSessionID,
			)
		}
		deleted = true
		return 1, nil
	}
	s := testServer(db)

	myInfo := middleware.AdminAuth(s)(MyInfo(s))
	request := httptest.NewRequest(
		http.MethodGet, "/api/admin/my-info", nil,
	)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	myInfo.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf(
			"my-info status = %d, want 200; body = %s",
			response.Code, response.Body.String(),
		)
	}
	var info adminspec.MyInfoResponse
	if err := json.NewDecoder(response.Body).Decode(&info); err != nil {
		t.Fatal(err)
	}
	if info.AdminUserID != adminUserID.String() ||
		info.EmailAddress != "admin@example.com" ||
		info.AdminUserState != adminuser.Active {
		t.Fatalf("my-info = %+v", info)
	}
	if info.TenantID != "test" ||
		!info.SessionExpiresAt.Equal(sessionExpiresAt) {
		t.Fatalf("my-info metadata = %+v", info)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("my-info Cache-Control = %q, want no-store", got)
	}
	assertJSONHeaders(t, response)

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
	authorizations := []string{
		"", "token", "Basic token", "Bearer", "Bearer one two",
	}
	for _, authorization := range authorizations {
		t.Run(authorization, func(t *testing.T) {
			db := &adminDBStub{
				authenticateAdminSession: func(
					context.Context,
					[]byte,
				) (sqlc.AuthenticateAdminSessionRow, error) {
					t.Fatal(
						"AuthenticateAdminSession called without bearer token",
					)
					return sqlc.AuthenticateAdminSessionRow{}, nil
				},
			}
			protected := http.HandlerFunc(func(
				http.ResponseWriter, *http.Request,
			) {
				t.Fatal("protected handler called")
			})
			handler := middleware.AdminAuth(testServer(db))(protected)
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			if authorization != "" {
				request.Header.Set("Authorization", authorization)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			assertUnauthorized(t, response)
		})
	}
}

func TestAdminAuthAcceptsBearerHeaderVariants(t *testing.T) {
	authorizations := []string{
		"bearer presented-token",
		"  Bearer   presented-token  ",
	}
	for _, authorization := range authorizations {
		t.Run(authorization, func(t *testing.T) {
			wantHash := sha256.Sum256([]byte("presented-token"))
			db := &adminDBStub{
				authenticateAdminSession: func(
					_ context.Context,
					gotHash []byte,
				) (sqlc.AuthenticateAdminSessionRow, error) {
					if !bytes.Equal(gotHash, wantHash[:]) {
						t.Fatalf(
							"auth hash = %x, want %x", gotHash, wantHash,
						)
					}
					return sqlc.AuthenticateAdminSessionRow{}, nil
				},
			}
			authenticated := false
			protected := http.HandlerFunc(func(
				http.ResponseWriter, *http.Request,
			) {
				authenticated = true
			})
			handler := middleware.AdminAuth(testServer(db))(protected)
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.Header.Set("Authorization", authorization)
			handler.ServeHTTP(httptest.NewRecorder(), request)
			if !authenticated {
				t.Fatal("protected handler was not called")
			}
		})
	}
}

func TestAdminAuthRejectsInvalidBearerToken(t *testing.T) {
	db := &adminDBStub{
		authenticateAdminSession: func(
			context.Context,
			[]byte,
		) (sqlc.AuthenticateAdminSessionRow, error) {
			return sqlc.AuthenticateAdminSessionRow{}, pgx.ErrNoRows
		},
	}
	protected := http.HandlerFunc(func(
		http.ResponseWriter, *http.Request,
	) {
		t.Fatal("protected handler called")
	})
	handler := middleware.AdminAuth(testServer(db))(protected)
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("Authorization", "Bearer invalid-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	assertUnauthorized(t, response)
}

func TestMyInfoRejectsSessionInvalidatedAfterAuthentication(t *testing.T) {
	adminUserID := pgtype.UUID{Bytes: [16]byte{15: 7}, Valid: true}
	adminSessionID := pgtype.UUID{Bytes: [16]byte{15: 8}, Valid: true}
	db := &adminDBStub{
		authenticateAdminSession: func(
			context.Context,
			[]byte,
		) (sqlc.AuthenticateAdminSessionRow, error) {
			return sqlc.AuthenticateAdminSessionRow{
				AdminUserID:    adminUserID,
				AdminSessionID: adminSessionID,
			}, nil
		},
		getAdminMyInfo: func(
			_ context.Context,
			arg sqlc.GetAdminMyInfoParams,
		) (sqlc.GetAdminMyInfoRow, error) {
			if arg.AdminUserID != adminUserID || arg.AdminSessionID != adminSessionID {
				t.Fatalf(
					"my-info identity = %+v, want user %v session %v",
					arg, adminUserID, adminSessionID,
				)
			}
			return sqlc.GetAdminMyInfoRow{}, pgx.ErrNoRows
		},
	}

	s := testServer(db)
	handler := middleware.AdminAuth(s)(MyInfo(s))
	request := httptest.NewRequest(
		http.MethodGet, "/api/admin/my-info", nil,
	)
	request.Header.Set("Authorization", "Bearer valid-then-invalidated")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	assertUnauthorized(t, response)
}

func TestLoginErrorResponses(t *testing.T) {
	t.Run("invalid JSON", func(t *testing.T) {
		response := httptest.NewRecorder()
		requestBody := strings.NewReader(`{"email_address":`)
		request := httptest.NewRequest(
			http.MethodPost, "/api/admin/login", requestBody,
		)
		Login(testServer(&adminDBStub{})).ServeHTTP(response, request)
		assertProblem(t, response, problem.InvalidJSONError)
	})

	t.Run("invalid credentials fields", func(t *testing.T) {
		response := httptest.NewRecorder()
		requestBody := strings.NewReader(`{
				"email_address":"not-an-email",
				"password":""
			}`)
		request := httptest.NewRequest(
			http.MethodPost, "/api/admin/login", requestBody,
		)
		Login(testServer(&adminDBStub{})).ServeHTTP(response, request)
		assertValidationFailed(
			t, response, []string{"email_address", "password"},
		)
	})

	t.Run("wrong field types", func(t *testing.T) {
		response := httptest.NewRecorder()
		requestBody := strings.NewReader(`{
				"email_address": false,
				"password": []
			}`)
		request := httptest.NewRequest(
			http.MethodPost, "/api/admin/login", requestBody,
		)
		Login(testServer(&adminDBStub{})).ServeHTTP(response, request)
		assertProblem(t, response, problem.InvalidJSONError)
	})

	t.Run("invalid top-level shape", func(t *testing.T) {
		response := httptest.NewRecorder()
		requestBody := strings.NewReader(`[]`)
		request := httptest.NewRequest(
			http.MethodPost, "/api/admin/login", requestBody,
		)
		Login(testServer(&adminDBStub{})).ServeHTTP(response, request)
		assertProblem(t, response, problem.InvalidJSONError)
	})

	matchingResponses := "unknown account and wrong password responses match"
	t.Run(matchingResponses, func(t *testing.T) {
		unknownAccountDB := &adminDBStub{
			getAdminUserForLogin: func(
				context.Context,
				string,
			) (sqlc.GetAdminUserForLoginRow, error) {
				return sqlc.GetAdminUserForLoginRow{}, pgx.ErrNoRows
			},
		}
		unknownAccountBody := strings.NewReader(`{
			"email_address":"missing@example.com",
			"password":"wrong"
		}`)
		unknownAccountRequest := httptest.NewRequest(
			http.MethodPost, "/api/admin/login", unknownAccountBody,
		)
		unknownAccountResponse := httptest.NewRecorder()
		Login(testServer(unknownAccountDB)).ServeHTTP(
			unknownAccountResponse, unknownAccountRequest,
		)
		assertUnauthorized(t, unknownAccountResponse)

		passwordHash, err := bcrypt.GenerateFromPassword(
			[]byte("correct-password"), bcrypt.MinCost,
		)
		if err != nil {
			t.Fatal(err)
		}
		wrongPasswordDB := &adminDBStub{
			getAdminUserForLogin: func(
				context.Context,
				string,
			) (sqlc.GetAdminUserForLoginRow, error) {
				return sqlc.GetAdminUserForLoginRow{
					PasswordHash:   string(passwordHash),
					AdminUserState: sqlc.VetchiumAdminUserStateActive,
				}, nil
			},
		}
		wrongPasswordBody := strings.NewReader(`{
			"email_address":"admin@example.com",
			"password":"wrong"
		}`)
		wrongPasswordRequest := httptest.NewRequest(
			http.MethodPost, "/api/admin/login", wrongPasswordBody,
		)
		wrongPasswordResponse := httptest.NewRecorder()
		Login(testServer(wrongPasswordDB)).ServeHTTP(
			wrongPasswordResponse, wrongPasswordRequest,
		)
		assertUnauthorized(t, wrongPasswordResponse)
	})
}

func assertUnauthorized(
	t *testing.T,
	response *httptest.ResponseRecorder,
) {
	t.Helper()
	assertEmptyResponse(
		t, response, http.StatusUnauthorized, `Bearer realm="login"`,
	)
}

func assertEmptyResponse(
	t *testing.T,
	response *httptest.ResponseRecorder,
	status int,
	challenge string,
) {
	t.Helper()
	if response.Code != status {
		t.Fatalf(
			"status = %d, want %d; body = %s",
			response.Code, status, response.Body.String(),
		)
	}
	if got := response.Header().Get("WWW-Authenticate"); got != challenge {
		t.Fatalf("WWW-Authenticate = %q, want %q", got, challenge)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("body = %q, want empty", response.Body.String())
	}
	if got := response.Header().Get("Content-Type"); got != "" {
		t.Fatalf("Content-Type = %q, want empty", got)
	}
}

func assertProblem(
	t *testing.T,
	response *httptest.ResponseRecorder,
	want problem.Details,
) {
	t.Helper()
	if response.Code != want.Status {
		t.Fatalf(
			"status = %d, want %d; body = %s",
			response.Code, want.Status, response.Body.String(),
		)
	}
	gotContentType := response.Header().Get("Content-Type")
	if gotContentType != "application/problem+json" {
		t.Fatalf(
			"Content-Type = %q, want application/problem+json",
			gotContentType,
		)
	}
	var details problem.Details
	if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	if details.Type != want.Type || details.Title != want.Title ||
		details.Status != want.Status || details.Detail != want.Detail ||
		details.Instance != want.Instance ||
		!slices.Equal(details.Fields, want.Fields) {
		t.Fatalf("problem = %+v, want %+v", details, want)
	}
}

func assertValidationFailed(
	t *testing.T,
	response *httptest.ResponseRecorder,
	fields []string,
) {
	t.Helper()
	if response.Code != http.StatusBadRequest {
		t.Fatalf(
			"status = %d, want %d; body = %s",
			response.Code, http.StatusBadRequest,
			response.Body.String(),
		)
	}
	gotContentType := response.Header().Get("Content-Type")
	if gotContentType != "application/problem+json" {
		t.Fatalf(
			"Content-Type = %q, want application/problem+json",
			gotContentType,
		)
	}

	var details problem.Details
	if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	want := problem.ValidationFailedError
	want.Fields = fields
	if details.Type != want.Type || details.Title != want.Title ||
		details.Status != want.Status || details.Detail != want.Detail ||
		details.Instance != want.Instance ||
		!slices.Equal(details.Fields, want.Fields) {
		t.Fatalf("problem = %+v, want %+v", details, want)
	}
}

func assertJSONHeaders(t *testing.T, response *httptest.ResponseRecorder) {
	t.Helper()
	if got := response.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", got)
	}
	if got := response.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
}

func testServer(db sqlc.Querier) *adminapi.Server {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return &adminapi.Server{
		Runtime:         apiserver.New(nil, log),
		TenantID:        "test",
		Queries:         db,
		AdminSessionTTL: 24 * time.Hour,
	}
}
