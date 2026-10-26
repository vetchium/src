package engagements

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	operationspec "github.com/vetchium/src/typespec/orgs/operations"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/engagements"
	"backend/internal/federation/commands"
	orgsruntime "backend/internal/orgs"
)

func testServer() *orgsruntime.Server {
	return &orgsruntime.Server{
		Runtime:       apiserver.New(nil, slog.New(slog.NewTextHandler(io.Discard, nil))),
		CredentialKey: [32]byte{7},
	}
}

func snapshotJSON(t *testing.T, valid bool) []byte {
	t.Helper()
	proposed := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	snapshot := federationspec.EngagementSnapshot{
		EngagementID: "01900000-0000-7000-8000-000000000003", Version: 2,
		Consumer:   federationspec.EngagementSnapshotOrg{OrgDID: "01900000-0000-7000-8000-000000000001", Domain: "client.test", DisplayName: "Client"},
		Provider:   federationspec.EngagementSnapshotOrg{OrgDID: "01900000-0000-7000-8000-000000000002", Domain: "agency.test", DisplayName: "Agency"},
		Capability: marketplace.Sourcing, State: marketplace.ActiveEngagement,
		ProposedAt: proposed, ExpiresAt: proposed.Add(marketplace.ProposalLifetime), UpdatedAt: proposed,
	}
	if !valid {
		snapshot.Version = 0
	}
	data, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func problemBody(details problem.Details) []byte {
	data, _ := json.Marshal(details)
	return data
}

func TestAnswerMapsEveryOutcomeOfAProviderCommand(t *testing.T) {
	t.Parallel()
	operationID, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name    string
		outcome commands.Outcome
		err     error
		status  int
		problem string
		body    string
	}{
		{"succeeded", commands.Outcome{State: commands.StateSucceeded, Response: commands.Response{Status: 200, Body: snapshotJSON(t, true)}}, nil, 200, "", `"counterparty":{"domain":"client.test"`},
		{"invalid result", commands.Outcome{State: commands.StateSucceeded, Response: commands.Response{Status: 200, Body: snapshotJSON(t, false)}}, nil, 500, "", ""},
		{"not found", commands.Outcome{State: commands.StateFailed, Response: commands.Response{Status: 404, Body: problemBody(orgsproblem.EngagementNotFoundError)}}, nil, 404, orgsproblem.EngagementNotFoundError.Type, ""},
		{"state conflict", commands.Outcome{State: commands.StateFailed, Response: commands.Response{Status: 409, Body: problemBody(orgsproblem.EngagementStateConflictError)}}, nil, 409, orgsproblem.EngagementStateConflictError.Type, ""},
		{"version conflict", commands.Outcome{State: commands.StateFailed, Response: commands.Response{Status: 409, Body: problemBody(orgsproblem.EngagementVersionConflictError)}}, nil, 409, orgsproblem.EngagementVersionConflictError.Type, ""},
		{"undeclared rejection", commands.Outcome{State: commands.StateFailed, Response: commands.Response{Status: 403, Body: problemBody(problem.Details{Type: "vetchium-problem-details/federation-initiator-mismatch", Status: 403})}}, nil, 500, "", ""},
		{"pending", commands.Outcome{State: commands.StatePending, OperationID: operationID}, nil, 202, "", dbvalue.FormatUUID(operationID)},
		{"unavailable", commands.Outcome{State: commands.StateUnavailable}, nil, 503, orgsproblem.TenantUnavailableError.Type, ""},
		{"key conflict", commands.Outcome{}, commands.ErrIdempotencyConflict, 409, problem.IdempotencyKeyConflictError.Type, ""},
		{"send error", commands.Outcome{}, errors.New("database down"), 500, "", ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/", nil)
			answer(testServer(), recorder, request, federationspec.EngagementAcceptKind, test.outcome, test.err)
			if recorder.Code != test.status {
				t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
			}
			if test.problem != "" {
				var details problem.Details
				_ = json.Unmarshal(recorder.Body.Bytes(), &details)
				if details.Type != test.problem {
					t.Fatalf("problem = %q, want %q", details.Type, test.problem)
				}
			}
			if test.body != "" && !strings.Contains(recorder.Body.String(), test.body) {
				t.Fatalf("body = %s, want it to contain %s", recorder.Body.String(), test.body)
			}
			if test.status == 202 {
				var pending operationspec.PendingOperation
				if json.Unmarshal(recorder.Body.Bytes(), &pending) != nil || pending.OperationID == "" {
					t.Fatalf("pending body = %s", recorder.Body.String())
				}
			}
		})
	}
}

func row(id byte, state sqlc.VetchiumOrgEngagementState, rank int16, age time.Duration) engagements.Fields {
	proposed := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC).Add(-age)
	engagementID := pgtype.UUID{Valid: true}
	engagementID.Bytes[15] = id
	return engagements.Fields{
		EngagementID: engagementID, Version: 1, ConsumerDomain: "client.test",
		ConsumerDisplayName: "Client", ProviderDomain: "agency.test",
		ProviderDisplayName: "Agency", CapabilityOid: "sourcing",
		EngagementState: state, StateRank: pgtype.Int2{Int16: rank, Valid: true},
		ProposedAt: pgtype.Timestamptz{Time: proposed, Valid: true},
		ExpiresAt:  pgtype.Timestamptz{Time: proposed.Add(time.Hour), Valid: true},
		UpdatedAt:  pgtype.Timestamptz{Time: proposed, Valid: true},
	}
}

func TestListPaginatesWithAKeyBoundToItsFilters(t *testing.T) {
	t.Parallel()
	rows := []engagements.Fields{
		row(1, sqlc.VetchiumOrgEngagementStateProposed, 0, 0),
		row(2, sqlc.VetchiumOrgEngagementStateActive, 1, 0),
		row(3, sqlc.VetchiumOrgEngagementStateEnded, 2, 0),
	}
	var seen []sqlc.ListConsumerEngagementsParams
	handler := list(testServer(), marketplace.ConsumerParty,
		func(_ *http.Request, params sqlc.ListConsumerEngagementsParams) ([]engagements.Fields, error) {
			seen = append(seen, params)
			end := int(params.PageLimit)
			if end > len(rows) {
				end = len(rows)
			}
			return rows[:end], nil
		})
	call := func(body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		handler(recorder, request)
		return recorder
	}
	first := call(`{"limit":2}`)
	if first.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", first.Code, first.Body.String())
	}
	var page marketplace.ListEngagementsResponse
	if err := json.Unmarshal(first.Body.Bytes(), &page); err != nil ||
		len(page.Engagements) != 2 || page.NextPaginationKey == nil ||
		page.Engagements[0].State != marketplace.ProposedEngagement {
		t.Fatalf("first page = %+v, %v", page, err)
	}
	if seen[0].AfterID.Valid || seen[0].PageLimit != 3 {
		t.Fatalf("first query = %+v", seen[0])
	}
	key := string(*page.NextPaginationKey)
	if next := call(`{"limit":2,"pagination_key":"` + key + `"}`); next.Code != http.StatusOK {
		t.Fatalf("resumed status = %d body = %s", next.Code, next.Body.String())
	}
	resumed := seen[len(seen)-1]
	if !resumed.AfterID.Valid || resumed.AfterRank.Int16 != 1 {
		t.Fatalf("resumed query = %+v", resumed)
	}
	for name, body := range map[string]string{
		"another filter": `{"limit":2,"state":"active","pagination_key":"` + key + `"}`,
		"tampered":       `{"limit":2,"pagination_key":"` + key + `x"}`,
	} {
		recorder := call(body)
		var details problem.Details
		_ = json.Unmarshal(recorder.Body.Bytes(), &details)
		if recorder.Code != http.StatusBadRequest || details.Type != problem.InvalidPaginationKeyError.Type {
			t.Errorf("%s: status = %d body = %s", name, recorder.Code, recorder.Body.String())
		}
	}
	if recorder := call(`{"limit":101}`); recorder.Code != http.StatusBadRequest {
		t.Fatalf("limit status = %d", recorder.Code)
	}
}
