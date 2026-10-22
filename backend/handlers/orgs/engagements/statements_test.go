package engagements_test

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"backend/handlers/orgs/engagements"
	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

type dummyQuerier struct {
	sqlc.Querier
}

func (d dummyQuerier) GetOrgEngagementSnapshot(ctx context.Context, id pgtype.UUID) (sqlc.VetchiumOrgEngagementSnapshot, error) {
	return sqlc.VetchiumOrgEngagementSnapshot{}, pgx.ErrNoRows
}

func (d dummyQuerier) GetProviderEngagement(ctx context.Context, arg sqlc.GetProviderEngagementParams) (sqlc.GetProviderEngagementRow, error) {
	return sqlc.GetProviderEngagementRow{}, pgx.ErrNoRows
}

func testStatementsServer() *orgsruntime.Server {
	return &orgsruntime.Server{
		Runtime:       apiserver.New(nil, slog.New(slog.NewTextHandler(io.Discard, nil))),
		CredentialKey: [32]byte{7},
		Queries:       dummyQuerier{},
	}
}

func TestGetEngagementStatementValidation(t *testing.T) {
	t.Parallel()
	s := testStatementsServer()
	h := engagements.GetEngagementStatement(s)

	req := httptest.NewRequest(http.MethodPost, "/api/orgs/get-engagement-statement", bytes.NewBufferString(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty body, got %d", rec.Code)
	}
}

func TestGetEngagementStatementNotFound(t *testing.T) {
	t.Parallel()
	s := testStatementsServer()
	h := engagements.GetEngagementStatement(s)

	orgDID, _ := dbvalue.ParseUUID("01900000-0000-7000-8000-000000000001")
	ctx := middleware.ContextWithOrgIdentity(context.Background(), middleware.OrgIdentity{
		OrgDID: orgDID,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/orgs/get-engagement-statement", bytes.NewBufferString(`{
		"engagement_id": "01900000-0000-7000-8000-000000000003",
		"month": "2026-10"
	}`)).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown engagement, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetClientEngagementStatementNotFound(t *testing.T) {
	t.Parallel()
	s := testStatementsServer()
	h := engagements.GetClientEngagementStatement(s)

	orgDID, _ := dbvalue.ParseUUID("01900000-0000-7000-8000-000000000002")
	ctx := middleware.ContextWithOrgIdentity(context.Background(), middleware.OrgIdentity{
		OrgDID: orgDID,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/orgs/get-client-engagement-statement", bytes.NewBufferString(`{
		"engagement_id": "01900000-0000-7000-8000-000000000003",
		"month": "2026-10"
	}`)).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown engagement, got %d: %s", rec.Code, rec.Body.String())
	}
}
