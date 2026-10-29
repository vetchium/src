import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/idempotency.tsp";
import "../../common/pagination.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/pipelines.tsp";
import "../../problem/orgs/suspension.tsp";
import "./vocabulary.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Hiring;

/** A stage or template name, 1 to 100 code points after trimming. */
@minLength(1)
@maxLength(100)
scalar PipelineName extends string;

/** An immutable pipeline-template identifier. */
@format("uuid")
scalar PipelineTemplateID extends string;

/** A stable identifier of one stage of one Opening's pipeline. */
@format("uuid")
scalar PipelineStageID extends string;

/**
 * How an interviewer answers a criterion (HP-FRM-001): `rating` an integer
 * 1–5, `yes_no` a boolean, `text` 1–2,000 code points. A portal older than its
 * API shows a type it does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["rating", "yes_no", "text"]
)
scalar FeedbackCriterionType extends string;

/** A stable identifier of one criterion of one stage's feedback form. */
@format("uuid")
scalar FeedbackCriterionID extends string;

/**
 * One criterion of an interview stage's feedback form. A criterion sent
 * without `id` is new; an `id` must name a criterion the stage (or, for a
 * template, the template) already holds. Responses always carry `id`.
 */
model FeedbackCriterion {
  id?: FeedbackCriterionID;

  @minLength(1)
  @maxLength(500)
  text: string;

  type: FeedbackCriterionType;
  required: boolean;
}

/** A stage as a template or a new Opening describes it. */
model PipelineStageDefinition {
  name: PipelineName;
  kind: StageKind;

  /**
   * `interview` stages only; omission is an empty form. Responses carry it
   * for every interview stage. Ids are unique across the template.
   */
  @maxItems(10)
  feedback_form?: FeedbackCriterion[];
}

/** A stage of an Opening's pipeline. */
model PipelineStage {
  id: PipelineStageID;
  name: PipelineName;
  kind: StageKind;

  /** Pipeline reads carry it for every `interview` stage, possibly empty. */
  @maxItems(10)
  feedback_form?: FeedbackCriterion[];
}

model PipelineTemplate {
  id: PipelineTemplateID;
  name: PipelineName;

  @minItems(1)
  @maxItems(15)
  stages: PipelineStageDefinition[];

  created_at: utcDateTime;
  updated_at: utcDateTime;
}

model ListPipelineTemplatesRequest {
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: Vetchium.PageSize = 50;
}

model ListPipelineTemplatesResponse {
  templates: PipelineTemplate[];
  next_pagination_key?: Vetchium.PaginationKey;
}

model CreatePipelineTemplateRequest {
  name: PipelineName;

  @minItems(1)
  @maxItems(15)
  stages: PipelineStageDefinition[];
}

/** Replaces the whole template; editing it never changes an Opening. */
model UpdatePipelineTemplateRequest {
  template_id: PipelineTemplateID;
  name: PipelineName;

  @minItems(1)
  @maxItems(15)
  stages: PipelineStageDefinition[];
}

model DeletePipelineTemplateRequest {
  template_id: PipelineTemplateID;
}

alias PipelineTemplateBaseErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
  | Vetchium.Problem.OrgPermissionRequiredErrorResponse
  | Vetchium.Problem.OrgSuspendedErrorResponse
  | Vetchium.Problem.RateLimitExceededErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias PipelineTemplateWriteErrors =
  | PipelineTemplateBaseErrors
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse;

@route("/api/orgs")
@tag("Org Pipeline Templates")
interface PipelineTemplateOperations {
  @route("/list-pipeline-templates")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_openings"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["normalized-filters", "name", "id"]
  )
  listPipelineTemplates(@body request: ListPipelineTemplatesRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListPipelineTemplatesResponse;
      }
    | PipelineTemplateBaseErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  @route("/create-pipeline-template")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_openings"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "authenticated-principal",
      "canonical-request-digest",
      "idempotency-key"
    ]
  )
  createPipelineTemplate(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: CreatePipelineTemplateRequest,
  ):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: PipelineTemplate;
      }
    | PipelineTemplateWriteErrors
    | Vetchium.Problem.OrgPipelineTemplateNameTakenErrorResponse
    | Vetchium.Problem.OrgPipelineTemplateLimitReachedErrorResponse;

  @route("/update-pipeline-template")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_openings"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "authenticated-principal",
      "canonical-request-digest",
      "idempotency-key"
    ]
  )
  updatePipelineTemplate(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: UpdatePipelineTemplateRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: PipelineTemplate;
      }
    | PipelineTemplateWriteErrors
    | Vetchium.Problem.OrgPipelineTemplateNotFoundErrorResponse
    | Vetchium.Problem.OrgPipelineTemplateNameTakenErrorResponse;

  @route("/delete-pipeline-template")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_openings"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "authenticated-principal",
      "canonical-request-digest",
      "idempotency-key"
    ]
  )
  deletePipelineTemplate(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: DeletePipelineTemplateRequest,
  ):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | PipelineTemplateWriteErrors
    | Vetchium.Problem.OrgPipelineTemplateNotFoundErrorResponse;
}
