package feedbackform

import (
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/hiring"
)

func criterionID(n int) hiring.FeedbackCriterionID {
	return hiring.FeedbackCriterionID("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5" + string(rune('0'+n)))
}

func form() []hiring.FeedbackCriterion {
	ids := []hiring.FeedbackCriterionID{criterionID(0), criterionID(1), criterionID(2)}
	return []hiring.FeedbackCriterion{
		{ID: &ids[0], Text: "Depth", Type: hiring.CriterionRating, Required: true},
		{ID: &ids[1], Text: "Hire again", Type: hiring.CriterionYesNo},
		{ID: &ids[2], Text: "Notes", Type: hiring.CriterionText},
	}
}

func answer(n int, value applications.AnswerValue) applications.CriterionAnswer {
	return applications.CriterionAnswer{CriterionID: criterionID(n), Value: value}
}

func TestCheckStoresEveryCriterionInOrder(t *testing.T) {
	t.Parallel()
	snapshot, invalid := Check(form(), []applications.CriterionAnswer{
		answer(2, applications.TextAnswer(strings.Repeat("界", applications.MaxCriterionTextValue))),
		answer(0, applications.NumberAnswer(5)),
	})
	if invalid != nil || len(snapshot) != 3 {
		t.Fatalf("snapshot = %+v, invalid = %v", snapshot, invalid)
	}
	if *snapshot[0].Answer.Number != 5 || snapshot[1].Answer != nil || snapshot[2].Answer == nil {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	if snapshot, invalid := Check(nil, nil); invalid != nil || snapshot == nil || len(snapshot) != 0 {
		t.Fatalf("no form: snapshot = %v, invalid = %v", snapshot, invalid)
	}
}

func TestCheckRefusals(t *testing.T) {
	t.Parallel()
	rated := answer(0, applications.NumberAnswer(3))
	unknown := hiring.FeedbackCriterionID("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a99")
	tests := []struct {
		name    string
		answers []applications.CriterionAnswer
		want    []hiring.FeedbackCriterionID
	}{
		{"required missing", nil, []hiring.FeedbackCriterionID{criterionID(0)}},
		{"rating below 1", []applications.CriterionAnswer{answer(0, applications.NumberAnswer(0))}, []hiring.FeedbackCriterionID{criterionID(0)}},
		{"rating above 5", []applications.CriterionAnswer{answer(0, applications.NumberAnswer(6))}, []hiring.FeedbackCriterionID{criterionID(0)}},
		{"rating as text", []applications.CriterionAnswer{answer(0, applications.TextAnswer("5"))}, []hiring.FeedbackCriterionID{criterionID(0)}},
		{"yes no as number", []applications.CriterionAnswer{rated, answer(1, applications.NumberAnswer(1))}, []hiring.FeedbackCriterionID{criterionID(1)}},
		{"text too long", []applications.CriterionAnswer{rated, answer(2, applications.TextAnswer(strings.Repeat("a", 2001)))}, []hiring.FeedbackCriterionID{criterionID(2)}},
		{"unknown id", []applications.CriterionAnswer{rated, {CriterionID: unknown, Value: applications.BooleanAnswer(true)}}, []hiring.FeedbackCriterionID{unknown}},
		{"repeated id", []applications.CriterionAnswer{rated, answer(1, applications.BooleanAnswer(true)), answer(1, applications.BooleanAnswer(false))}, []hiring.FeedbackCriterionID{criterionID(1)}},
		{"form order then strays", []applications.CriterionAnswer{
			{CriterionID: unknown, Value: applications.BooleanAnswer(true)},
			answer(1, applications.TextAnswer("yes")),
		}, []hiring.FeedbackCriterionID{criterionID(0), criterionID(1), unknown}},
	}
	for _, test := range tests {
		snapshot, invalid := Check(form(), test.answers)
		if snapshot != nil || !slices.Equal(invalid, test.want) {
			t.Errorf("%s: snapshot = %v, invalid = %v, want %v", test.name, snapshot, invalid, test.want)
		}
	}
	// A blank text answer is no answer, which an optional criterion allows.
	if _, invalid := Check(form(), []applications.CriterionAnswer{rated, answer(2, applications.TextAnswer(""))}); invalid != nil {
		t.Fatalf("blank optional text refused: %v", invalid)
	}
}

func TestJudgeComparesTextAndType(t *testing.T) {
	t.Parallel()
	live := form()
	live[0].Required = false
	live[1].Text = "Hire them again"
	asked := make([]applications.AnsweredCriterion, 3)
	for index, criterion := range form() {
		asked[index] = applications.AnsweredCriterion{FeedbackCriterion: criterion}
	}
	Judge(asked, live[:2])
	got := []applications.AnswerCurrency{asked[0].Current, asked[1].Current, asked[2].Current}
	want := []applications.AnswerCurrency{applications.AnswerSame, applications.AnswerChanged, applications.AnswerRemoved}
	if !slices.Equal(got, want) {
		t.Fatalf("currency = %v, want %v", got, want)
	}
}
