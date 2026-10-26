package federation

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/directory"
)

func validEvent() DeliverEventRequest {
	return DeliverEventRequest{
		EventID:                  "f4847331-5a4f-4eae-a5f4-cc131b0cd270",
		Kind:                     "hub-application-projected",
		DestinationPrincipalType: directory.PrincipalHubUser,
		DestinationPrincipalDID:  "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
		AggregateType:            "org_application",
		AggregateID:              "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
		AggregateVersion:         3,
		Payload:                  json.RawMessage(`{"status":"applied"}`),
	}
}

func TestDeliverEventRequestValidation(t *testing.T) {
	t.Parallel()
	if fields := validEvent().Validate(); len(fields) != 0 {
		t.Fatalf("valid event rejected: %v", fields)
	}
	for _, test := range []struct {
		name   string
		change func(*DeliverEventRequest)
		fields []string
	}{
		{"event id", func(r *DeliverEventRequest) { r.EventID = "x" },
			[]string{"event_id"}},
		{"kind syntax", func(r *DeliverEventRequest) { r.Kind = "Hub_Event" },
			[]string{"kind"}},
		{"kind length", func(r *DeliverEventRequest) {
			r.Kind = EventKind("a" + strings.Repeat("b", 100))
		}, []string{"kind"}},
		{"principal type", func(r *DeliverEventRequest) {
			r.DestinationPrincipalType = "admin"
		}, []string{"destination_principal_type"}},
		{"principal did", func(r *DeliverEventRequest) {
			r.DestinationPrincipalDID = "f4847331-5a4f-4eae-a5f4-cc131b0cd270"
		}, []string{"destination_principal_did"}},
		{"aggregate type syntax", func(r *DeliverEventRequest) {
			r.AggregateType = "Org-Application"
		}, []string{"aggregate_type"}},
		{"aggregate type length", func(r *DeliverEventRequest) {
			r.AggregateType = AggregateType("a" + strings.Repeat("b", 100))
		}, []string{"aggregate_type"}},
		{"blank aggregate", func(r *DeliverEventRequest) { r.AggregateID = " " },
			[]string{"aggregate_id"}},
		{"long aggregate", func(r *DeliverEventRequest) {
			r.AggregateID = strings.Repeat("é", 201)
		}, []string{"aggregate_id"}},
		{"zero version", func(r *DeliverEventRequest) { r.AggregateVersion = 0 },
			[]string{"aggregate_version"}},
		{"negative version", func(r *DeliverEventRequest) {
			r.AggregateVersion = -1
		}, []string{"aggregate_version"}},
		{"array payload", func(r *DeliverEventRequest) {
			r.Payload = json.RawMessage(`[1]`)
		}, []string{"payload"}},
		{"missing payload", func(r *DeliverEventRequest) { r.Payload = nil },
			[]string{"payload"}},
		{"several", func(r *DeliverEventRequest) {
			r.EventID = ""
			r.AggregateVersion = 0
			r.Payload = nil
		}, []string{"event_id", "aggregate_version", "payload"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			request := validEvent()
			test.change(&request)
			if fields := request.Validate(); !slices.Equal(fields, test.fields) {
				t.Fatalf("fields = %v, want %v", fields, test.fields)
			}
		})
	}
}

func TestDeliverEventRequestNormalizeKeepsValues(t *testing.T) {
	t.Parallel()
	request := validEvent()
	request.Normalize()
	if fields := request.Validate(); len(fields) != 0 ||
		string(request.Payload) != `{"status":"applied"}` {
		t.Fatalf("normalized event = %+v", request)
	}
}

func TestEventDeliveryOutcomes(t *testing.T) {
	t.Parallel()
	for _, outcome := range []EventDeliveryOutcome{
		EventApplied, EventSuperseded, EventDuplicate,
	} {
		if !IsEventDeliveryOutcome(outcome) {
			t.Fatalf("%q rejected", outcome)
		}
	}
	if IsEventDeliveryOutcome("delivered") {
		t.Fatal("unknown outcome accepted")
	}
}
