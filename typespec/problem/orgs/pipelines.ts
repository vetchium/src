import type { Details } from "../details.ts";

export const PipelineTemplateNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/org-pipeline-template-not-found",
  title: "Org pipeline template not found",
  status: 404,
  detail: "The Org has no pipeline template with the requested id",
};

export const PipelineTemplateNameTakenError: Readonly<Details> = {
  type: "vetchium-problem-details/org-pipeline-template-name-taken",
  title: "Org pipeline template name taken",
  status: 409,
  detail: "Another pipeline template of the Org has this name",
};

export interface PipelineTemplateLimitReachedDetails extends Details {
  type: "vetchium-problem-details/org-pipeline-template-limit-reached";
  limit: number;
}
