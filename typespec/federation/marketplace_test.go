package federation

import (
	"slices"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/orgs/marketplace"
)

const (
	consumerDID = "01900000-0000-7000-8000-000000000001"
	providerDID = "01900000-0000-7000-8000-000000000002"
)

func snapshot() EngagementSnapshot {
	proposed := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	return EngagementSnapshot{
		EngagementID: "01900000-0000-7000-8000-000000000003", Version: 1,
		Consumer:   EngagementSnapshotOrg{OrgDID: consumerDID, Domain: "client.test", DisplayName: "Client"},
		Provider:   EngagementSnapshotOrg{OrgDID: providerDID, Domain: "agency.test", DisplayName: "Agency"},
		Capability: marketplace.Sourcing, State: marketplace.ProposedEngagement,
		ProposedAt: proposed, ExpiresAt: proposed.Add(marketplace.ProposalLifetime),
		UpdatedAt: proposed,
	}
}

func TestEngagementKinds(t *testing.T) {
	t.Parallel()
	for _, kind := range []CommandKind{
		EngagementAcceptKind, EngagementDeclineKind, EngagementEndKind, EngagementSetReferenceKind,
	} {
		if !IsCommandKind(kind) {
			t.Errorf("%q is not a command kind", kind)
		}
	}
	if !IsEventKind(EngagementChangedKind) || !IsAggregateType(EngagementAggregate) {
		t.Fatal("engagement event kind or aggregate is invalid")
	}
}

func TestEngagementSnapshotValidation(t *testing.T) {
	t.Parallel()
	if got := snapshot().Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	bad := snapshot()
	bad.Version = 0
	bad.Provider.OrgDID = bad.Consumer.OrgDID
	bad.Provider.Domain = "x"
	bad.State = "paused"
	bad.ExpiresAt = bad.ProposedAt
	want := []string{"version", "provider.domain", "provider.org_did", "state", "expires_at"}
	got := bad.Validate()
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
}

func TestEngagementViewSwapsTheCounterparty(t *testing.T) {
	t.Parallel()
	value := snapshot()
	reference := "PO-1"
	value.ConsumerReference = &reference
	decided := value.ProposedAt.Add(time.Hour)
	value.DecidedAt = &decided
	consumer := value.ViewFor(marketplace.ConsumerParty)
	provider := value.ViewFor(marketplace.ProviderParty)
	if consumer.Counterparty.Domain != "agency.test" || provider.Counterparty.Domain != "client.test" {
		t.Fatalf("counterparties = %+v / %+v", consumer.Counterparty, provider.Counterparty)
	}
	for _, view := range []marketplace.Engagement{consumer, provider} {
		if *view.ConsumerReference != "PO-1" || view.ProviderReference != nil ||
			view.DecidedAt == nil || !view.DecidedAt.Equal(decided) {
			t.Fatalf("view = %+v", view)
		}
	}
}

func TestEngagementPayloadValidation(t *testing.T) {
	t.Parallel()
	actor := EngagementActorPayload{
		EngagementID: "01900000-0000-7000-8000-000000000003", Version: 2,
		ProviderOrgDID: providerDID, ProviderDisplayName: "  Agency ", ActorDisplayName: " Ada ",
	}
	copied := actor
	copied.Normalize()
	if copied.ProviderDisplayName != "Agency" || copied.ActorDisplayName != "Ada" || actor.ActorDisplayName != " Ada " {
		t.Fatalf("normalized = %+v", copied)
	}
	if got := copied.Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	bad := EngagementActorPayload{ProviderOrgDID: "x"}
	want := []string{"engagement_id", "version", "provider_org_did", "provider_display_name", "actor_display_name"}
	if got := bad.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
	long := make([]rune, 2001)
	for i := range long {
		long[i] = 'a'
	}
	note, reference := string(long), string(long[:201])
	end := EngagementEndPayload{EngagementActorPayload: copied, Note: &note}
	if got := end.Validate(); !slices.Equal(got, []string{"note"}) {
		t.Fatalf("end fields = %v", got)
	}
	ref := EngagementReferencePayload{EngagementActorPayload: copied, Reference: &reference}
	if got := ref.Validate(); !slices.Equal(got, []string{"reference"}) {
		t.Fatalf("reference fields = %v", got)
	}
	ref.Reference = nil
	if got := ref.Validate(); len(got) != 0 {
		t.Fatalf("clearing a reference must be valid: %v", got)
	}
}
