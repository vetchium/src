package hubapplications

import (
	"context"
	"encoding/json"
	"slices"
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

func TestPendingActionsAskForWhatAwaitsTheApplicant(t *testing.T) {
	t.Parallel()
	for _, state := range []sqlc.VetchiumOrgApplicationState{
		sqlc.VetchiumOrgApplicationStateSubmitted,
		sqlc.VetchiumOrgApplicationStateInPipeline,
		sqlc.VetchiumOrgApplicationStateOffered,
		sqlc.VetchiumOrgApplicationStateOfferAccepted,
		sqlc.VetchiumOrgApplicationStateOfferDeclined,
	} {
		for _, open := range []bool{false, true} {
			for _, interview := range []bool{false, true} {
				for _, consent := range []bool{false, true} {
					got := PendingActions(state, open, interview, consent)
					want := []hubspec.PendingActionKind{}
					if interview {
						want = append(want, hubspec.InterviewResponse)
					}
					if consent {
						want = append(want, hubspec.BackgroundCheckConsent)
					}
					if state == sqlc.VetchiumOrgApplicationStateOffered && open {
						want = append(want, hubspec.OfferResponse)
					}
					if got == nil || !slices.Equal(got, want) {
						t.Errorf("PendingActions(%s, %v, %v, %v) = %v",
							state, open, interview, consent, got)
					}
				}
			}
		}
	}
}

func TestOrgOriginIsThePayloadsOrg(t *testing.T) {
	t.Parallel()
	orgDID, _ := dbvalue.NewUUIDv7(time.Now())
	origin, ok := OrgOrigin(events.Event{Payload: []byte(
		`{"org_did":"` + dbvalue.FormatUUID(orgDID) + `"}`)})
	if !ok || origin.Type != directoryspec.PrincipalOrg || origin.DID != orgDID {
		t.Fatalf("origin = %+v, %v", origin, ok)
	}
	for _, payload := range []string{`{}`, `{"org_did":"x"}`, `[`} {
		if _, ok := OrgOrigin(events.Event{Payload: []byte(payload)}); ok {
			t.Errorf("origin found in %s", payload)
		}
	}
}

func TestNoticeForMapsOrgActionsToEmails(t *testing.T) {
	t.Parallel()
	for action, want := range map[sqlc.VetchiumOrgApplicationHistoryAction]federationspec.ApplicationNotice{
		sqlc.VetchiumOrgApplicationHistoryActionInterviewScheduled:              federationspec.NoticeInterviewScheduled,
		sqlc.VetchiumOrgApplicationHistoryActionInterviewChanged:                federationspec.NoticeInterviewChanged,
		sqlc.VetchiumOrgApplicationHistoryActionInterviewCancelled:              federationspec.NoticeInterviewCancelled,
		sqlc.VetchiumOrgApplicationHistoryActionBackgroundCheckConsentRequested: federationspec.NoticeConsentRequested,
		sqlc.VetchiumOrgApplicationHistoryActionOfferExtended:                   federationspec.NoticeOfferExtended,
		sqlc.VetchiumOrgApplicationHistoryActionOfferWithdrawn:                  federationspec.NoticeOfferWithdrawn,
		sqlc.VetchiumOrgApplicationHistoryActionShortlisted:                     federationspec.NoticeStatusChanged,
		sqlc.VetchiumOrgApplicationHistoryActionNotProgressing:                  federationspec.NoticeStatusChanged,
		sqlc.VetchiumOrgApplicationHistoryActionAssessmentRecorded:              federationspec.NoticeStatusChanged,
	} {
		if got := NoticeFor(action); got != want {
			t.Errorf("NoticeFor(%s) = %q, want %q", action, got, want)
		}
		if !federationspec.IsApplicationNotice(NoticeFor(action)) {
			t.Errorf("NoticeFor(%s) is not a contract notice", action)
		}
	}
}

func TestNotifiesOnlyForRealChangesTheApplicantDidNotCause(t *testing.T) {
	t.Parallel()
	status := func(notice federationspec.ApplicationNotice, status hubspec.ApplicationStatus) federationspec.HubApplicationChangedPayload {
		return federationspec.HubApplicationChangedPayload{
			Notice: notice, Status: status,
		}
	}
	for _, test := range []struct {
		name     string
		payload  federationspec.HubApplicationChangedPayload
		known    bool
		previous string
		want     bool
	}{
		{"no notice", status("", hubspec.InReview), true, "applied", false},
		{"status changed", status(federationspec.NoticeStatusChanged, hubspec.InReview), true, "applied", true},
		{"status repeated", status(federationspec.NoticeStatusChanged, hubspec.InReview), true, "in_review", false},
		{"first projection", status(federationspec.NoticeStatusChanged, hubspec.InReview), false, "", false},
		{"withdrawn", status(federationspec.NoticeStatusChanged, hubspec.Withdrawn), true, "applied", false},
		{"interview", status(federationspec.NoticeInterviewScheduled, hubspec.Interviewing), true, "interviewing", true},
		{"offer expiring", status(federationspec.NoticeOfferExpiring, hubspec.Offer), true, "offer", true},
	} {
		if got := notifies(test.payload, test.known, test.previous); got != test.want {
			t.Errorf("%s: notifies = %v, want %v", test.name, got, test.want)
		}
	}
}
