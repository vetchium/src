package federation

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/directory"
)

func validCommand() ExecuteCommandRequest {
	return ExecuteCommandRequest{
		CommandID:              "f4847331-5a4f-4eae-a5f4-cc131b0cd270",
		CorrelationID:          "0d3b2a35-5f1c-4f5e-9d47-0a5b7f2e9c11",
		Kind:                   "hub-apply-to-opening",
		AuthorityPrincipalType: directory.PrincipalOrg,
		AuthorityPrincipalDID:  "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
		AggregateID:            "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
		Payload:                json.RawMessage(`{"opening_number":7}`),
	}
}

func TestExecuteCommandRequestValidation(t *testing.T) {
	t.Parallel()
	if fields := validCommand().Validate(); len(fields) != 0 {
		t.Fatalf("valid command rejected: %v", fields)
	}
	for _, test := range []struct {
		name   string
		change func(*ExecuteCommandRequest)
		fields []string
	}{
		{"command id", func(r *ExecuteCommandRequest) { r.CommandID = "x" },
			[]string{"command_id"}},
		{"correlation id", func(r *ExecuteCommandRequest) { r.CorrelationID = "" },
			[]string{"correlation_id"}},
		{"kind syntax", func(r *ExecuteCommandRequest) { r.Kind = "Hub_Apply" },
			[]string{"kind"}},
		{"kind length", func(r *ExecuteCommandRequest) {
			r.Kind = CommandKind("a" + strings.Repeat("b", 100))
		}, []string{"kind"}},
		{"principal type", func(r *ExecuteCommandRequest) {
			r.AuthorityPrincipalType = "admin"
		}, []string{"authority_principal_type"}},
		{"principal did", func(r *ExecuteCommandRequest) {
			r.AuthorityPrincipalDID = "f4847331-5a4f-4eae-a5f4-cc131b0cd270"
		}, []string{"authority_principal_did"}},
		{"blank aggregate", func(r *ExecuteCommandRequest) { r.AggregateID = "  " },
			[]string{"aggregate_id"}},
		{"long aggregate", func(r *ExecuteCommandRequest) {
			r.AggregateID = strings.Repeat("é", 201)
		}, []string{"aggregate_id"}},
		{"array payload", func(r *ExecuteCommandRequest) {
			r.Payload = json.RawMessage(`[1]`)
		}, []string{"payload"}},
		{"missing payload", func(r *ExecuteCommandRequest) { r.Payload = nil },
			[]string{"payload"}},
		{"several", func(r *ExecuteCommandRequest) {
			r.CommandID = ""
			r.Payload = json.RawMessage(`null`)
		}, []string{"command_id", "payload"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := validCommand()
			test.change(&request)
			if got := request.Validate(); !slices.Equal(got, test.fields) {
				t.Fatalf("Validate() = %v, want %v", got, test.fields)
			}
		})
	}
}

func TestCommandResultAcceptsOnlyStoredOutcomes(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		result CommandResult
		valid  bool
	}{
		{CommandResult{200, json.RawMessage(`{"id":"x"}`)}, true},
		{CommandResult{409, json.RawMessage(`{"type":"t"}`)}, true},
		{CommandResult{302, json.RawMessage(`{}`)}, false},
		{CommandResult{500, json.RawMessage(`{}`)}, false},
		{CommandResult{200, nil}, false},
		{CommandResult{200, json.RawMessage(`{`)}, false},
	} {
		if got := IsCommandResult(test.result); got != test.valid {
			t.Errorf("IsCommandResult(%d, %s) = %t", test.result.Status,
				test.result.Body, got)
		}
	}
}
