package users

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/problem"

	"backend/handlers/admin/internal/handlertest"
	adminauthn "backend/internal/admin/auth"
	"backend/internal/db/sqlc"
	"backend/internal/middleware"
)

type profileDBStub struct {
	sqlc.Querier
	updated int64
	params  sqlc.SetAdminDisplayNameParams
	err     error
}

func (s *profileDBStub) AuthenticateAdminSession(
	context.Context, []byte,
) (sqlc.AuthenticateAdminSessionRow, error) {
	return sqlc.AuthenticateAdminSessionRow{
		AdminUserID:     handlertest.UUID(10),
		AdminSessionID:  handlertest.UUID(11),
		AuthenticatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		Permissions:     []string{},
	}, nil
}

func (s *profileDBStub) SetAdminDisplayName(
	_ context.Context, params sqlc.SetAdminDisplayNameParams,
) (int64, error) {
	s.params = params
	return s.updated, s.err
}

func TestSetDisplayNameRejectsInvalidRequests(t *testing.T) {
	db := &profileDBStub{updated: 1}
	server := handlertest.Server(db, time.Now())
	handler := middleware.AdminAuth(server)(SetDisplayName(server))
	tests := []struct {
		body        string
		problemType string
		fields      []string
	}{
		{body: `{`, problemType: problem.InvalidJSONError.Type},
		{
			body:        `{"display_name":" "}`,
			problemType: problem.ValidationFailedError.Type,
			fields:      []string{"display_name"},
		},
		{
			body:        `{"display_name":"Administrator","extra":true}`,
			problemType: problem.InvalidJSONError.Type,
		},
	}
	for _, tt := range tests {
		response := performAuthenticatedJSONRequest(handler, tt.body)
		handlertest.AssertProblemResponse(
			t, response, http.StatusBadRequest, tt.problemType, tt.fields,
		)
	}
}

func TestSetDisplayNameHandlesDependencyFailure(t *testing.T) {
	db := &profileDBStub{updated: 1, err: errors.New("database unavailable")}
	server := handlertest.Server(db, time.Now())
	handler := middleware.AdminAuth(server)(SetDisplayName(server))
	response := performAuthenticatedJSONRequest(
		handler, `{"display_name":"Administrator"}`,
	)
	handlertest.AssertProblemResponse(
		t, response, http.StatusInternalServerError,
		problem.InternalServerError.Type, nil,
	)
}

func TestSetDisplayNameHandlesConcurrentDisable(t *testing.T) {
	db := &profileDBStub{updated: 0}
	server := handlertest.Server(db, time.Now())
	handler := middleware.AdminAuth(server)(SetDisplayName(server))
	response := performAuthenticatedJSONRequest(
		handler,
		`{"display_name":"Administrator"}`,
	)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("WWW-Authenticate"); got != adminauthn.BearerChallenge {
		t.Fatalf(
			"WWW-Authenticate = %q, want %q", got,
			adminauthn.BearerChallenge,
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

func TestSetDisplayNameReturnsSuccessAfterUpdate(t *testing.T) {
	db := &profileDBStub{updated: 1}
	server := handlertest.Server(db, time.Now())
	handler := middleware.AdminAuth(server)(SetDisplayName(server))
	response := performAuthenticatedJSONRequest(
		handler,
		`{"display_name":"  Administrator  "}`,
	)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if got, want := db.params.DisplayName, "Administrator"; got != want {
		t.Fatalf("display name = %q, want %q", got, want)
	}
}

func performAuthenticatedJSONRequest(
	handler http.Handler, body string,
) *httptest.ResponseRecorder {
	request := httptest.NewRequest(
		http.MethodPost, "/api/admin/set-display-name",
		bytes.NewBufferString(body),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer session-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
