package applications

import (
	"slices"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/applications"
)

func TestAnswerRecordsJudgeWhatTheApplicantSaw(t *testing.T) {
	t.Parallel()
	ids := []common.ApplicationQuestionID{
		"0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a50",
		"0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a51",
		"0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a52",
		"0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a53",
		"0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a54",
		"0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a55",
	}
	low, high := int64(1), int64(5)
	question := func(n int, text string, kind common.ApplicationQuestionType, options ...string) common.ApplicationQuestion {
		return common.ApplicationQuestion{ID: &ids[n], Text: text, Type: kind, Options: options}
	}
	asked := []applications.AnsweredQuestion{
		{ApplicationQuestion: question(0, "Years", common.QuestionNumber)},
		{ApplicationQuestion: question(1, "Office", common.QuestionSingleChoice, "Berlin", "Munich")},
		{ApplicationQuestion: question(2, "Why", common.QuestionShortText)},
		{ApplicationQuestion: question(3, "Office", common.QuestionSingleChoice, "Berlin", "Munich")},
		{ApplicationQuestion: question(4, "Permit", common.QuestionYesNo)},
		{ApplicationQuestion: question(5, "Notes", common.QuestionShortText)},
	}
	stricter := question(0, "Years", common.QuestionNumber)
	stricter.Required, stricter.Min, stricter.Max = true, &low, &high
	live := []common.ApplicationQuestion{
		question(4, "Permit", common.QuestionYesNo),
		stricter,
		question(1, "Office", common.QuestionSingleChoice, "Munich", "Berlin"),
		question(2, "Why us", common.QuestionShortText),
		question(5, "Notes", common.QuestionLongText),
	}
	records := answerRecords(asked, live)
	got := make([]applications.AnswerCurrency, len(records))
	for index, record := range records {
		got[index] = record.Current
		if *record.ID != ids[index] {
			t.Fatalf("record %d is %s", index, *record.ID)
		}
	}
	want := []applications.AnswerCurrency{
		applications.AnswerSame, applications.AnswerChanged,
		applications.AnswerChanged, applications.AnswerRemoved,
		applications.AnswerSame, applications.AnswerChanged,
	}
	if !slices.Equal(got, want) {
		t.Fatalf("currencies = %v, want %v", got, want)
	}
	if empty := answerRecords(nil, live); empty == nil || len(empty) != 0 {
		t.Fatalf("no answers = %v", empty)
	}
}
