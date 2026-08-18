package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/admin/authorization"
	"github.com/vetchium/src/typespec/admin/users"

	"backend/internal/db/sqlc"
	"backend/internal/middleware"
)

type usersDBStub struct {
	sqlc.Querier
	permissions   []string
	rows          []sqlc.ListAdminUsersRow
	listParams    sqlc.ListAdminUsersParams
	disableResult string
}

func (s *usersDBStub) AuthenticateAdminSession(
	context.Context, []byte,
) (sqlc.AuthenticateAdminSessionRow, error) {
	return sqlc.AuthenticateAdminSessionRow{
		AdminUserID:     testUUID(10),
		AdminSessionID:  testUUID(11),
		AuthenticatedAt: pgtype.Timestamptz{Time: testNow, Valid: true},
		Permissions:     s.permissions,
	}, nil
}

func (s *usersDBStub) DisableAdminUser(
	context.Context, sqlc.DisableAdminUserParams,
) (string, error) {
	return s.disableResult, nil
}

func (s *usersDBStub) ListAdminUsers(
	_ context.Context, params sqlc.ListAdminUsersParams,
) ([]sqlc.ListAdminUsersRow, error) {
	s.listParams = params
	return s.rows, nil
}

var testNow = time.Date(2026, 8, 18, 10, 0, 0, 0, time.UTC)

func adminUserRow(permissions ...string) sqlc.ListAdminUsersRow {
	return sqlc.ListAdminUsersRow{
		AdminUserID:  testUUID(20),
		EmailAddress: "admin@example.com",
		DisplayNamesJson: `[{"language_code":"en-US",` +
			`"display_name":"Administrator"}]`,
		PrimaryDisplayNameLanguage: "en-US",
		AdminUserState:             sqlc.VetchiumAdminUserStateActive,
		Permissions:                permissions,
		CreatedAt:                  pgtype.Timestamptz{Time: testNow, Valid: true},
	}
}

func performListUsers(
	db *usersDBStub, body string,
) *httptest.ResponseRecorder {
	server := testAdminServer(db, testNow)
	handler := middleware.AdminAuth(server)(
		middleware.RequireAdminPermission(
			server, string(authorization.ViewUsers),
		)(ListUsers(server)),
	)
	request := httptest.NewRequest(
		http.MethodPost, "/api/admin/list-users",
		bytes.NewBufferString(body),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer session-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestListUsersFiltersByEffectivePermissions(t *testing.T) {
	db := &usersDBStub{
		permissions: []string{"admin:view_users"},
		rows: []sqlc.ListAdminUsersRow{
			adminUserRow("admin:manage_users", "admin:view_users"),
		},
	}
	response := performListUsers(db, `{"filter_permissions":`+
		`["admin:manage_users"],"filter_no_permissions":false}`)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	want := []string{"admin:manage_users"}
	if !slices.Equal(db.listParams.FilterPermissions, want) {
		t.Fatalf("filter permissions = %v, want %v",
			db.listParams.FilterPermissions, want)
	}
	if !db.listParams.FilterNoPermissions.Valid ||
		db.listParams.FilterNoPermissions.Bool {
		t.Fatalf("filter no permissions = %+v", db.listParams.FilterNoPermissions)
	}

	var listed users.ListUsersResponse
	if err := json.NewDecoder(response.Body).Decode(&listed); err != nil {
		t.Fatal(err)
	}
	wantPermissions := []authorization.AdminPermissionID{
		"admin:manage_users", "admin:view_users",
	}
	if len(listed.Users) != 1 ||
		!slices.Equal(listed.Users[0].Permissions, wantPermissions) {
		t.Fatalf("users = %+v", listed.Users)
	}
}

func TestListUsersRejectsUndefinedFilterPermission(t *testing.T) {
	db := &usersDBStub{permissions: []string{"admin:view_users"}}
	response := performListUsers(
		db, `{"filter_permissions":["admin:manage_domains"]}`,
	)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	details := decodeProblem(t, response)
	if details.Type != "vetchium-problem-details/validation-failed" ||
		!slices.Equal(details.Fields, []string{"filter_permissions"}) {
		t.Fatalf("problem = %+v", details)
	}
}

func TestListUsersPaginationKeyBindsPermissionFilters(t *testing.T) {
	db := &usersDBStub{
		permissions: []string{"admin:view_users"},
		rows: []sqlc.ListAdminUsersRow{
			adminUserRow("admin:manage_users"),
			adminUserRow("admin:view_users"),
		},
	}
	response := performListUsers(
		db, `{"limit":1,"filter_permissions":["admin:view_users"]}`,
	)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var page users.ListUsersResponse
	if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if page.NextPaginationKey == nil {
		t.Fatal("no pagination key returned")
	}
	key := string(*page.NextPaginationKey)

	continued := performListUsers(db, `{"limit":1,"filter_permissions":`+
		`["admin:view_users"],"pagination_key":"`+key+`"}`)
	if continued.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s",
			continued.Code, continued.Body.String())
	}

	changed := performListUsers(db, `{"limit":1,"filter_permissions":`+
		`["admin:manage_users"],"pagination_key":"`+key+`"}`)
	if changed.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", changed.Code, changed.Body.String())
	}
	details := decodeProblem(t, changed)
	if details.Type != "vetchium-problem-details/invalid-pagination-key" {
		t.Fatalf("problem = %+v", details)
	}
}

func TestDisableUserKeepsAnAdministratorAbleToManage(t *testing.T) {
	db := &usersDBStub{
		permissions:   []string{"admin:manage_users", "admin:view_users"},
		disableResult: "last_manager",
	}
	server := testAdminServer(db, testNow)
	handler := middleware.AdminAuth(server)(
		middleware.RequireAdminPermission(
			server, string(authorization.ManageUsers),
		)(DisableUser(server)),
	)
	request := httptest.NewRequest(
		http.MethodPost, "/api/admin/disable-user",
		bytes.NewBufferString(`{"admin_user_id":"`+testAdminUserID+`"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer session-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	details := decodeProblem(t, response)
	if details.Type != "vetchium-problem-details/last-admin-manager" {
		t.Fatalf("problem = %+v", details)
	}
}
