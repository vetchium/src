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
	existingQuestion := common.ApplicationQuestionID("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")
	malformedQuestion := common.ApplicationQuestionID("not-a-uuid")
	tests := []struct {
		name   string
		fields []string
		want   []string
	}{
		{"empty team allowed", CreateOpeningRequest{Content: &common.OpeningContent{}, TeamMemberEmails: []common.EmailAddress{}}.Validate(), []string{}},
		{"missing content and team rejected", CreateOpeningRequest{}.Validate(), []string{"content", "team_member_emails"}},
		{"create refuses a question id", CreateOpeningRequest{Content: &common.OpeningContent{Questions: []common.ApplicationQuestion{
			{Text: "New", Type: common.QuestionYesNo},
			{ID: &existingQuestion, Text: "Old", Type: common.QuestionYesNo},
		}}, TeamMemberEmails: []common.EmailAddress{}}.Validate(), []string{"content.questions.1.id"}},
		{"create names a malformed question id once", CreateOpeningRequest{Content: &common.OpeningContent{Questions: []common.ApplicationQuestion{
			{ID: &malformedQuestion, Text: "Old", Type: common.QuestionYesNo},
		}}, TeamMemberEmails: []common.EmailAddress{}}.Validate(), []string{"content.questions.0.id"}},
		{"duplicate team rejected", CreateOpeningRequest{Content: &common.OpeningContent{}, TeamMemberEmails: []common.EmailAddress{"a@example.com", "a@example.com"}}.Validate(), []string{"team_member_emails"}},
		{"invalid version", DiscardOpeningRequest{OpeningNumber: 1}.Validate(), []string{"version"}},
		{"invalid number", GetOpeningRequest{}.Validate(), []string{"opening_number"}},
		{"invalid team lookup email", LookupOpeningTeamMemberRequest{EmailAddress: "not-an-email"}.Validate(), []string{"email_address"}},
		{"empty state filter", ListOpeningsRequest{States: []OpeningState{}}.Validate(), []string{"states"}},
		{"duplicate state filter", ListOpeningsRequest{States: []OpeningState{Draft, Draft}}.Validate(), []string{"states"}},
		{"duplicate request kind filter", ListOpeningsRequest{PendingRequestKinds: []OpeningRequestKind{PauseRequest, PauseRequest}}.Validate(), []string{"pending_request_kinds"}},
		{"unknown request kind", RequestOpeningChangeRequest{OpeningNumber: 1, Version: 1}.Validate(), []string{"kind"}},
		{"missing rejection note", DecideOpeningRequestRequest{OpeningNumber: 1, Version: 1, Decision: RejectDecision}.Validate(), []string{"note"}},
		{"approval needs no note", DecideOpeningRequestRequest{OpeningNumber: 1, Version: 1, Decision: ApproveDecision}.Validate(), []string{}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !slices.Equal(test.fields, test.want) {
				t.Fatalf("fields = %v, want %v", test.fields, test.want)
			}
		})
	}
}

func TestLookupOpeningTeamMemberNormalizes(t *testing.T) {
	t.Parallel()
	request := LookupOpeningTeamMemberRequest{EmailAddress: " MEMBER@EXAMPLE.COM "}
	request.Normalize()
	if request.EmailAddress != "member@example.com" {
		t.Fatalf("normalized email = %q", request.EmailAddress)
	}
}
