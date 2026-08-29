package portal

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
)

type pingQueriesStub struct {
	row sqlc.PingDatabaseRow
	err error
}

func (s pingQueriesStub) PingDatabase(
	context.Context,
) (sqlc.PingDatabaseRow, error) {
	return s.row, s.err
}

func TestPing(t *testing.T) {
	databaseTime := time.Date(2026, time.August, 29, 10, 0, 0, 0, time.UTC)
	runtime := apiserver.New(
		nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	handler := Ping(runtime, pingQueriesStub{row: sqlc.PingDatabaseRow{
		Nonce: "nonce", DatabaseTime: pgtype.Timestamptz{
			Time: databaseTime, Valid: true,
		},
	}}, "hub", "test")
	response := httptest.NewRecorder()
	handler(response, httptest.NewRequest(http.MethodGet, "/", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	var body struct {
		Portal       string    `json:"portal"`
		Tenant       string    `json:"tenant"`
		Nonce        string    `json:"nonce"`
		DatabaseTime time.Time `json:"database_time"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Portal != "hub" || body.Tenant != "test" ||
		body.Nonce != "nonce" || !body.DatabaseTime.Equal(databaseTime) {
		t.Fatalf("body = %+v", body)
	}
}

func TestPingReportsDatabaseFailure(t *testing.T) {
	runtime := apiserver.New(
		nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	handler := Ping(
		runtime, pingQueriesStub{err: errors.New("database unavailable")},
		"hub", "test",
	)
	response := httptest.NewRecorder()
	handler(response, httptest.NewRequest(http.MethodGet, "/", nil))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", response.Code)
	}
}
