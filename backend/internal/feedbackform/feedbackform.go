// Package feedbackform checks interview feedback against the feedback form of
// the interview's stage (HP-FRM-003) and judges stored answers against the
// form now (HP-FRM-004), for in-house and provider interviewers alike.
package feedbackform

import (
	"encoding/json"
	"fmt"
	"slices"
	"unicode/utf8"

	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"
)

// Encode checks answers against the stage's stored form and returns the
// snapshot to store, or the refusal.
func Encode(
	storedForm []byte, answers []applications.CriterionAnswer,
) ([]byte, problem.Body, error) {
	var form []hiring.FeedbackCriterion
	if err := json.Unmarshal(storedForm, &form); err != nil {
		return nil, nil, fmt.Errorf("decode feedback form: %w", err)
	}
	snapshot, invalid := Check(form, answers)
	if len(invalid) > 0 {
		return nil, orgsproblem.InterviewFeedbackAnswersInvalidError(invalid), nil
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return nil, nil, fmt.Errorf("encode criteria answers: %w", err)
	}
	return encoded, nil, nil
}

// Answered is one criterion as the interviewer was asked it, as stored.
type Answered struct {
	hiring.FeedbackCriterion
	Answer *applications.AnswerValue `json:"answer,omitempty"`
}

// Check checks normalized answers against form and returns the snapshot to
// store: every criterion in order, with its answer when one was given. A
// blank text answer is no answer. invalid names each criterion to fix in form
// order, then unknown or repeated ids in answer order; the snapshot is nil
// when any is.
func Check(
	form []hiring.FeedbackCriterion, answers []applications.CriterionAnswer,
) (snapshot []Answered, invalid []hiring.FeedbackCriterionID) {
	given := map[hiring.FeedbackCriterionID]applications.AnswerValue{}
	var stray []hiring.FeedbackCriterionID
	for _, answer := range answers {
		_, repeated := given[answer.CriterionID]
		if repeated || !holds(form, answer.CriterionID) {
			if !slices.Contains(stray, answer.CriterionID) {
				stray = append(stray, answer.CriterionID)
			}
			continue
		}
		given[answer.CriterionID] = answer.Value
	}
	snapshot = make([]Answered, 0, len(form))
	for _, criterion := range form {
		if criterion.ID == nil {
			continue
		}
		id := *criterion.ID
		entry := Answered{FeedbackCriterion: criterion}
		value, answered := given[id]
		if answered && criterion.Type == hiring.CriterionText &&
			value.Text != nil && *value.Text == "" {
			answered = false
		}
		switch {
		case answered && !fits(criterion.Type, value):
			invalid = append(invalid, id)
		case answered:
			entry.Answer = &value
		case criterion.Required:
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

func holds(form []hiring.FeedbackCriterion, id hiring.FeedbackCriterionID) bool {
	return slices.ContainsFunc(form, func(criterion hiring.FeedbackCriterion) bool {
		return criterion.ID != nil && *criterion.ID == id
	})
}

func fits(kind hiring.FeedbackCriterionType, value applications.AnswerValue) bool {
	switch kind {
	case hiring.CriterionRating:
		return value.Number != nil &&
			*value.Number >= applications.MinCriterionRating &&
			*value.Number <= applications.MaxCriterionRating
	case hiring.CriterionYesNo:
		return value.Boolean != nil
	case hiring.CriterionText:
		return value.Text != nil &&
			utf8.RuneCountInString(*value.Text) <= applications.MaxCriterionTextValue
	default:
		return false
	}
}

// Judge sets each answered criterion's currency against the stage's form
// now: only text and type count, so required may change freely.
func Judge(asked []applications.AnsweredCriterion, form []hiring.FeedbackCriterion) {
	for index := range asked {
		answered := &asked[index]
		answered.Current = applications.AnswerRemoved
		for _, criterion := range form {
			if criterion.ID == nil || answered.ID == nil || *criterion.ID != *answered.ID {
				continue
			}
			answered.Current = applications.AnswerChanged
			if criterion.Text == answered.Text && criterion.Type == answered.Type {
				answered.Current = applications.AnswerSame
			}
		}
	}
}
