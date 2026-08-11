package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/problem"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
)

type profileDBStub struct {
	sqlc.Querier
	updated int64
	params  sqlc.SetAdminDisplayNamesParams
}

func (s *profileDBStub) AuthenticateAdminSession(
	context.Context, []byte,
) (sqlc.AuthenticateAdminSessionRow, error) {
	return sqlc.AuthenticateAdminSessionRow{
		AdminUserID:     testUUID(10),
		AdminSessionID:  testUUID(11),
		AuthenticatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		Permissions:     []string{},
	}, nil
}

func (s *profileDBStub) SetAdminDisplayNames(
	_ context.Context, params sqlc.SetAdminDisplayNamesParams,
) (int64, error) {
	s.params = params
	return s.updated, nil
}

func TestSetDisplayNamesHandlesConcurrentDisable(t *testing.T) {
	db := &profileDBStub{updated: 0}
	server := testAdminServer(db, time.Now())
	handler := middleware.AdminAuth(server)(SetDisplayNames(server))
	response := performAuthenticatedJSONRequest(
		handler,
		`{"display_names":[{"language_code":"en-US",`+
			`"display_name":"Administrator"}],`+
			`"primary_display_name_language":"en-US"}`,
	)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("WWW-Authenticate"); got != adminapi.BearerChallenge {
		t.Fatalf(
			"WWW-Authenticate = %q, want %q", got,
			adminapi.BearerChallenge,
		)
	}
	var details problem.Details
	if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	if details.Type != "vetchium-problem-details/admin-authentication-required" {
		t.Fatalf("problem = %+v", details)
	}
}

func TestSetDisplayNamesReturnsSuccessAfterUpdate(t *testing.T) {
	db := &profileDBStub{updated: 1}
	server := testAdminServer(db, time.Now())
	handler := middleware.AdminAuth(server)(SetDisplayNames(server))
	response := performAuthenticatedJSONRequest(
		handler,
		`{"display_names":[{"language_code":"en-US",`+
			`"display_name":"  Administrator  "}],`+
			`"primary_display_name_language":"en-US"}`,
	)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if got, want := db.params.DisplayNames, []string{"Administrator"}; len(got) != 1 || got[0] != want[0] {
		t.Fatalf("display names = %v, want %v", got, want)
	}
}

func performAuthenticatedJSONRequest(
	handler http.Handler, body string,
) *httptest.ResponseRecorder {
	request := httptest.NewRequest(
		http.MethodPost, "/api/admin/set-display-names",
		bytes.NewBufferString(body),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer session-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
