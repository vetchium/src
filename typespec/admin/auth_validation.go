package admin

import (
	"net/mail"
	"strings"

	"github.com/vetchium/src/typespec/common"
)

// Normalized applies the normalization documented by LoginRequest before the
// request is validated or used for account lookup.
func (r LoginRequest) Normalized() LoginRequest {
	r.EmailAddress = common.EmailAddress(strings.ToLower(strings.TrimSpace(string(r.EmailAddress))))
	return r
}

// InvalidFields returns the JSON names of fields that violate the LoginRequest
// constraints, in schema order. JSON syntax, member types, and unknown members
// are handled by the transport decoder before this typed validation runs.
func (r LoginRequest) InvalidFields() []string {
	invalidFields := make([]string, 0, 2)
	emailAddress := string(r.EmailAddress)
	parsedEmail, err := mail.ParseAddress(emailAddress)
	if err != nil || parsedEmail.Address != emailAddress {
		invalidFields = append(invalidFields, "email_address")
	}
	if r.Password == "" {
		invalidFields = append(invalidFields, "password")
	}
	return invalidFields
}
