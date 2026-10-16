package workers

import (
	"context"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"

	"backend/internal/db/sqlc"
)

type orgAIStub struct {
	grants    []sqlc.GrantOrgAICreditsParams
	grantRows []sqlc.GrantOrgAICreditsRow
	cutoffs   []time.Time
	abandoned []sqlc.AbandonOrgAIReservationsRow
	deleted   []int32
}

func (s *orgAIStub) GrantOrgAICredits(
	_ context.Context, params sqlc.GrantOrgAICreditsParams,
) (sqlc.GrantOrgAICreditsRow, error) {
	s.grants = append(s.grants, params)
	return s.grantRows[len(s.grants)-1], nil
}

func (s *orgAIStub) AbandonOrgAIReservations(
	_ context.Context, params sqlc.AbandonOrgAIReservationsParams,
) (sqlc.AbandonOrgAIReservationsRow, error) {
	s.cutoffs = append(s.cutoffs, params.ReservedBefore.Time)
	return s.abandoned[len(s.cutoffs)-1], nil
}

func (s *orgAIStub) DeleteExpiredOrgAIUsageTexts(
	context.Context, string,
) (int32, error) {
	count := s.deleted[0]
	s.deleted = s.deleted[1:]
	return count, nil
}

func orgAIWorker(stub *orgAIStub, now time.Time) *Worker {
	return &Worker{
		tenantID: "test",
		log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		orgAI: &orgAIJobs{
			queries: stub, reservationTimeout: 10 * time.Minute,
			now: func() time.Time { return now },
		},
	}
}

func TestGrantOrgAICreditsUsesTheContractEntitlements(t *testing.T) {
	t.Parallel()
	stub := &orgAIStub{grantRows: []sqlc.GrantOrgAICreditsRow{
		{GrantedCount: 100, AuditCount: 100}, {GrantedCount: 3, AuditCount: 3},
	}}
	if err := orgAIWorker(stub, time.Now()).grantOrgAICredits(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(stub.grants) != 2 {
		t.Fatalf("batches = %d, want 2", len(stub.grants))
	}
	params := stub.grants[0]
	if !slices.Equal(params.PlanOids, []string{"org-gold-tier"}) ||
		!slices.Equal(params.Credits, []int64{100_000}) || params.TenantID != "test" {
		t.Fatalf("params = %+v", params)
	}
}

func TestGrantOrgAICreditsRefusesUnauditedGrants(t *testing.T) {
	t.Parallel()
	stub := &orgAIStub{grantRows: []sqlc.GrantOrgAICreditsRow{
		{GrantedCount: 2, AuditCount: 1},
	}}
	if err := orgAIWorker(stub, time.Now()).grantOrgAICredits(context.Background()); err == nil {
		t.Fatal("an unaudited grant must fail the run")
	}
}

func TestAbandonOrgAIReservationsUsesTheTimeout(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	stub := &orgAIStub{abandoned: []sqlc.AbandonOrgAIReservationsRow{
		{AbandonedCount: 1, AuditCount: 1},
	}}
	if err := orgAIWorker(stub, now).abandonOrgAIReservations(context.Background()); err != nil {
		t.Fatal(err)
	}
	if want := now.Add(-10 * time.Minute); !stub.cutoffs[0].Equal(want) {
		t.Fatalf("cutoff = %v, want %v", stub.cutoffs[0], want)
	}
}

func TestDeleteOrgAIUsageTextsDrainsFullBatches(t *testing.T) {
	t.Parallel()
	stub := &orgAIStub{deleted: []int32{1000, 7}}
	if err := orgAIWorker(stub, time.Now()).deleteOrgAIUsageTexts(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(stub.deleted) != 0 {
		t.Fatal("a full batch must be followed by another")
	}
}
