package profile

import (
	"slices"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func TestProfessionalEmailRequests(t *testing.T) {
	t.Parallel()
	list := ListProfessionalEmailsRequest{}
	if list.EffectiveLimit() != 10 || len(list.Validate()) != 0 {
		t.Fatal("default list limit must be ten")
	}
	badLimit := ProfessionalEmailPageSize(11)
	badKey := common.PaginationKey("")
	list.Limit = &badLimit
	list.PaginationKey = &badKey
	if got := list.Validate(); !slices.Equal(got, []string{
		"limit", "pagination_key",
	}) {
		t.Fatalf("list fields = %v", got)
	}

	add := AddProfessionalEmailRequest{
		EmailAddress: "  ALICE@EXAMPLE.COM  ",
	}
	copy := add
	copy.Normalize()
	if copy.EmailAddress != "alice@example.com" ||
		add.EmailAddress != "  ALICE@EXAMPLE.COM  " ||
		len(copy.Validate()) != 0 {
		t.Fatalf("add normalization = %+v, original = %+v", copy, add)
	}
	for _, email := range []common.EmailAddress{
		"alice@localhost", "alice@127.0.0.1", "bad-address",
	} {
		if len((AddProfessionalEmailRequest{EmailAddress: email}).Validate()) == 0 {
			t.Errorf("invalid professional address %q accepted", email)
		}
	}

	verify := VerifyProfessionalEmailRequest{
		ID:          "bad",
		ChallengeID: "also-bad",
		Code:        "12345a",
	}
	if got := verify.Validate(); !slices.Equal(got, []string{
		"id", "challenge_id", "code",
	}) {
		t.Fatalf("verify fields = %v", got)
	}
	verify.ID = "11111111-1111-4111-8111-111111111111"
	verify.ChallengeID = "22222222-2222-4222-8222-222222222222"
	verify.Code = "000123"
	if got := verify.Validate(); len(got) != 0 {
		t.Fatalf("valid six-digit code rejected: %v", got)
	}
}
