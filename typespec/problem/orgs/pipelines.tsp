import "../details.tsp";

namespace Vetchium.Problem;

const OrgPipelineTemplateNotFoundError = #{
  type: "vetchium-problem-details/org-pipeline-template-not-found",
  title: "Org pipeline template not found",
  status: 404,
  detail: "The Org has no pipeline template with the requested id",
};
alias OrgPipelineTemplateNotFoundErrorResponse = Response<
  404,
  typeof OrgPipelineTemplateNotFoundError
>;

const OrgPipelineTemplateNameTakenError = #{
  type: "vetchium-problem-details/org-pipeline-template-name-taken",
  title: "Org pipeline template name taken",
  status: 409,
  detail: "Another pipeline template of the Org has this name",
};
alias OrgPipelineTemplateNameTakenErrorResponse = Response<
  409,
  typeof OrgPipelineTemplateNameTakenError
>;

model OrgPipelineTemplateLimitReachedDetails {
  type: "vetchium-problem-details/org-pipeline-template-limit-reached";
  title: "Org pipeline template limit reached";
  status: 409;
  detail: "The Org already has the most pipeline templates it may keep";
  limit: int32;
  instance?: string;
}
alias OrgPipelineTemplateLimitReachedErrorResponse = Response<
  409,
  OrgPipelineTemplateLimitReachedDetails
>;

const OrgPipelineStageInUseError = #{
  type: "vetchium-problem-details/org-pipeline-stage-in-use",
  title: "Org pipeline stage in use",
  status: 409,
  detail: "A stage to remove holds a candidacy",
};
alias OrgPipelineStageInUseErrorResponse = Response<
  409,
  typeof OrgPipelineStageInUseError
>;
