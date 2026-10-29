// Package applicationview decodes the JSON that the application queries
// aggregate for interviews, assessment results, and background checks, so the
// Org's own reads and a provider's reads of its work share one shape.
package applicationview

import (
	"encoding/json"
	"fmt"

	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/hiring"

	"backend/internal/feedbackform"
)

// Interviews decodes interviews. The query already applied the feedback
// visibility rule (HP-WRK-004), so nothing here filters again; each answered
// criterion is judged against the stage's form now (HP-FRM-004).
func Interviews(stored json.RawMessage) ([]applications.Interview, error) {
	list := []applications.Interview{}
	if err := json.Unmarshal(stored, &list); err != nil {
		return nil, fmt.Errorf("decode interviews: %w", err)
	}
	for index := range list {
		list[index].StartsAt = list[index].StartsAt.UTC()
		for feedback := range list[index].Feedback {
			entry := &list[index].Feedback[feedback]
			entry.SubmittedAt = entry.SubmittedAt.UTC()
			if entry.CriteriaAnswers == nil {
				entry.CriteriaAnswers = []applications.AnsweredCriterion{}
			}
			feedbackform.Judge(entry.CriteriaAnswers, list[index].Stage.FeedbackForm)
		}
		if list[index].Interviewers == nil {
			list[index].Interviewers = []applications.InterviewerStatus{}
		}
		if list[index].Feedback == nil {
			list[index].Feedback = []applications.InterviewFeedback{}
		}
	}
	return list, nil
}

// Assessments decodes assessment results.
func Assessments(stored json.RawMessage) ([]applications.AssessmentResult, error) {
	list := []applications.AssessmentResult{}
	if err := json.Unmarshal(stored, &list); err != nil {
		return nil, fmt.Errorf("decode assessments: %w", err)
	}
	for index := range list {
		list[index].RecordedAt = list[index].RecordedAt.UTC()
	}
	return list, nil
}

// BackgroundChecks decodes consent requests and their results.
func BackgroundChecks(stored json.RawMessage) ([]applications.BackgroundCheck, error) {
	list := []applications.BackgroundCheck{}
	if err := json.Unmarshal(stored, &list); err != nil {
		return nil, fmt.Errorf("decode background checks: %w", err)
	}
	for index := range list {
		check := &list[index]
		check.RequestedAt = check.RequestedAt.UTC()
		if check.RespondedAt != nil {
			responded := check.RespondedAt.UTC()
			check.RespondedAt = &responded
		}
		if check.CheckTypes == nil {
			check.CheckTypes = []hiring.CheckType{}
		}
		if check.Results == nil {
			check.Results = []applications.BackgroundCheckResult{}
		}
		for result := range check.Results {
			check.Results[result].RecordedAt = check.Results[result].RecordedAt.UTC()
		}
	}
	return list, nil
}
