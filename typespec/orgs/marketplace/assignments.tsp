import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/idempotency.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/marketplace.tsp";
import "../../problem/orgs/openings.tsp";
import "../../problem/orgs/suspension.tsp";
import "../hiring/pipelines.tsp";
import "../openings/types.tsp";
import "./capabilities.tsp";
import "./engagements.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Marketplace;

/** One engagement assigned to an Opening or to one of its stages. */
model Assignment {
  engagement_id: EngagementID;

  /** The provider. */
  counterparty: EngagementCounterparty;

  capability: Capability;
  assigned_at: utcDateTime;
}

/** The engagements assigned to one stage of an Opening's pipeline. */
model StageAssignments {
  stage: Vetchium.Orgs.Hiring.PipelineStage;
  assignments: Assignment[];
}

/** What the consumer has attached to an Opening: agencies and stage work. */
model OpeningProviders {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;

  /** `sourcing` engagements assigned to the whole Opening. */
  agencies: Assignment[];

  /** Every stage in pipeline order, with the engagements assigned to it. */
  stages: StageAssignments[];
}

/** The application's route: the provider performing its current stage. */
model ApplicationRoute {
  engagement_id: EngagementID;
  provider: EngagementCounterparty;
  capability: Capability;
  routed_at: utcDateTime;
}

model GetOpeningProvidersRequest {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
}

/**
 * Assigns a `sourcing` engagement to the Opening (no `stage_id`) or an
 * engagement of the Capability that performs the stage's kind to that stage.
 */
model AssignOpeningProviderRequest {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  engagement_id: EngagementID;
  stage_id?: Vetchium.Orgs.Hiring.PipelineStageID;
}

model UnassignOpeningProviderRequest {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  engagement_id: EngagementID;
  stage_id?: Vetchium.Orgs.Hiring.PipelineStageID;
}

alias AssignmentBaseErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
  | Vetchium.Problem.OrgPermissionRequiredErrorResponse
  | Vetchium.Problem.OrgSuspendedErrorResponse
  | Vetchium.Problem.RateLimitExceededErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias AssignmentWriteErrors =
  | AssignmentBaseErrors
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse;

@route("/api/orgs")
@tag("Org Opening providers")
interface OpeningProviderOperations {
  /** Reads what is assigned to the Opening and each of its stages. */
  @route("/get-opening-providers")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_providers"
  )
  getOpeningProviders(@body request: GetOpeningProvidersRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OpeningProviders;
      }
    | AssignmentBaseErrors
    | Vetchium.Problem.OrgOpeningNotFoundErrorResponse;

  /** Assigns an active engagement to a non-terminal Opening or its stage. */
  @route("/assign-opening-provider")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_providers"
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
  assignOpeningProvider(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: AssignOpeningProviderRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OpeningProviders;
      }
    | AssignmentWriteErrors
    | Vetchium.Problem.OrgOpeningNotFoundErrorResponse
    | Vetchium.Problem.OrgOpeningStateConflictErrorResponse
    | Vetchium.Problem.OrgEngagementNotFoundErrorResponse
    | Vetchium.Problem.OrgEngagementStateConflictErrorResponse
    | Vetchium.Problem.OrgEngagementCapabilityMismatchErrorResponse
    | Vetchium.Problem.OrgAssignmentExistsErrorResponse
    | Vetchium.Problem.OrgAssignmentLimitReachedErrorResponse;

  /**
   * Removes an assignment. Every route to the engagement at that stage ends
   * with it; recorded work stays.
   */
  @route("/unassign-opening-provider")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_providers"
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
  unassignOpeningProvider(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: UnassignOpeningProviderRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OpeningProviders;
      }
    | AssignmentWriteErrors
    | Vetchium.Problem.OrgOpeningNotFoundErrorResponse
    | Vetchium.Problem.OrgAssignmentNotFoundErrorResponse;
}
