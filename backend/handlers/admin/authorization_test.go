package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/admin/authorization"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
)

type authorizationDBStub struct {
	sqlc.Querier
	permissions     []string
	authenticatedAt time.Time
	result          string
	setError        error
	params          sqlc.SetAdminPermissionsParams
	calls           int
}

func (s *authorizationDBStub) AuthenticateAdminSession(
	context.Context, []byte,
) (sqlc.AuthenticateAdminSessionRow, error) {
	return sqlc.AuthenticateAdminSessionRow{
		AdminUserID:    testUUID(10),
		AdminSessionID: testUUID(11),
		AuthenticatedAt: pgtype.Timestamptz{
			Time: s.authenticatedAt, Valid: true,
		},
		Permissions: s.permissions,
	}, nil
}

func (s *authorizationDBStub) SetAdminPermissions(
	_ context.Context, params sqlc.SetAdminPermissionsParams,
) (string, error) {
	s.calls++
	s.params = params
	if s.setError != nil {
		return "", s.setError
	}
	return s.result, nil
}

const testAdminUserID = "11111111-1111-4111-8111-111111111111"

func setPermissionsHandler(
	db *authorizationDBStub, now time.Time,
) (http.Handler, *adminapi.Server) {
	server := testAdminServer(db, now)
	handler := middleware.AdminAuth(server)(
		middleware.RequireAdminPermission(
			server, string(authorization.ManageUsers),
		)(
			middleware.RequireRecentAdminAuthentication(server, 5*time.Minute)(
				SetPermissions(server),
			),
		),
	)
	return handler, server
}

func performSetPermissions(
	handler http.Handler, body string,
) *httptest.ResponseRecorder {
	request := httptest.NewRequest(
		http.MethodPost, "/api/admin/set-user-permissions",
		bytes.NewBufferString(body),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer session-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func decodeProblem(
	t *testing.T, response *httptest.ResponseRecorder,
) problem.Details {
	t.Helper()
	var details problem.Details
	if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	return details
}

func TestSetPermissionsStoresGrantsWithoutImpliedPermissions(t *testing.T) {
	now := time.Date(2026, 8, 18, 10, 0, 0, 0, time.UTC)
	db := &authorizationDBStub{
		permissions:     []string{"admin:manage_users", "admin:view_users"},
		authenticatedAt: now,
		result:          "ok",
	}
	handler, _ := setPermissionsHandler(db, now)
	response := performSetPermissions(handler, `{"admin_user_id":"`+
		testAdminUserID+`","permissions":["admin:view_users",`+
		`"admin:manage_users"]}`)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	want := []string{"admin:manage_users"}
	if !slices.Equal(db.params.Permissions, want) {
		t.Fatalf("stored permissions = %v, want %v", db.params.Permissions, want)
	}
}

func TestSetPermissionsClearsEveryGrant(t *testing.T) {
	now := time.Date(2026, 8, 18, 10, 0, 0, 0, time.UTC)
	db := &authorizationDBStub{
		permissions:     []string{"admin:manage_users", "admin:view_users"},
		authenticatedAt: now,
		result:          "ok",
	}
	handler, _ := setPermissionsHandler(db, now)
	response := performSetPermissions(
		handler,
		`{"admin_user_id":"`+testAdminUserID+`","permissions":[]}`,
	)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if len(db.params.Permissions) != 0 {
		t.Fatalf("stored permissions = %v", db.params.Permissions)
	}
}

func TestSetPermissionsFailureResponses(t *testing.T) {
	now := time.Date(2026, 8, 18, 10, 0, 0, 0, time.UTC)
	cases := []struct {
		name        string
		permissions []string
		authAge     time.Duration
		result      string
		setError    error
		body        string
		status      int
		problemType string
		fields      []string
		wantCalls   int
	}{
		{
			name:        "malformed json",
			permissions: []string{"admin:manage_users"},
			body:        `{"admin_user_id":`,
			status:      http.StatusBadRequest,
			problemType: "vetchium-problem-details/invalid-json",
		},
		{
			name:        "undefined permission is refused",
			permissions: []string{"admin:manage_users"},
			body: `{"admin_user_id":"` + testAdminUserID +
				`","permissions":["admin:manage_domains"]}`,
			status:      http.StatusBadRequest,
			problemType: "vetchium-problem-details/validation-failed",
			fields:      []string{"permissions"},
		},
		{
			name:        "duplicate permission is refused",
			permissions: []string{"admin:manage_users"},
			body: `{"admin_user_id":"bad","permissions":` +
				`["admin:view_users","admin:view_users"]}`,
			status:      http.StatusBadRequest,
			problemType: "vetchium-problem-details/validation-failed",
			fields:      []string{"admin_user_id", "permissions"},
		},
		{
			name:        "viewer cannot change permissions",
			permissions: []string{"admin:view_users"},
			body: `{"admin_user_id":"` + testAdminUserID +
				`","permissions":[]}`,
			status:      http.StatusForbidden,
			problemType: "vetchium-problem-details/admin-permission-required",
		},
		{
			name:        "stale sign in requires reauthentication",
			permissions: []string{"admin:manage_users"},
			authAge:     10 * time.Minute,
			body: `{"admin_user_id":"` + testAdminUserID +
				`","permissions":[]}`,
			status:      http.StatusUnauthorized,
			problemType: "vetchium-problem-details/recent-authentication-required",
		},
		{
			name:        "unknown target",
			permissions: []string{"admin:manage_users"},
			result:      "not_found",
			body: `{"admin_user_id":"` + testAdminUserID +
				`","permissions":[]}`,
			status:      http.StatusNotFound,
			problemType: "vetchium-problem-details/admin-user-not-found",
			wantCalls:   1,
		},
		{
			name:        "last manager keeps managing",
			permissions: []string{"admin:manage_users"},
			result:      "last_manager",
			body: `{"admin_user_id":"` + testAdminUserID +
				`","permissions":["admin:view_users"]}`,
			status:      http.StatusConflict,
			problemType: "vetchium-problem-details/last-admin-manager",
			wantCalls:   1,
		},
		{
			name:        "database failure",
			permissions: []string{"admin:manage_users"},
			setError:    errors.New("database unavailable"),
			body: `{"admin_user_id":"` + testAdminUserID +
				`","permissions":[]}`,
			status:      http.StatusInternalServerError,
			problemType: "vetchium-problem-details/internal-server-error",
			wantCalls:   1,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			db := &authorizationDBStub{
				permissions:     testCase.permissions,
				authenticatedAt: now.Add(-testCase.authAge),
				result:          testCase.result,
				setError:        testCase.setError,
			}
			handler, _ := setPermissionsHandler(db, now)
			response := performSetPermissions(handler, testCase.body)

			if response.Code != testCase.status {
				t.Fatalf("status = %d, want %d, body = %s",
					response.Code, testCase.status, response.Body.String())
			}
			details := decodeProblem(t, response)
			if details.Type != testCase.problemType {
				t.Fatalf("problem = %+v, want type %q",
					details, testCase.problemType)
			}
			if !slices.Equal(details.Fields, testCase.fields) {
				t.Fatalf("fields = %v, want %v",
					details.Fields, testCase.fields)
			}
			if db.calls != testCase.wantCalls {
				t.Fatalf("SetAdminPermissions calls = %d, want %d",
					db.calls, testCase.wantCalls)
			}
		})
	}
}

func TestSetPermissionsRequiresAuthentication(t *testing.T) {
	now := time.Date(2026, 8, 18, 10, 0, 0, 0, time.UTC)
	db := &authorizationDBStub{permissions: []string{}, authenticatedAt: now}
	handler, _ := setPermissionsHandler(db, now)
	request := httptest.NewRequest(
		http.MethodPost, "/api/admin/set-user-permissions",
		bytes.NewBufferString(`{"admin_user_id":"`+testAdminUserID+
			`","permissions":[]}`),
	)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("WWW-Authenticate"); got != adminapi.BearerChallenge {
		t.Fatalf("WWW-Authenticate = %q, want %q", got, adminapi.BearerChallenge)
	}
	details := decodeProblem(t, response)
	if details.Type != "vetchium-problem-details/admin-authentication-required" {
		t.Fatalf("problem = %+v", details)
	}
}
