package admin

import (
	"slices"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func TestLoginRequestNormalizedAndValidated(t *testing.T) {
	request := LoginRequest{
		EmailAddress: common.EmailAddress(" ADMIN@example.com "),
		Password:     common.Password("password"),
	}.Normalized()

	if request.EmailAddress != "admin@example.com" {
		t.Fatalf("email_address = %q", request.EmailAddress)
	}
	if fields := request.InvalidFields(); len(fields) != 0 {
		t.Fatalf("invalid fields = %v, want none", fields)
	}
}

func TestLoginRequestInvalidFieldsFollowSchemaOrder(t *testing.T) {
	request := LoginRequest{
		EmailAddress: common.EmailAddress("not-an-email"),
	}.Normalized()

	if fields := request.InvalidFields(); !slices.Equal(fields, []string{"email_address", "password"}) {
		t.Fatalf("invalid fields = %v", fields)
	}
}
