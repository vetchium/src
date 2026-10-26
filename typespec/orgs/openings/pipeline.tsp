import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/idempotency.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/openings.tsp";
import "../../problem/orgs/pipelines.tsp";
import "../../problem/orgs/suspension.tsp";
import "../hiring/pipelines.tsp";
import "./types.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Openings;

/** A stage of a replacement pipeline. */
model PipelineStageInput {
  /** Omitted for a new stage; present to keep, rename, or move a stage. */
  id?: Vetchium.Orgs.Hiring.PipelineStageID;

  name: Vetchium.Orgs.Hiring.PipelineName;
  kind: Vetchium.Orgs.Hiring.StageKind;
}

model OpeningPipeline {
  opening_number: OpeningNumber;
  version: OpeningVersion;

  @minItems(1)
  @maxItems(15)
  stages: Vetchium.Orgs.Hiring.PipelineStage[];
}

model GetOpeningPipelineRequest {
  opening_number: OpeningNumber;
}

/** Replaces the whole ordered list; a stage left out is removed. */
model ReplaceOpeningPipelineRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;

  @minItems(1)
  @maxItems(15)
  stages: PipelineStageInput[];
}

alias OpeningPipelineErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
  | Vetchium.Problem.OrgPermissionRequiredErrorResponse
  | Vetchium.Problem.OrgSuspendedErrorResponse
  | Vetchium.Problem.RateLimitExceededErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse
  | Vetchium.Problem.OrgOpeningNotFoundErrorResponse
  | Vetchium.Problem.OrgOpeningStateConflictErrorResponse;

@route("/api/orgs")
@tag("Org Opening Pipelines")
interface OpeningPipelineOperations {
  @route("/get-opening-pipeline")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_openings"
  )
  getOpeningPipeline(@body request: GetOpeningPipelineRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OpeningPipeline;
      }
    | OpeningPipelineErrors;

  @route("/replace-opening-pipeline")
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
  replaceOpeningPipeline(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ReplaceOpeningPipelineRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OpeningPipeline;
      }
    | OpeningPipelineErrors
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.OrgOpeningVersionConflictErrorResponse
    | Vetchium.Problem.OrgPipelineStageInUseErrorResponse;
}
