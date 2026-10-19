package applications

import (
	"encoding/json"
	"fmt"

	"github.com/vetchium/src/typespec/orgs/applications"
	"github.com/vetchium/src/typespec/orgs/hiring"
)

// assessments decodes the results GetOrgApplication aggregated, which the
// query leaves empty for a caller who reads only their own interviews.
func assessments(stored json.RawMessage) ([]applications.AssessmentResult, error) {
	list := []applications.AssessmentResult{}
	if err := json.Unmarshal(stored, &list); err != nil {
		return nil, fmt.Errorf("decode assessments: %w", err)
	}
	for index := range list {
		list[index].RecordedAt = list[index].RecordedAt.UTC()
	}
	return list, nil
}

// backgroundChecks decodes the consent requests and their results.
func backgroundChecks(stored json.RawMessage) ([]applications.BackgroundCheck, error) {
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
