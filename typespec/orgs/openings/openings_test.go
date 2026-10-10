package openings

import (
	"slices"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func TestCreateOpeningNormalizesWithoutMutatingSharedValues(t *testing.T) {
	t.Parallel()
	manager := common.EmailAddress(" MANAGER@EXAMPLE.COM ")
	title := "  Engineer  "
	addresses := []common.EmailAddress{" PERSON@EXAMPLE.COM "}
	request := CreateOpeningRequest{
		Content:            &common.OpeningContent{Title: &title},
		HiringManagerEmail: &manager,
		TeamMemberEmails:   addresses,
	}
	request.Normalize()
	if *request.HiringManagerEmail != "manager@example.com" ||
		*request.Content.Title != "Engineer" ||
		!slices.Equal(request.TeamMemberEmails, []common.EmailAddress{"person@example.com"}) {
		t.Fatalf("unexpected normalized request: %+v", request)
	}
	if manager != " MANAGER@EXAMPLE.COM " || title != "  Engineer  " ||
		addresses[0] != " PERSON@EXAMPLE.COM " {
		t.Fatal("normalization mutated caller-owned values")
	}
}

func TestOpeningRequestValidation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		fields []string
		want   []string
	}{
		{"empty team allowed", CreateOpeningRequest{Content: &common.OpeningContent{}, TeamMemberEmails: []common.EmailAddress{}}.Validate(), []string{}},
		{"missing content and team rejected", CreateOpeningRequest{}.Validate(), []string{"content", "team_member_emails"}},
		{"duplicate team rejected", CreateOpeningRequest{Content: &common.OpeningContent{}, TeamMemberEmails: []common.EmailAddress{"a@example.com", "a@example.com"}}.Validate(), []string{"team_member_emails"}},
		{"invalid version", DiscardOpeningRequest{OpeningNumber: 1}.Validate(), []string{"version"}},
		{"invalid number", GetOpeningRequest{}.Validate(), []string{"opening_number"}},
		{"empty state filter", ListOpeningsRequest{States: []OpeningState{}}.Validate(), []string{"states"}},
		{"duplicate state filter", ListOpeningsRequest{States: []OpeningState{Draft, Draft}}.Validate(), []string{"states"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !slices.Equal(test.fields, test.want) {
				t.Fatalf("fields = %v, want %v", test.fields, test.want)
			}
		})
	}
}
