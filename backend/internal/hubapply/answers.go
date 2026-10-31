package hubapply

import (
	"slices"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/applications"
)

// ValidateAnswers checks normalized answers against the Opening's live
// questions (HP-QST-004) and returns the snapshot to store (HP-QST-005): every
// question in order, with its answer when one was given. A blank text answer
// is no answer. invalid names each question to fix in question order, then
// unknown or repeated ids in answer order; the snapshot is nil when any is.
func ValidateAnswers(
	questions []common.ApplicationQuestion,
	answers []applications.ApplicationAnswer,
) (snapshot []applications.AnsweredQuestion, invalid []common.ApplicationQuestionID) {
	given := map[common.ApplicationQuestionID]applications.AnswerValue{}
	var stray []common.ApplicationQuestionID
	for _, answer := range answers {
		_, repeated := given[answer.QuestionID]
		if repeated || !asks(questions, answer.QuestionID) {
			if !slices.Contains(stray, answer.QuestionID) {
				stray = append(stray, answer.QuestionID)
			}
			continue
		}
		given[answer.QuestionID] = answer.Value
	}
	snapshot = make([]applications.AnsweredQuestion, 0, len(questions))
	for _, question := range questions {
		if question.ID == nil {
			continue
		}
		id := *question.ID
		entry := applications.AnsweredQuestion{ApplicationQuestion: question}
		value, answered := given[id]
		if answered && value.Text != nil && *value.Text == "" && isTextQuestion(question.Type) {
			answered = false
		}
		switch {
		case answered && !fits(question, value):
			invalid = append(invalid, id)
		case answered:
			entry.Answer = &value
		case question.Required:
			invalid = append(invalid, id)
		}
		snapshot = append(snapshot, entry)
	}
	for _, id := range stray {
		if !slices.Contains(invalid, id) {
			invalid = append(invalid, id)
		}
	}
	if len(invalid) > 0 {
		return nil, invalid
	}
	return snapshot, nil
}

func asks(questions []common.ApplicationQuestion, id common.ApplicationQuestionID) bool {
	return slices.ContainsFunc(questions, func(question common.ApplicationQuestion) bool {
		return question.ID != nil && *question.ID == id
	})
}

func isTextQuestion(kind common.ApplicationQuestionType) bool {
	return kind == common.QuestionShortText || kind == common.QuestionLongText
}

func fits(question common.ApplicationQuestion, value applications.AnswerValue) bool {
	switch question.Type {
	case common.QuestionShortText:
		return value.Text != nil && utf8.RuneCountInString(*value.Text) <= applications.MaxShortTextAnswer
	case common.QuestionLongText:
		return value.Text != nil && utf8.RuneCountInString(*value.Text) <= applications.MaxLongTextAnswer
	case common.QuestionNumber:
		return value.Number != nil &&
			(question.Min == nil || *value.Number >= *question.Min) &&
			(question.Max == nil || *value.Number <= *question.Max)
	case common.QuestionYesNo:
		return value.Boolean != nil
	case common.QuestionSingleChoice:
		return value.Text != nil && slices.Contains(question.Options, *value.Text)
	case common.QuestionMultipleChoice:
		if len(value.Options) == 0 || len(value.Options) > applications.MaxAnswerOptions {
			return false
		}
		for index, option := range value.Options {
			if !slices.Contains(question.Options, option) ||
				slices.Contains(value.Options[:index], option) {
				return false
			}
		}
		return true
	default:
		return false
	}
}
