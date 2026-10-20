package commands

import (
	"bytes"
	"encoding/json"
	"io"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/problem"
)

// Payload is a command payload the authority can validate and normalize.
type Payload interface {
	Normalize()
	Validate() []string
}

// DecodeStrict parses command's payload into value: a malformed one will
// never succeed, so it is a deterministic rejection rather than a retried
// error. The authority must be an Org. It returns nil when value is valid.
func DecodeStrict(command Command, value Payload) *Result {
	reject := func(fields []string) *Result {
		details := problem.ValidationFailedError
		details.Fields = fields
		result := Rejected(details)
		return &result
	}
	decoder := json.NewDecoder(bytes.NewReader(command.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil ||
		decoder.Decode(&struct{}{}) != io.EOF {
		return reject([]string{"payload"})
	}
	if command.Authority.Type != directoryspec.PrincipalOrg {
		return reject([]string{"authority_principal_type"})
	}
	value.Normalize()
	if fields := value.Validate(); len(fields) > 0 {
		return reject(fields)
	}
	return nil
}
