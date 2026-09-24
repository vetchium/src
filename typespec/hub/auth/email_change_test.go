package auth

import (
	"slices"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func TestRequestEmailChangeRequest(t *testing.T) {
	t.Parallel()
	original := RequestEmailChangeRequest{
		NewEmailAddress: "  Person@Example.COM ",
	}
	normalized := original
	normalized.Normalize()
	if normalized.NewEmailAddress != "person@example.com" {
		t.Fatalf("normalized address = %q", normalized.NewEmailAddress)
	}
	if original.NewEmailAddress != "  Person@Example.COM " {
		t.Fatal("normalization changed the caller's request")
	}
	if got := normalized.Validate(); len(got) != 0 {
		t.Fatalf("valid address rejected: %v", got)
	}
	for _, address := range []common.EmailAddress{
		"", "not-an-address", "a@", "@b.c",
	} {
		request := RequestEmailChangeRequest{NewEmailAddress: address}
		if got := request.Validate(); !slices.Equal(
			got, []string{"new_email_address"},
		) {
			t.Errorf("address %q fields = %v", address, got)
		}
	}
}

func TestConfirmEmailChangeRequest(t *testing.T) {
	t.Parallel()
	invalid := ConfirmEmailChangeRequest{ChallengeID: "bad", Code: "12345a"}
	if got := invalid.Validate(); !slices.Equal(
		got, []string{"challenge_id", "code"},
	) {
		t.Fatalf("invalid fields = %v", got)
	}
	shortCode := ConfirmEmailChangeRequest{
		ChallengeID: "22222222-2222-4222-8222-222222222222",
		Code:        "12345",
	}
	if got := shortCode.Validate(); !slices.Equal(got, []string{"code"}) {
		t.Fatalf("short code fields = %v", got)
	}
	valid := ConfirmEmailChangeRequest{
		ChallengeID: "22222222-2222-4222-8222-222222222222",
		Code:        "000123",
	}
	if got := valid.Validate(); len(got) != 0 {
		t.Fatalf("valid request rejected: %v", got)
	}
}
