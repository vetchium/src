package handlertest

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/problem"

	adminruntime "backend/internal/admin"
	adminauth "backend/internal/admin/auth"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
)

var Now = time.Date(2026, 8, 18, 10, 0, 0, 0, time.UTC)

const AdminUserID = "11111111-1111-4111-8111-111111111111"

func Server(db sqlc.Querier, now time.Time) *adminruntime.Server {
	return &adminruntime.Server{
		Runtime: apiserver.New(
			nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
		),
		Queries: db, TenantID: "test",
		SessionDurations: apiserver.SessionDurations{Default: time.Hour},
		CredentialKey:    adminauth.DeriveCredentialKey("test", "secret"),
		Now:              func() time.Time { return now },
	}
}

func UUID(last byte) pgtype.UUID {
	value := [16]byte{15: last}
	return pgtype.UUID{Bytes: value, Valid: true}
}

func AssertProblemResponse(
	t *testing.T,
	response *httptest.ResponseRecorder,
	status int,
	problemType string,
	fields []string,
) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	contentType := response.Header().Get("Content-Type")
	if contentType != problem.MediaType {
		t.Fatalf("Content-Type = %q", contentType)
	}
	var details problem.Details
	if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	if details.Type != problemType || details.Status != status {
		t.Fatalf("problem = %+v", details)
	}
	if fields != nil && !slices.Equal(details.Fields, fields) {
		t.Fatalf("fields = %v, want %v", details.Fields, fields)
	}
}

func DecodeProblem(
	t *testing.T, response *httptest.ResponseRecorder,
) problem.Details {
	t.Helper()
	var details problem.Details
	if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	return details
}
