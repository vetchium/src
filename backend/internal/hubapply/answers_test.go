package hubapply

import (
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/applications"
)

func questionID(n int) common.ApplicationQuestionID {
	return common.ApplicationQuestionID("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5" + string(rune('0'+n)))
}

func liveQuestions() []common.ApplicationQuestion {
	ids := make([]common.ApplicationQuestionID, 6)
	for index := range ids {
		ids[index] = questionID(index)
	}
	low, high := int64(2), int64(10)
	return []common.ApplicationQuestion{
		{ID: &ids[0], Text: "Role", Type: common.QuestionShortText, Required: true},
		{ID: &ids[1], Text: "Why", Type: common.QuestionLongText},
		{ID: &ids[2], Text: "Years", Type: common.QuestionNumber, Required: true, Min: &low, Max: &high},
		{ID: &ids[3], Text: "Permit", Type: common.QuestionYesNo},
		{ID: &ids[4], Text: "Office", Type: common.QuestionSingleChoice, Options: []string{"Berlin", "Munich"}},
		{ID: &ids[5], Text: "Languages", Type: common.QuestionMultipleChoice, Options: []string{"de", "en", "ta"}},
	}
}

func answer(n int, value applications.AnswerValue) applications.ApplicationAnswer {
	return applications.ApplicationAnswer{QuestionID: questionID(n), Value: value}
}

func TestValidateAnswersStoresEveryQuestionInOrder(t *testing.T) {
	t.Parallel()
	snapshot, invalid := ValidateAnswers(liveQuestions(), []applications.ApplicationAnswer{
		answer(5, applications.OptionsAnswer("ta", "de")),
		answer(2, applications.NumberAnswer(10)),
		answer(0, applications.TextAnswer(strings.Repeat("界", applications.MaxShortTextAnswer))),
		answer(1, applications.TextAnswer("")),
		answer(3, applications.BooleanAnswer(false)),
	})
	if invalid != nil || len(snapshot) != 6 {
		t.Fatalf("snapshot = %+v, invalid = %v", snapshot, invalid)
	}
	for index, entry := range snapshot {
		if *entry.ID != questionID(index) {
			t.Fatalf("entry %d is %s", index, *entry.ID)
		}
	}
	if snapshot[1].Answer != nil || snapshot[4].Answer != nil {
		t.Fatal("a blank or missing optional answer was stored")
	}
	if *snapshot[2].Answer.Number != 10 || *snapshot[3].Answer.Boolean ||
		!slices.Equal(snapshot[5].Answer.Options, []string{"ta", "de"}) {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	if snapshot, invalid := ValidateAnswers(nil, nil); invalid != nil || snapshot == nil || len(snapshot) != 0 {
		t.Fatalf("no questions: snapshot = %v, invalid = %v", snapshot, invalid)
	}
}

func TestValidateAnswersRefusals(t *testing.T) {
	t.Parallel()
	required := []applications.ApplicationAnswer{
		answer(0, applications.TextAnswer("Engineer")),
		answer(2, applications.NumberAnswer(5)),
	}
	with := func(extra ...applications.ApplicationAnswer) []applications.ApplicationAnswer {
		return append(slices.Clone(required), extra...)
	}
	unknown := common.ApplicationQuestionID("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a99")
	tests := []struct {
		name    string
		answers []applications.ApplicationAnswer
		want    []common.ApplicationQuestionID
	}{
		{"required missing", required[1:], []common.ApplicationQuestionID{questionID(0)}},
		{"required blank text", with(answer(0, applications.TextAnswer(""))), []common.ApplicationQuestionID{questionID(0)}},
		{"short text too long", []applications.ApplicationAnswer{answer(0, applications.TextAnswer(strings.Repeat("a", 201))), required[1]}, []common.ApplicationQuestionID{questionID(0)}},
		{"long text too long", with(answer(1, applications.TextAnswer(strings.Repeat("a", 2001)))), []common.ApplicationQuestionID{questionID(1)}},
		{"number below min", []applications.ApplicationAnswer{required[0], answer(2, applications.NumberAnswer(1))}, []common.ApplicationQuestionID{questionID(2)}},
		{"number above max", []applications.ApplicationAnswer{required[0], answer(2, applications.NumberAnswer(11))}, []common.ApplicationQuestionID{questionID(2)}},
		{"number as text", []applications.ApplicationAnswer{required[0], answer(2, applications.TextAnswer("5"))}, []common.ApplicationQuestionID{questionID(2)}},
		{"yes no as text", with(answer(3, applications.TextAnswer("yes"))), []common.ApplicationQuestionID{questionID(3)}},
		{"unknown option", with(answer(4, applications.TextAnswer("berlin"))), []common.ApplicationQuestionID{questionID(4)}},
		{"single choice as list", with(answer(4, applications.OptionsAnswer("Berlin"))), []common.ApplicationQuestionID{questionID(4)}},
		{"empty multiple choice", with(answer(5, applications.OptionsAnswer())), []common.ApplicationQuestionID{questionID(5)}},
		{"repeated option", with(answer(5, applications.OptionsAnswer("de", "de"))), []common.ApplicationQuestionID{questionID(5)}},
		{"unknown multiple option", with(answer(5, applications.OptionsAnswer("fr"))), []common.ApplicationQuestionID{questionID(5)}},
		{"unknown id", with(applications.ApplicationAnswer{QuestionID: unknown, Value: applications.BooleanAnswer(true)}), []common.ApplicationQuestionID{unknown}},
		{"repeated id", with(answer(3, applications.BooleanAnswer(true)), answer(3, applications.BooleanAnswer(false))), []common.ApplicationQuestionID{questionID(3)}},
		{"several, question order then strays", []applications.ApplicationAnswer{
			{QuestionID: unknown, Value: applications.BooleanAnswer(true)},
			answer(4, applications.TextAnswer("Paris")),
			required[0],
		}, []common.ApplicationQuestionID{questionID(2), questionID(4), unknown}},
	}
	for _, test := range tests {
		snapshot, invalid := ValidateAnswers(liveQuestions(), test.answers)
		if snapshot != nil || !slices.Equal(invalid, test.want) {
			t.Errorf("%s: snapshot = %v, invalid = %v, want %v", test.name, snapshot, invalid, test.want)
		}
	}
}
