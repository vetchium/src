package billingdb

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/orgs/billing"
)

type fakeEffects struct {
	candidates []sqlc.ListOrgKeepCandidatesRow
	enforced   []sqlc.EnforceOrgDeadlineParams
	emails     []string
}

func (f *fakeEffects) ListOrgKeepCandidates(
	context.Context, sqlc.ListOrgKeepCandidatesParams,
) ([]sqlc.ListOrgKeepCandidatesRow, error) {
	return f.candidates, nil
}

func (f *fakeEffects) EnforceOrgDeadline(
	_ context.Context, arg sqlc.EnforceOrgDeadlineParams,
) (sqlc.EnforceOrgDeadlineRow, error) {
	f.enforced = append(f.enforced, arg)
	return sqlc.EnforceOrgDeadlineRow{}, nil
}

func (f *fakeEffects) QueueOrgBillingHolderEmail(
	_ context.Context, arg sqlc.QueueOrgBillingHolderEmailParams,
) (int64, error) {
	f.emails = append(f.emails, arg.Kind)
	return 1, nil
}

func newUUID(t *testing.T) pgtype.UUID {
	t.Helper()
	id, err := dbvalue.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// A request that reaches the deadline before the worker must disable the
// users beyond the keep set exactly as the worker would, credited to the
// request's system actor.
func TestApplyEffectsEnforcesADeadlineARequestPersisted(t *testing.T) {
	t.Parallel()
	joined := time.Date(2027, time.January, 1, 0, 0, 0, 0, time.UTC)
	fake := &fakeEffects{}
	for index := range 7 {
		fake.candidates = append(fake.candidates, sqlc.ListOrgKeepCandidatesRow{
			OrgUserID:  newUUID(t),
			CreatedAt:  dbvalue.Timestamp(joined.Add(time.Duration(index) * time.Hour)),
			Superadmin: index == 6,
		})
	}
	result, err := ApplyEffects(context.Background(), fake, Effects{
		OrgDID:      newUUID(t),
		Domain:      "example.com",
		Advanced:    billing.State{Plan: subscriptionspec.FreeTier},
		Transitions: []billing.Transition{{Kind: billing.KindDeadlineEnforced}},
		TenantID:    "sgp",
		Actor:       billing.SystemRenewalActor,
		Source:      billing.SourceOrgsAPI,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Enforced || result.DisabledUsers != 2 || len(fake.enforced) != 1 {
		t.Fatalf("result = %+v, enforced = %d", result, len(fake.enforced))
	}
	enforced := fake.enforced[0]
	if enforced.ActorType != "system" || enforced.ActorID != "subscription-renewal" ||
		enforced.Source != "orgs-api" {
		t.Fatalf("actor = %s/%s from %s", enforced.ActorType, enforced.ActorID, enforced.Source)
	}
	superadmin := fake.candidates[6].OrgUserID
	for _, id := range enforced.DisableOrgUserIds {
		if id == superadmin {
			t.Fatal("the only superadmin was disabled")
		}
	}
	if len(fake.emails) != 1 || fake.emails[0] != "moved-to-free" {
		t.Fatalf("emails = %v", fake.emails)
	}
}

func TestApplyEffectsWarnsBillingHoldersOfAFailedCharge(t *testing.T) {
	t.Parallel()
	open := &billing.Invoice{DueAt: time.Date(2027, time.February, 15, 0, 0, 0, 0, time.UTC)}
	failed := billing.Transition{
		Kind:    billing.KindRenewalFailed,
		Invoice: &billing.InvoiceChange{Op: billing.InvoiceCreate},
	}
	cases := []struct {
		name     string
		advanced billing.State
		want     []string
	}{
		{"still past due", billing.State{Open: open}, []string{"payment-failed"}},
		// A later retry in the same advancement settled the invoice.
		{"settled since", billing.State{}, nil},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			fake := &fakeEffects{}
			result, err := ApplyEffects(context.Background(), fake, Effects{
				OrgDID:      newUUID(t),
				Advanced:    testCase.advanced,
				Transitions: []billing.Transition{failed},
			})
			if err != nil {
				t.Fatal(err)
			}
			if result.Enforced || len(fake.enforced) != 0 ||
				len(fake.emails) != len(testCase.want) {
				t.Fatalf("result = %+v, emails = %v", result, fake.emails)
			}
		})
	}
}
