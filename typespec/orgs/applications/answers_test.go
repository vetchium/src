package applications

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

const answerQuestion = common.ApplicationQuestionID("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")

func TestAnswerValueDecodesOneKind(t *testing.T) {
	t.Parallel()
	for _, encoded := range []string{`"text"`, `42`, `-3`, `true`, `false`, `[]`, `["a","b"]`} {
		var value AnswerValue
		if err := json.Unmarshal([]byte(encoded), &value); err != nil || value.kinds() != 1 {
			t.Fatalf("%s: value = %+v, err = %v", encoded, value, err)
		}
		again, err := json.Marshal(value)
		if err != nil || string(again) != strings.ReplaceAll(encoded, " ", "") {
			t.Fatalf("%s: re-encoded = %s, err = %v", encoded, again, err)
		}
	}
	for _, encoded := range []string{`null`, `{}`, `1.5`, `1e3`, `[1]`, `["a",null]`, `9223372036854775808`} {
		var value AnswerValue
		if err := json.Unmarshal([]byte(encoded), &value); err == nil {
			t.Fatalf("%s decoded as %+v", encoded, value)
		}
	}
	var answer ApplicationAnswer
	if err := json.Unmarshal([]byte(`{"question_id":"x","value":null}`), &answer); err == nil {
		t.Fatal("a null answer decoded")
	}
	if _, err := json.Marshal(AnswerValue{}); err == nil {
		t.Fatal("an empty answer value encoded")
	}
}

func TestAnsweredQuestionEncodesFlat(t *testing.T) {
	t.Parallel()
	id := answerQuestion
	data, err := json.Marshal([]AnsweredQuestion{
		{ApplicationQuestion: common.ApplicationQuestion{ID: &id, Text: "Notice?", Type: common.QuestionNumber, Required: true}, Answer: ptr(NumberAnswer(30))},
		{ApplicationQuestion: common.ApplicationQuestion{ID: &id, Text: "Why?", Type: common.QuestionLongText}},
	})
	want := `[{"id":"` + string(id) + `","text":"Notice?","type":"number","required":true,"answer":30},` +
		`{"id":"` + string(id) + `","text":"Why?","type":"long_text","required":false}]`
	if err != nil || string(data) != want {
		t.Fatalf("encoded = %s, err = %v", data, err)
	}
}

func TestNormalizeAnswersCopies(t *testing.T) {
	t.Parallel()
	source := []ApplicationAnswer{
		{QuestionID: answerQuestion, Value: TextAnswer("  text  ")},
		{QuestionID: answerQuestion, Value: OptionsAnswer(" a ", "b ")},
		{QuestionID: answerQuestion, Value: BooleanAnswer(true)},
	}
	normalized := NormalizeAnswers(source)
	if *source[0].Value.Text != "  text  " || source[1].Value.Options[0] != " a " {
		t.Fatal("normalization mutated the caller's answers")
	}
	if *normalized[0].Value.Text != "text" ||
		!slices.Equal(normalized[1].Value.Options, []string{"a", "b"}) ||
		!*normalized[2].Value.Boolean {
		t.Fatalf("normalized = %+v", normalized)
	}
	if NormalizeAnswers(nil) != nil {
		t.Fatal("no answers became some")
	}
}

func TestValidateAnswerShapes(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("界", MaxLongTextAnswer)
	nine := make([]string, MaxAnswerOptions+1)
	valid := []ApplicationAnswer{
		{QuestionID: answerQuestion, Value: TextAnswer(long)},
		{QuestionID: answerQuestion, Value: TextAnswer("")},
		{QuestionID: answerQuestion, Value: NumberAnswer(-1)},
		{QuestionID: answerQuestion, Value: OptionsAnswer(nine[1:]...)},
		{QuestionID: answerQuestion, Value: OptionsAnswer()},
	}
	if fields := ValidateAnswerShapes(valid); len(fields) != 0 {
		t.Fatalf("valid shapes refused: %v", fields)
	}
	tests := []struct {
		name    string
		answers []ApplicationAnswer
		want    []string
	}{
		{"eleven answers", slices.Repeat(valid[2:3], MaxApplicationAnswers+1), []string{"answers"}},
		{"bad question id", []ApplicationAnswer{{QuestionID: "Q1", Value: BooleanAnswer(true)}}, []string{"answers.0.question_id"}},
		{"text too long", []ApplicationAnswer{{QuestionID: answerQuestion, Value: TextAnswer(long + "x")}}, []string{"answers.0.value"}},
		{"nine options", []ApplicationAnswer{{QuestionID: answerQuestion, Value: OptionsAnswer(nine...)}}, []string{"answers.0.value"}},
		{"option too long", []ApplicationAnswer{{QuestionID: answerQuestion, Value: OptionsAnswer(long + "x")}}, []string{"answers.0.value"}},
		{"no value", []ApplicationAnswer{{QuestionID: answerQuestion}}, []string{"answers.0.value"}},
		{"two kinds", []ApplicationAnswer{{QuestionID: answerQuestion, Value: AnswerValue{Text: ptr(""), Number: ptr(int64(1))}}}, []string{"answers.0.value"}},
	}
	for _, test := range tests {
		if fields := ValidateAnswerShapes(test.answers); !slices.Equal(fields, test.want) {
			t.Errorf("%s: fields = %v, want %v", test.name, fields, test.want)
		}
	}
}

func ptr[T any](value T) *T { return &value }
