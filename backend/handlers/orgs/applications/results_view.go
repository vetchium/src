package applications

import (
	"encoding/json"

	"github.com/vetchium/src/typespec/orgs/applications"

	"backend/internal/applicationview"
)

// assessments decodes the results GetOrgApplication aggregated, which the
// query leaves empty for a caller who reads only their own interviews.
func assessments(stored json.RawMessage) ([]applications.AssessmentResult, error) {
	return applicationview.Assessments(stored)
}

// backgroundChecks decodes the consent requests and their results.
func backgroundChecks(stored json.RawMessage) ([]applications.BackgroundCheck, error) {
	return applicationview.BackgroundChecks(stored)
}
