// Package federation holds the wire types of durable commands between
// tenants.
package federation

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/directory"
)

type CommandKind string

var commandKindPattern = regexp.MustCompile(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)

func IsCommandKind(value CommandKind) bool {
	return len(value) <= 100 && commandKindPattern.MatchString(string(value))
}

type ExecuteCommandRequest struct {
	CommandID              directory.CommandID     `json:"command_id"`
	CorrelationID          directory.CommandID     `json:"correlation_id"`
	Kind                   CommandKind             `json:"kind"`
	AuthorityPrincipalType directory.PrincipalType `json:"authority_principal_type"`
	AuthorityPrincipalDID  directory.PrincipalDID  `json:"authority_principal_did"`
	AggregateID            string                  `json:"aggregate_id"`
	Payload                json.RawMessage         `json:"payload"`
}

func (r *ExecuteCommandRequest) Normalize() {}

func (r ExecuteCommandRequest) Validate() []string {
	fields := []string{}
	if !directory.IsCommandID(r.CommandID) {
		fields = append(fields, "command_id")
	}
	if !directory.IsCommandID(r.CorrelationID) {
		fields = append(fields, "correlation_id")
	}
	if !IsCommandKind(r.Kind) {
		fields = append(fields, "kind")
	}
	if !directory.IsPrincipalType(r.AuthorityPrincipalType) {
		fields = append(fields, "authority_principal_type")
	} else if !directory.IsPrincipal(
		r.AuthorityPrincipalType, r.AuthorityPrincipalDID,
	) {
		fields = append(fields, "authority_principal_did")
	}
	if length := utf8.RuneCountInString(r.AggregateID); length < 1 ||
		length > 200 || strings.TrimSpace(r.AggregateID) == "" {
		fields = append(fields, "aggregate_id")
	}
	if !IsJSONObject(r.Payload) {
		fields = append(fields, "payload")
	}
	return fields
}

// IsJSONObject reports whether value is one well-formed JSON object.
func IsJSONObject(value json.RawMessage) bool {
	trimmed := bytes.TrimSpace(value)
	return len(trimmed) > 0 && trimmed[0] == '{' && json.Valid(trimmed)
}

type CommandResult struct {
	Status int32           `json:"status"`
	Body   json.RawMessage `json:"body"`
}

// IsCommandResult accepts only the outcomes an authority stores: a success
// or a deterministic rejection, with a JSON body.
func IsCommandResult(result CommandResult) bool {
	return ((result.Status >= 200 && result.Status < 300) ||
		(result.Status >= 400 && result.Status < 500)) &&
		len(bytes.TrimSpace(result.Body)) > 0 && json.Valid(result.Body)
}
