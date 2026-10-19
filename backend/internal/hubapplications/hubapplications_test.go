package hubapplications

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	hubspec "github.com/vetchium/src/typespec/hub/applications"
	"github.com/vetchium/src/typespec/orgs"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/commands"
	"backend/internal/federation/events"
)

func TestStatusDerivesTheHubViewOfEveryState(t *testing.T) {
	t.Parallel()
	interview := sqlc.NullVetchiumPipelineStageKind{
		VetchiumPipelineStageKind: sqlc.VetchiumPipelineStageKindInterview,
		Valid:                     true,
	}
	review := sqlc.NullVetchiumPipelineStageKind{
		VetchiumPipelineStageKind: sqlc.VetchiumPipelineStageKindReview,
		Valid:                     true,
	}
	none := sqlc.NullVetchiumPipelineStageKind{}
	for _, test := range []struct {
		state sqlc.VetchiumOrgApplicationState
		stage sqlc.NullVetchiumPipelineStageKind
		want  hubspec.ApplicationStatus
	}{
		{sqlc.VetchiumOrgApplicationStateSubmitted, none, hubspec.Applied},
		{sqlc.VetchiumOrgApplicationStateInPipeline, review, hubspec.InReview},
		{sqlc.VetchiumOrgApplicationStateInPipeline, interview, hubspec.Interviewing},
		{sqlc.VetchiumOrgApplicationStateOffered, interview, hubspec.Offer},
		{sqlc.VetchiumOrgApplicationStateOfferAccepted, review, hubspec.Offer},
		{sqlc.VetchiumOrgApplicationStateJoined, none, hubspec.Hired},
		{sqlc.VetchiumOrgApplicationStateNotProgressing, none, hubspec.NotProgressing},
		{sqlc.VetchiumOrgApplicationStateOfferDeclined, none, hubspec.NotProgressing},
		{sqlc.VetchiumOrgApplicationStateDidNotJoin, none, hubspec.NotProgressing},
		{sqlc.VetchiumOrgApplicationStateWithdrawn, interview, hubspec.Withdrawn},
	} {
		got, err := Status(test.state, test.stage)
		if err != nil || got != test.want {
			t.Errorf("Status(%s, %v) = %q, %v; want %q", test.state,
				test.stage, got, err, test.want)
		}
	}
	if _, err := Status("archived", none); err == nil {
		t.Fatal("an unknown state was given a status")
	}
}

func TestApplicantIsThePayloadsHubUser(t *testing.T) {
	t.Parallel()
	did, err := dbvalue.NewUUIDv7(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]any{
		"applicant_did": dbvalue.FormatUUID(did), "opening_number": 1,
	})
	principal, ok := Applicant(commands.Command{Payload: payload})
	if !ok || principal.Type != directoryspec.PrincipalHubUser ||
		principal.DID != did {
		t.Fatalf("Applicant = %+v, %t", principal, ok)
	}
	for _, payload := range []string{`{}`, `{"applicant_did":"x"}`, `[]`} {
		if _, ok := Applicant(commands.Command{
			Payload: json.RawMessage(payload),
		}); ok {
			t.Errorf("Applicant(%s) found an initiator", payload)
		}
	}
}

// Project refuses an event that breaks the contract before writing, so the
// receiver rolls back and the event is redelivered.
func TestProjectRefusesAnEventThatBreaksTheContract(t *testing.T) {
	t.Parallel()
	did, _ := dbvalue.NewUUIDv7(time.Now())
	orgDID, _ := dbvalue.NewUUIDv7(time.Now())
	valid := federationspec.HubApplicationChangedPayload{
		OrgDID:    orgs.OrgDID(dbvalue.FormatUUID(orgDID)),
		OrgDomain: "example.com", OrgDisplayName: "Example",
		OpeningNumber: 1, OpeningTitle: "Engineer", ApplicationNumber: 2,
		Status: hubspec.Applied, PendingActions: []hubspec.PendingActionKind{},
		AppliedAt: time.Now(), LastActivityAt: time.Now(),
	}
	event := func(change func(*events.Event, *federationspec.HubApplicationChangedPayload)) events.Event {
		payload := valid
		e := events.Event{
			Kind:             federationspec.HubApplicationChangedKind,
			Destination:      events.Principal{Type: directoryspec.PrincipalHubUser, DID: did},
			AggregateType:    federationspec.OrgApplicationAggregate,
			AggregateID:      AggregateID(orgDID, 1, 2),
			AggregateVersion: 1,
		}
		change(&e, &payload)
		e.Payload, _ = json.Marshal(payload)
		return e
	}
	for name, change := range map[string]func(*events.Event, *federationspec.HubApplicationChangedPayload){
		"Org destination": func(e *events.Event, _ *federationspec.HubApplicationChangedPayload) {
			e.Destination.Type = directoryspec.PrincipalOrg
		},
		"other aggregate type": func(e *events.Event, _ *federationspec.HubApplicationChangedPayload) {
			e.AggregateType = "org_opening"
		},
		"aggregate id of another application": func(e *events.Event, _ *federationspec.HubApplicationChangedPayload) {
			e.AggregateID = AggregateID(orgDID, 1, 3)
		},
		"unknown status": func(_ *events.Event, p *federationspec.HubApplicationChangedPayload) {
			p.Status = "archived"
		},
		"null pending actions": func(_ *events.Event, p *federationspec.HubApplicationChangedPayload) {
			p.PendingActions = nil
		},
	} {
		if err := Project(context.Background(), nil, event(change)); err == nil {
			t.Errorf("%s: projected", name)
		}
	}
	extra := event(func(*events.Event, *federationspec.HubApplicationChangedPayload) {})
	extra.Payload = append(extra.Payload[:len(extra.Payload)-1],
		[]byte(`,"stage_name":"Panel"}`)...)
	if err := Project(context.Background(), nil, extra); err == nil {
		t.Fatal("an unknown field was projected")
	}
}
