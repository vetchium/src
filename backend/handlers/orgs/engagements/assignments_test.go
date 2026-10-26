package engagements

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/openings"

	"backend/internal/db/sqlc"
)

func uuid(last byte) pgtype.UUID {
	value := pgtype.UUID{Valid: true}
	value.Bytes[15] = last
	return value
}

func TestOnlyLiveOpeningsTakeProviders(t *testing.T) {
	t.Parallel()
	for state, terminal := range map[openings.OpeningState]bool{
		openings.Draft: false, openings.Published: false, openings.Paused: false,
		openings.Discarded: true, openings.Closed: true, openings.Expired: true,
	} {
		if got := terminalOpening(string(state)); got != terminal {
			t.Errorf("terminalOpening(%q) = %t, want %t", state, got, terminal)
		}
	}
}

type assignmentQuerier struct {
	sqlc.Querier
	stages      []sqlc.ListOpeningStagesRow
	assignments []sqlc.ListOpeningAssignmentsRow
}

func (q assignmentQuerier) ListOpeningStages(
	context.Context, pgtype.UUID,
) ([]sqlc.ListOpeningStagesRow, error) {
	return q.stages, nil
}

func (q assignmentQuerier) ListOpeningAssignments(
	context.Context, pgtype.UUID,
) ([]sqlc.ListOpeningAssignmentsRow, error) {
	return q.assignments, nil
}

func TestOpeningProvidersGroupAssignmentsByStageInPipelineOrder(t *testing.T) {
	t.Parallel()
	stageOne, stageTwo := uuid(1), uuid(2)
	assignedAt := pgtype.Timestamptz{Time: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), Valid: true}
	querier := assignmentQuerier{
		stages: []sqlc.ListOpeningStagesRow{
			{OrgOpeningStageID: stageOne, Name: "Screen", StageKind: sqlc.VetchiumPipelineStageKindReview},
			{OrgOpeningStageID: stageTwo, Name: "Panel", StageKind: sqlc.VetchiumPipelineStageKindInterview},
		},
		assignments: []sqlc.ListOpeningAssignmentsRow{
			{EngagementID: uuid(10), ProviderDomain: "agency.test", ProviderDisplayName: "Agency", CapabilityOid: "sourcing", AssignedAt: assignedAt},
			{OrgOpeningStageID: stageTwo, EngagementID: uuid(11), ProviderDomain: "panel.test", ProviderDisplayName: "Panel Co", CapabilityOid: "interviewing", AssignedAt: assignedAt},
		},
	}
	got, err := readOpeningProviders(httptest.NewRequest("POST", "/", nil), querier, uuid(9), 7)
	if err != nil {
		t.Fatal(err)
	}
	if got.OpeningNumber != 7 || len(got.Agencies) != 1 || got.Agencies[0].Capability != marketplace.Sourcing ||
		len(got.Stages) != 2 || got.Stages[0].Stage.Name != "Screen" ||
		got.Stages[0].Assignments == nil || len(got.Stages[0].Assignments) != 0 ||
		len(got.Stages[1].Assignments) != 1 ||
		got.Stages[1].Assignments[0].Counterparty.Domain != "panel.test" {
		t.Fatalf("providers = %+v", got)
	}
	querier.assignments = []sqlc.ListOpeningAssignmentsRow{{OrgOpeningStageID: uuid(99), EngagementID: uuid(12)}}
	if _, err := readOpeningProviders(httptest.NewRequest("POST", "/", nil), querier, uuid(9), 7); err == nil {
		t.Fatal("an assignment to a stage outside the Opening must not be served")
	}
}
