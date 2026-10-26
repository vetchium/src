package federation

import (
	"encoding/json"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/directory"
)

type EventKind string

func IsEventKind(value EventKind) bool {
	return len(value) <= 100 && commandKindPattern.MatchString(string(value))
}

type EventID string

func IsEventID(value EventID) bool {
	return directory.IsCommandID(directory.CommandID(value))
}

type AggregateType string

var aggregateTypePattern = regexp.MustCompile(`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`)

func IsAggregateType(value AggregateType) bool {
	return len(value) <= 100 && aggregateTypePattern.MatchString(string(value))
}

// IsAggregateID accepts 1 to 200 characters that are not all whitespace.
func IsAggregateID(value string) bool {
	length := utf8.RuneCountInString(value)
	return length >= 1 && length <= 200 && strings.TrimSpace(value) != ""
}

type DeliverEventRequest struct {
	EventID                  EventID                 `json:"event_id"`
	Kind                     EventKind               `json:"kind"`
	DestinationPrincipalType directory.PrincipalType `json:"destination_principal_type"`
	DestinationPrincipalDID  directory.PrincipalDID  `json:"destination_principal_did"`
	AggregateType            AggregateType           `json:"aggregate_type"`
	AggregateID              string                  `json:"aggregate_id"`
	AggregateVersion         int64                   `json:"aggregate_version"`
	Payload                  json.RawMessage         `json:"payload"`
}

func (r *DeliverEventRequest) Normalize() {}

func (r DeliverEventRequest) Validate() []string {
	fields := []string{}
	if !IsEventID(r.EventID) {
		fields = append(fields, "event_id")
	}
	if !IsEventKind(r.Kind) {
		fields = append(fields, "kind")
	}
	if !directory.IsPrincipalType(r.DestinationPrincipalType) {
		fields = append(fields, "destination_principal_type")
	} else if !directory.IsPrincipal(
		r.DestinationPrincipalType, r.DestinationPrincipalDID,
	) {
		fields = append(fields, "destination_principal_did")
	}
	if !IsAggregateType(r.AggregateType) {
		fields = append(fields, "aggregate_type")
	}
	if !IsAggregateID(r.AggregateID) {
		fields = append(fields, "aggregate_id")
	}
	if r.AggregateVersion < 1 {
		fields = append(fields, "aggregate_version")
	}
	if !IsJSONObject(r.Payload) {
		fields = append(fields, "payload")
	}
	return fields
}

type EventDeliveryOutcome string

const (
	EventApplied    EventDeliveryOutcome = "applied"
	EventSuperseded EventDeliveryOutcome = "superseded"
	EventDuplicate  EventDeliveryOutcome = "duplicate"
)

func IsEventDeliveryOutcome(value EventDeliveryOutcome) bool {
	switch value {
	case EventApplied, EventSuperseded, EventDuplicate:
		return true
	default:
		return false
	}
}

type EventReceipt struct {
	Outcome EventDeliveryOutcome `json:"outcome"`
}
