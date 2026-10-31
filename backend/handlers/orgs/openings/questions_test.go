package openings

import (
	"slices"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/problem"
)

func TestWithQuestionIDsKeepsExistingAndAssignsNew(t *testing.T) {
	t.Parallel()
	existing := common.ApplicationQuestionID("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")
	source := common.OpeningContent{Questions: []common.ApplicationQuestion{
		{ID: &existing, Text: "Kept", Type: common.QuestionYesNo},
		{Text: "New", Type: common.QuestionYesNo},
	}}
	content, assigned, err := withQuestionIDs(source, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(assigned) != 1 || assigned[0] != string(*content.Questions[1].ID) {
		t.Fatalf("assigned = %v", assigned)
	}
	if source.Questions[1].ID != nil {
		t.Fatal("the caller's question changed")
	}
	if *content.Questions[0].ID != existing {
		t.Fatalf("existing id = %s", *content.Questions[0].ID)
	}
	if id := content.Questions[1].ID; id == nil || !common.IsApplicationQuestionID(*id) || *id == existing {
		t.Fatalf("new id = %v", id)
	}
	if empty, none, _ := withQuestionIDs(common.OpeningContent{}, time.Now()); empty.Questions != nil || none == nil {
		t.Fatal("content without questions gained some")
	}
}

func TestUnknownQuestionsNamesZeroBasedFields(t *testing.T) {
	t.Parallel()
	if details, err := unknownQuestions([]byte(`[]`)); err != nil || details != nil {
		t.Fatalf("details = %v, err = %v", details, err)
	}
	details, err := unknownQuestions([]byte(`[1, 3]`))
	if err != nil || details == nil || details.Type != problem.ValidationFailedError.Type ||
		!slices.Equal(details.Fields, []string{"content.questions.0.id", "content.questions.2.id"}) {
		t.Fatalf("details = %+v, err = %v", details, err)
	}
	if _, err := unknownQuestions([]byte(`{`)); err == nil {
		t.Fatal("malformed positions decoded")
	}
}
