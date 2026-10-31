package pipelines

import (
	"fmt"
	"time"

	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/dbvalue"
)

// withCriterionIDs returns the form to store: each new criterion gets a
// UUIDv7, and each sent id that held lacks is reported under prefix
// (HP-FRM-002). The result is never nil, so a stage always stores an array.
func withCriterionIDs(
	now time.Time, prefix string, form []hiring.FeedbackCriterion,
	held map[hiring.FeedbackCriterionID]bool,
) ([]hiring.FeedbackCriterion, []string, error) {
	stored := make([]hiring.FeedbackCriterion, len(form))
	var unknown []string
	for index, criterion := range form {
		if criterion.ID != nil {
			if !held[*criterion.ID] {
				unknown = append(unknown, fmt.Sprintf("%s.%d.id", prefix, index))
			}
		} else {
			id, err := dbvalue.NewUUIDv7(now)
			if err != nil {
				return nil, nil, err
			}
			assigned := hiring.FeedbackCriterionID(dbvalue.FormatUUID(id))
			criterion.ID = &assigned
		}
		stored[index] = criterion
	}
	return stored, unknown, nil
}

func validationFailed(fields []string) problem.Details {
	details := problem.ValidationFailedError
	details.Fields = fields
	return details
}

func criterionIDs(forms ...[]hiring.FeedbackCriterion) map[hiring.FeedbackCriterionID]bool {
	ids := map[hiring.FeedbackCriterionID]bool{}
	for _, form := range forms {
		for _, criterion := range form {
			if criterion.ID != nil {
				ids[*criterion.ID] = true
			}
		}
	}
	return ids
}

// templateStages assigns criterion ids to a template's stages; an id must name
// a criterion the template held, in any stage, since template stages have no
// ids of their own.
func templateStages(
	now time.Time, stages []hiring.PipelineStageDefinition,
	held map[hiring.FeedbackCriterionID]bool,
) ([]hiring.PipelineStageDefinition, []string, error) {
	stored := make([]hiring.PipelineStageDefinition, len(stages))
	var unknown []string
	for index, stage := range stages {
		form, invalid, err := withCriterionIDs(
			now, fmt.Sprintf("stages.%d.feedback_form", index), stage.FeedbackForm, held)
		if err != nil {
			return nil, nil, err
		}
		stage.FeedbackForm = form
		stored[index] = stage
		unknown = append(unknown, invalid...)
	}
	return stored, unknown, nil
}
