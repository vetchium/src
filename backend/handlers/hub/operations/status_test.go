package operations

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	operationspec "github.com/vetchium/src/typespec/hub/operations"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

type statusQueriesStub struct {
	sqlc.Querier
	lookup func(sqlc.GetHubFederationOperationStatusParams) (
		sqlc.GetHubFederationOperationStatusRow, error,
	)
}

func (*statusQueriesStub) AuthenticateHubSession(
	context.Context, []byte,
) (sqlc.AuthenticateHubSessionRow, error) {
	return sqlc.AuthenticateHubSessionRow{
		HubUserDid:      statusTestUUID(1),
		HubSessionID:    statusTestUUID(2),
		AuthenticatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}, nil
}

func (s *statusQueriesStub) GetHubFederationOperationStatus(
	_ context.Context, params sqlc.GetHubFederationOperationStatusParams,
) (sqlc.GetHubFederationOperationStatusRow, error) {
	return s.lookup(params)
}

func statusTestUUID(value byte) pgtype.UUID {
	return pgtype.UUID{Bytes: [16]byte{6: 0x40, 8: 0x80, 15: value}, Valid: true}
}

func TestStatusAuthorizesInitiatorAndReturnsState(t *testing.T) {
	operationID := statusTestUUID(3)
	db := &statusQueriesStub{lookup: func(
		params sqlc.GetHubFederationOperationStatusParams,
	) (sqlc.GetHubFederationOperationStatusRow, error) {
		if params.OperationID != operationID ||
			params.OwnerPrincipalID != dbvalue.FormatUUID(statusTestUUID(1)) {
			t.Fatalf("operation lookup = %+v", params)
		}
		return sqlc.GetHubFederationOperationStatusRow{
			OperationID: operationID,
			State:       sqlc.VetchiumFederationOperationStatePending,
		}, nil
	}}
	response := callStatus(t, db, `{"operation_id":"`+dbvalue.FormatUUID(operationID)+`"}`, true)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status=%d cache=%q", response.Code, response.Header().Get("Cache-Control"))
	}
	var body operationspec.OperationStatus
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil ||
		body.OperationID != operationspec.OperationID(dbvalue.FormatUUID(operationID)) ||
		body.State != operationspec.Pending {
		t.Fatalf("operation status = %+v, %v", body, err)
	}
}

func TestStatusHidesOtherOperationsAndInvalidRequests(t *testing.T) {
	operationID := statusTestUUID(3)
	for _, test := range []struct {
		name          string
		body          string
		authenticated bool
		lookupError   error
		wantStatus    int
	}{
		{"other owner", `{"operation_id":"` + dbvalue.FormatUUID(operationID) + `"}`,
			true, pgx.ErrNoRows, http.StatusNotFound},
		{"database failure", `{"operation_id":"` + dbvalue.FormatUUID(operationID) + `"}`,
			true, errors.New("database unavailable"), http.StatusInternalServerError},
		{"invalid id", `{"operation_id":"not-a-uuid"}`,
			true, nil, http.StatusBadRequest},
		{"missing authorization", `{"operation_id":"` + dbvalue.FormatUUID(operationID) + `"}`,
			false, nil, http.StatusUnauthorized},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &statusQueriesStub{lookup: func(
				sqlc.GetHubFederationOperationStatusParams,
			) (sqlc.GetHubFederationOperationStatusRow, error) {
				if test.lookupError == nil {
					t.Fatal("invalid request reached operation lookup")
				}
				return sqlc.GetHubFederationOperationStatusRow{}, test.lookupError
			}}
			response := callStatus(t, db, test.body, test.authenticated)
			if response.Code != test.wantStatus {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func callStatus(
	t *testing.T, db *statusQueriesStub, body string, authenticated bool,
) *httptest.ResponseRecorder {
	t.Helper()
	s := &hubruntime.Server{
		Runtime: apiserver.New(nil, slog.New(slog.NewTextHandler(io.Discard, nil))),
		Queries: db,
	}
	handler := middleware.HubAuth(s)(Status(s))
	request := httptest.NewRequest(http.MethodPost, "/api/hub/operations/status",
		strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if authenticated {
		request.Header.Set("Authorization", "Bearer session-token")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
