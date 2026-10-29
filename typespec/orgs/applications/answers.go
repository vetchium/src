package applications

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
)

const (
	// MaxApplicationAnswers bounds an apply request; the Org tenant then
	// requires one answer per live question at most (HP-QST-004).
	MaxApplicationAnswers = common.MaxApplicationQuestions
	MaxShortTextAnswer    = 200
	MaxLongTextAnswer     = 2000
	MaxAnswerOptions      = common.MaxQuestionOptions
)

// AnswerValue is exactly one of a string, an integer, a boolean, or a string
// list on the wire. The question's type decides which one is valid.
type AnswerValue struct {
	Text    *string
	Number  *int64
	Boolean *bool
	// Options is non-nil, possibly empty, for a list.
	Options []string
}

func TextAnswer(value string) AnswerValue  { return AnswerValue{Text: &value} }
func NumberAnswer(value int64) AnswerValue { return AnswerValue{Number: &value} }
func BooleanAnswer(value bool) AnswerValue { return AnswerValue{Boolean: &value} }
func OptionsAnswer(values ...string) AnswerValue {
	return AnswerValue{Options: append([]string{}, values...)}
}

func (v AnswerValue) kinds() int {
	count := 0
	for _, set := range []bool{v.Text != nil, v.Number != nil, v.Boolean != nil, v.Options != nil} {
		if set {
			count++
		}
	}
	return count
}

func (v AnswerValue) MarshalJSON() ([]byte, error) {
	switch {
	case v.kinds() != 1:
		return nil, errors.New("answer value holds no single kind")
	case v.Text != nil:
		return json.Marshal(*v.Text)
	case v.Number != nil:
		return json.Marshal(*v.Number)
	case v.Boolean != nil:
		return json.Marshal(*v.Boolean)
	default:
		return json.Marshal(v.Options)
	}
}

// UnmarshalJSON refuses null, objects, fractions, and lists holding anything
// but strings, so a decoded value always holds exactly one kind.
func (v *AnswerValue) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return errors.New("empty answer value")
	}
	var decoded AnswerValue
	switch data[0] {
	case '"':
		var text string
		if err := json.Unmarshal(data, &text); err != nil {
			return err
		}
		decoded.Text = &text
	case 't', 'f':
		var boolean bool
		if err := json.Unmarshal(data, &boolean); err != nil {
			return err
		}
		decoded.Boolean = &boolean
	case '[':
		// Pointers expose null entries, which a []string would read as "".
		var entries []*string
		if err := json.Unmarshal(data, &entries); err != nil {
			return err
		}
		decoded.Options = make([]string, len(entries))
		for index, entry := range entries {
			if entry == nil {
				return errors.New("answer option is null")
			}
			decoded.Options[index] = *entry
		}
	default:
		number, err := strconv.ParseInt(string(data), 10, 64)
		if err != nil {
			return fmt.Errorf("answer value %s is not a string, integer, boolean, or string list", data)
		}
		decoded.Number = &number
	}
	*v = decoded
	return nil
}

// Normalized trims the strings of a copy.
func (v AnswerValue) Normalized() AnswerValue {
	if v.Text != nil {
		text := strings.TrimSpace(*v.Text)
		v.Text = &text
	}
	if v.Options != nil {
		options := make([]string, len(v.Options))
		for index, option := range v.Options {
			options[index] = strings.TrimSpace(option)
		}
		v.Options = options
	}
	return v
}

type ApplicationAnswer struct {
	QuestionID common.ApplicationQuestionID `json:"question_id"`
	Value      AnswerValue                  `json:"value"`
}

// NormalizeAnswers returns trimmed copies.
func NormalizeAnswers(answers []ApplicationAnswer) []ApplicationAnswer {
	if answers == nil {
		return nil
	}
	normalized := make([]ApplicationAnswer, len(answers))
	for index, answer := range answers {
		normalized[index] = ApplicationAnswer{
			QuestionID: answer.QuestionID, Value: answer.Value.Normalized(),
		}
	}
	return normalized
}

// ValidateAnswerShapes checks only shape and lengths; the Org tenant checks
// answers against the live questions (HP-QST-004).
func ValidateAnswerShapes(answers []ApplicationAnswer) []string {
	fields := []string{}
	if len(answers) > MaxApplicationAnswers {
		fields = append(fields, "answers")
	}
	for index, answer := range answers {
		path := fmt.Sprintf("answers.%d", index)
		if !common.IsApplicationQuestionID(answer.QuestionID) {
			fields = append(fields, path+".question_id")
		}
		value := answer.Value
		valid := value.kinds() == 1 &&
			(value.Text == nil || utf8.RuneCountInString(*value.Text) <= MaxLongTextAnswer) &&
			len(value.Options) <= MaxAnswerOptions
		for _, option := range value.Options {
			valid = valid && utf8.RuneCountInString(option) <= MaxLongTextAnswer
		}
		if !valid {
			fields = append(fields, path+".value")
		}
	}
	return fields
}

// AnsweredQuestion is one question as the application was asked it, with
// the applicant's answer; Answer is nil when an optional question went
// unanswered (HP-QST-005).
type AnsweredQuestion struct {
	common.ApplicationQuestion
	Answer *AnswerValue `json:"answer,omitempty"`
}

// AnswerCurrency is how an answered question compares to the live question
// with its id now (HP-QST-006).
type AnswerCurrency string

const (
	AnswerSame    AnswerCurrency = "same"
	AnswerChanged AnswerCurrency = "changed"
	AnswerRemoved AnswerCurrency = "removed"
)

// AnswerRecord is an answered question with its currency, for Org readers.
type AnswerRecord struct {
	AnsweredQuestion
	Current AnswerCurrency `json:"current"`
}

// MaxAnswerColumns bounds list-applications' answer_columns (HP-QST-007).
const MaxAnswerColumns = 3

// IsAnswerColumnQuestion reports whether list-applications may return
// answers of this type as a column: short ones only, never free text.
func IsAnswerColumnQuestion(kind common.ApplicationQuestionType) bool {
	switch kind {
	case common.QuestionNumber, common.QuestionYesNo,
		common.QuestionSingleChoice, common.QuestionMultipleChoice:
		return true
	}
	return false
}
