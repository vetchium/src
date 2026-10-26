package orgs

import "github.com/vetchium/src/typespec/problem"

var PipelineTemplateNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/org-pipeline-template-not-found",
	Title:  "Org pipeline template not found",
	Status: 404,
	Detail: "The Org has no pipeline template with the requested id",
}

var PipelineTemplateNameTakenError = problem.Details{
	Type:   "vetchium-problem-details/org-pipeline-template-name-taken",
	Title:  "Org pipeline template name taken",
	Status: 409,
	Detail: "Another pipeline template of the Org has this name",
}

type PipelineTemplateLimitReachedDetails struct {
	problem.Details
	Limit int32 `json:"limit"`
}

func PipelineTemplateLimitReachedError(limit int32) PipelineTemplateLimitReachedDetails {
	return PipelineTemplateLimitReachedDetails{
		Details: problem.Details{
			Type:   "vetchium-problem-details/org-pipeline-template-limit-reached",
			Title:  "Org pipeline template limit reached",
			Status: 409,
			Detail: "The Org already has the most pipeline templates it may keep",
		},
		Limit: limit,
	}
}

var PipelineStageInUseError = problem.Details{
	Type:   "vetchium-problem-details/org-pipeline-stage-in-use",
	Title:  "Org pipeline stage in use",
	Status: 409,
	Detail: "A stage to remove holds a candidacy",
}
