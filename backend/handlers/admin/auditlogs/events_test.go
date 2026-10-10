package auditlogs

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	auditlogs "github.com/vetchium/src/typespec/admin/audit-logs"
	"github.com/vetchium/src/typespec/common"

	"backend/handlers/admin/internal/handlertest"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
)

type auditDB struct {
	sqlc.Querier
	rows   []sqlc.ListAdminAuditEventsRow
	err    error
	params sqlc.ListAdminAuditEventsParams
	calls  int
}

func (d *auditDB) ListAdminAuditEvents(_ context.Context, p sqlc.ListAdminAuditEventsParams) ([]sqlc.ListAdminAuditEventsRow, error) {
	d.params = p
	d.calls++
	return d.rows, d.err
}
func call(t *testing.T, handler http.HandlerFunc, value any) *httptest.ResponseRecorder {
	t.Helper()
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "/api/admin/list-audit-events", strings.NewReader(string(b)))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler(w, r)
	return w
}
func TestListPaginationAndProjection(t *testing.T) {
	t.Parallel()
	db := &auditDB{rows: []sqlc.ListAdminAuditEventsRow{
		{AuditEventID: handlertest.UUID(2), CreatedAt: dbvalue.Timestamp(handlertest.Now), Action: "hub.password.changed", ActorType: "hub_user", ActorName: "A Person", Payload: []byte(`{"password_changed":true,"email_address":"secret@example.test","date_of_birth":"1990-01-01","unknown":{"name":"secret"}}`)},
		{AuditEventID: handlertest.UUID(1), CreatedAt: dbvalue.Timestamp(handlertest.Now)},
	}}
	s := handlertest.Server(db, handlertest.Now)
	handler := ListAuditEvents(s)
	email := common.EmailAddress("PERSON@EXAMPLE.TEST")
	limit := common.PageSize(1)
	req := auditlogs.ListRequest{StartAt: handlertest.Now.Add(-time.Hour).Format(time.RFC3339), EndAt: handlertest.Now.Format(time.RFC3339), HubEmail: &email, Limit: &limit}
	w := call(t, handler, req)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var response auditlogs.ListResponse
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Events) != 1 || response.NextPaginationKey == nil {
		t.Fatalf("response=%+v", response)
	}
	if db.params.TenantID != "test" || db.params.PageLimit != 2 || db.params.HubEmail.String != "person@example.test" {
		t.Fatalf("params=%+v", db.params)
	}
	if strings.Contains(w.Body.String(), "secret") || strings.Contains(w.Body.String(), "1990") || len(response.Events[0].Details) != 1 {
		t.Fatal(w.Body.String())
	}
	req.PaginationKey = response.NextPaginationKey
	w = call(t, handler, req)
	if w.Code != 200 || !db.params.BeforeEventID.Valid {
		t.Fatal(w.Body.String())
	}
	req.EndAt = handlertest.Now.Add(time.Minute).Format(time.RFC3339)
	w = call(t, handler, req)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "invalid-pagination-key") {
		t.Fatal(w.Body.String())
	}
	req.PaginationKey = nil
	db.err = errors.New("database unavailable")
	w = call(t, handler, req)
	if w.Code != 500 || strings.Contains(w.Body.String(), "database unavailable") {
		t.Fatal(w.Body.String())
	}
}
func TestInvalidRequestDoesNotQuery(t *testing.T) {
	t.Parallel()
	db := &auditDB{}
	handler := ListAuditEvents(handlertest.Server(db, handlertest.Now))
	for _, payload := range []any{map[string]string{"unknown": "field"}, map[string]string{}, map[string]string{"start_at": "bad", "end_at": "bad", "hub_email": "bad"}} {
		w := call(t, handler, payload)
		if w.Code != 400 || db.calls != 0 {
			t.Fatal(w.Body.String())
		}
	}
}
func TestSafeDetailsFailClosed(t *testing.T) {
	t.Parallel()
	for _, payload := range []string{`not-json`, `[]`, `null`, `{"password_changed":"secret","attempt":-1,"display_name":"email@example.test","token":"secret","field_changes":{"date_of_birth":{"after":"1990-01-01"}}}`, `{"password_changed":null,"attempt":null}`} {
		if got := safeDetails([]byte(payload)); len(got) != 0 {
			t.Fatalf("%s: %+v", payload, got)
		}
	}
	if got := safeDetails([]byte(`{"display_name":"Some Name","attempt":2}`)); len(got) != 2 {
		t.Fatalf("%+v", got)
	}
}
