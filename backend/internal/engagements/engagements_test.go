package engagements

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
	"backend/internal/federation/events"
)

func did(t *testing.T) pgtype.UUID {
	t.Helper()
	value, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func fields(t *testing.T) Fields {
	t.Helper()
	proposed := time.Date(2026, 10, 1, 8, 0, 0, 0, time.UTC)
	return Fields{
		EngagementID: did(t), Version: 3,
		ConsumerOrgDid: did(t), ConsumerDomain: "client.test", ConsumerDisplayName: "Client",
		ProviderOrgDid: did(t), ProviderDomain: "agency.test", ProviderDisplayName: "Agency",
		CapabilityOid: "sourcing", EngagementState: sqlc.VetchiumOrgEngagementStateEnded,
		Message:           pgtype.Text{String: "Hello", Valid: true},
		ConsumerReference: pgtype.Text{String: "PO-1", Valid: true},
		EndNote:           pgtype.Text{String: "Done", Valid: true},
		EndedBy: sqlc.NullVetchiumOrgEngagementParty{
			VetchiumOrgEngagementParty: sqlc.VetchiumOrgEngagementPartyProvider, Valid: true,
		},
		ProposedAt: pgtype.Timestamptz{Time: proposed, Valid: true},
		ExpiresAt:  pgtype.Timestamptz{Time: proposed.Add(marketplace.ProposalLifetime), Valid: true},
		DecidedAt:  pgtype.Timestamptz{Time: proposed.Add(time.Hour), Valid: true},
		EndedAt:    pgtype.Timestamptz{Time: proposed.Add(48 * time.Hour), Valid: true},
		UpdatedAt:  pgtype.Timestamptz{Time: proposed.Add(48 * time.Hour), Valid: true},
	}
}

func TestSnapshotCarriesEveryStoredFieldAndValidates(t *testing.T) {
	t.Parallel()
	row := fields(t)
	snapshot := Snapshot(row)
	if got := snapshot.Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	if snapshot.State != marketplace.EndedEngagement || snapshot.Version != 3 ||
		*snapshot.Message != "Hello" || *snapshot.ConsumerReference != "PO-1" ||
		snapshot.ProviderReference != nil || *snapshot.EndNote != "Done" ||
		*snapshot.EndedBy != marketplace.ProviderParty ||
		snapshot.DecidedAt == nil || snapshot.EndedAt == nil ||
		snapshot.Consumer.Domain != "client.test" || snapshot.Provider.DisplayName != "Agency" {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	row.DecidedAt, row.EndedAt, row.EndedBy = pgtype.Timestamptz{}, pgtype.Timestamptz{}, sqlc.NullVetchiumOrgEngagementParty{}
	bare := Snapshot(row)
	if bare.DecidedAt != nil || bare.EndedAt != nil || bare.EndedBy != nil {
		t.Fatalf("optional fields leaked: %+v", bare)
	}
}

func TestOriginAndInitiatorReadTheirOwnPrincipal(t *testing.T) {
	t.Parallel()
	consumer, provider := did(t), did(t)
	payload, err := json.Marshal(Snapshot(Fields{
		ConsumerOrgDid: consumer, ProviderOrgDid: provider,
	}))
	if err != nil {
		t.Fatal(err)
	}
	origin, ok := ConsumerOrigin(events.Event{Payload: payload})
	if !ok || origin.Type != directoryspec.PrincipalOrg || origin.DID != consumer {
		t.Fatalf("origin = %+v, %t", origin, ok)
	}
	if _, ok := ConsumerOrigin(events.Event{Payload: []byte(`{"consumer":{"org_did":"x"}}`)}); ok {
		t.Fatal("an invalid origin DID was accepted")
	}
	if _, ok := ConsumerOrigin(events.Event{Payload: []byte(`[`)}); ok {
		t.Fatal("a malformed payload named an origin")
	}
	command := commands.Command{Payload: []byte(`{"provider_org_did":"` + dbvalue.FormatUUID(provider) + `"}`)}
	principal, ok := Provider(command)
	if !ok || principal.Type != directoryspec.PrincipalOrg || principal.DID != provider {
		t.Fatalf("initiator = %+v, %t", principal, ok)
	}
	if _, ok := Provider(commands.Command{Payload: []byte(`{}`)}); ok {
		t.Fatal("a command without a provider named an initiator")
	}
}

func TestDecodeStrictRejectsWhatWillNeverSucceed(t *testing.T) {
	t.Parallel()
	good := federationspec.EngagementActorPayload{
		EngagementID: "01900000-0000-7000-8000-000000000003", Version: 1,
		ProviderOrgDID:      "01900000-0000-7000-8000-000000000002",
		ProviderDisplayName: "Agency", ActorDisplayName: "ada@agency.test",
	}
	encode := func(value any) json.RawMessage {
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	org := commands.Principal{Type: directoryspec.PrincipalOrg}
	tests := []struct {
		name    string
		command commands.Command
		reject  bool
	}{
		{"valid", commands.Command{Authority: org, Payload: encode(good)}, false},
		{"unknown field", commands.Command{Authority: org, Payload: json.RawMessage(`{"engagement_id":"x","extra":1}`)}, true},
		{"trailing data", commands.Command{Authority: org, Payload: append(encode(good), []byte(` {}`)...)}, true},
		{"hub authority", commands.Command{Authority: commands.Principal{Type: directoryspec.PrincipalHubUser}, Payload: encode(good)}, true},
		{"invalid fields", commands.Command{Authority: org, Payload: encode(federationspec.EngagementActorPayload{})}, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var body federationspec.EngagementActorPayload
			if got := commands.DecodeStrict(test.command, &body) != nil; got != test.reject {
				t.Fatalf("rejected = %t, want %t", got, test.reject)
			}
		})
	}
}

type standingQuerier struct {
	sqlc.Querier
	standing sqlc.GetOrgEngagementStandingRow
	err      error
}

func (s standingQuerier) GetOrgEngagementStanding(
	context.Context, pgtype.UUID,
) (sqlc.GetOrgEngagementStandingRow, error) {
	return s.standing, s.err
}

func TestRefusalNamesWhyAChangeMatchedNoRow(t *testing.T) {
	t.Parallel()
	id, consumer, provider, stranger := did(t), did(t), did(t), did(t)
	standing := sqlc.GetOrgEngagementStandingRow{
		ConsumerOrgDid: consumer, ProviderOrgDid: provider, Version: 4,
		EngagementState: sqlc.VetchiumOrgEngagementStateActive,
	}
	tests := []struct {
		name     string
		querier  standingQuerier
		consumer pgtype.UUID
		provider *pgtype.UUID
		version  int32
		want     string
	}{
		{"unknown", standingQuerier{err: pgx.ErrNoRows}, consumer, nil, 4, orgsproblem.EngagementNotFoundError.Type},
		{"another consumer", standingQuerier{standing: standing}, stranger, nil, 4, orgsproblem.EngagementNotFoundError.Type},
		{"another provider", standingQuerier{standing: standing}, consumer, &stranger, 4, orgsproblem.EngagementNotFoundError.Type},
		{"stale version", standingQuerier{standing: standing}, consumer, &provider, 3, orgsproblem.EngagementVersionConflictError.Type},
		{"state", standingQuerier{standing: standing}, consumer, &provider, 4, orgsproblem.EngagementStateConflictError.Type},
		{"consumer state", standingQuerier{standing: standing}, consumer, nil, 4, orgsproblem.EngagementStateConflictError.Type},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := Refusal(context.Background(), test.querier, id, test.consumer, test.provider, test.version)
			if err != nil || got.Type != test.want {
				t.Fatalf("refusal = %q, %v; want %q", got.Type, err, test.want)
			}
		})
	}
	if _, err := Refusal(context.Background(), standingQuerier{err: errors.New("down")}, id, consumer, nil, 1); err == nil {
		t.Fatal("a database error must not become a refusal")
	}
}

func TestAllStatesCannotBeChangedByTheCaller(t *testing.T) {
	t.Parallel()
	states := AllStates()
	if len(states) != len(marketplace.EngagementStates()) {
		t.Fatalf("states = %v", states)
	}
	states[0] = "tampered"
	if AllStates()[0] != string(marketplace.ProposedEngagement) {
		t.Fatal("AllStates exposes its backing array")
	}
}
