import "@typespec/http";
import "@typespec/openapi";
import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../common/openings.tsp";
import "../../common/pagination.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/ai.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/billing.tsp";
import "../../problem/orgs/suspension.tsp";
import "./types.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.AI;

/** The AI terms version the portal shows; enabling AI accepts exactly it. */
const OrgAITermsVersion = "ai-2026-10";

model GetAIOptionsRequest {
  operation: AIOperation;
}

enum AIAvailability {
  /** The caller may run the operation now. */
  Ready: "ready",

  /** AI is off for the Org, or its current AI terms are not accepted. */
  NotEnabled: "not_enabled",

  /** The plan does not include AI and no purchased credits remain. */
  PlanRequired: "plan_required",

  /** No credits are available. */
  NoCredits: "no_credits",
}

/** What one operation may use, for the caller about to run it. */
model AIOptions {
  availability: AIAvailability;

  /** The models the Org allows for the operation, offered in this region. */
  models: AIModel[];

  /** Absent when no allowed model is offered. */
  default_model?: AIModelOID;

  balance_available: int64;
}

/** A region default for an operation the Org has no policy for. */
model AIOperationDefault {
  operation: AIOperationOID;
  default_model: AIModelOID;
}

model OrgAISettings {
  enabled: boolean;

  /** The AI terms version accepted most recently. */
  accepted_terms_version?: string;

  accepted_terms_at?: utcDateTime;

  /** The Org's own policies. An operation without one allows every offered
   * model and preselects the region default. */
  policies: AIOperationPolicy[];
}

model AISettingsResponse {
  settings: OrgAISettings;

  /** Every model the region offers. */
  models: AIModel[];

  operation_defaults: AIOperationDefault[];
  current_terms_version: string;
  plan_allows_ai: boolean;

  /** Models named in a policy that the region no longer offers. */
  unavailable_models: AIModelOID[];
}

/** Replaces the settings. Turning AI on needs the current terms accepted, now
 * or earlier. */
model SetAISettingsRequest {
  enabled: boolean;

  /** Must equal the current AI terms version when present. */
  accept_terms_version?: string;

  /** At most one per operation; replaces every policy. */
  @maxItems(10)
  policies: AIOperationPolicy[];
}

model AICreditsResponse {
  balance: AICreditBalance;

  /** The plan's monthly grant. */
  monthly_grant: int64;

  /** The plan allows buying packs and the region offers AI. */
  purchase_allowed: boolean;

  /** Packs offered in this region. Payment is simulated: a purchase is not
   * charged. */
  packs: AICreditPack[];
}

model ListAICreditLotsRequest {
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: Vetchium.PageSize = 50;
}

model ListAICreditLotsResponse {
  lots: AICreditLot[];
  next_pagination_key?: Vetchium.PaginationKey;
}

model BuyAICreditPackRequest {
  pack_id: AICreditPackID;
}

model ListAIUsageRequest {
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: Vetchium.PageSize = 50;
}

model ListAIUsageResponse {
  entries: AIUsage[];
  next_pagination_key?: Vetchium.PaginationKey;
}

model GetAIUsageTextRequest {
  usage_id: AIUsageID;
}

model DraftOpeningRequest {
  /** Defaults to the Org's default model for drafting. */
  model_oid?: AIModelOID;

  /** What to write or change, 1–4,000 code points after trimming. */
  instruction: string;

  /** The editor's current content, which the draft refines. */
  current_content?: Vetchium.OpeningContent;
}

model AIUsageCharge {
  usage_id: AIUsageID;
  model_oid: AIModelOID;
  input_tokens: int32;
  output_tokens: int32;
  credits_charged: int64;
}

model DraftOpeningResponse {
  /** Valid content for the editor to fill; nothing is saved. */
  content: Vetchium.OpeningContent;

  /** Fields the model produced that failed validation and were left out. */
  dropped_fields: string[];

  usage: AIUsageCharge;
  balance_available: int64;
}

alias AIReadErrors =
  | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
  | Vetchium.Problem.OrgPermissionRequiredErrorResponse
  | Vetchium.Problem.OrgSuspendedErrorResponse
  | Vetchium.Problem.RateLimitExceededErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

@route("/api/orgs")
@tag("Org AI")
interface AIOperations {
  /** The models and availability of one operation, for a caller holding the
   * operation's permission. */
  @route("/get-ai-options")
  @post
  @useAuth(BearerAuth)
  getAIOptions(@body request: GetAIOptionsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AIOptions;
      }
    | AIReadErrors
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAIUnavailableErrorResponse;

  @route("/ai-settings")
  @get
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-required-permission", "org:manage_ai")
  getAISettings():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AISettingsResponse;
      }
    | AIReadErrors
    | Vetchium.Problem.OrgAIUnavailableErrorResponse;

  @route("/set-ai-settings")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-required-permission", "org:manage_ai")
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  setAISettings(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: SetAISettingsRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AISettingsResponse;
      }
    | AIReadErrors
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAIUnavailableErrorResponse
    | Vetchium.Problem.OrgAITermsRequiredErrorResponse
    | Vetchium.Problem.OrgAIModelNotOfferedErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse;

  @route("/ai-credits")
  @get
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-required-permission", "org:manage_ai")
  getAICredits():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AICreditsResponse;
      }
    | AIReadErrors
    | Vetchium.Problem.OrgAIUnavailableErrorResponse;

  /** Newest first. */
  @route("/list-ai-credit-lots")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-required-permission", "org:manage_ai")
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["created_at", "lot_id"]
  )
  listAICreditLots(@body request: ListAICreditLotsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListAICreditLotsResponse;
      }
    | AIReadErrors
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  /** Grants the pack's credits at once. Payment is simulated and charges
   * nothing. */
  @route("/buy-ai-credit-pack")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-required-permission", "org:manage_ai")
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  buyAICreditPack(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: BuyAICreditPackRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AICreditsResponse;
      }
    | AIReadErrors
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAIUnavailableErrorResponse
    | Vetchium.Problem.OrgPlanRequiredErrorResponse
    | Vetchium.Problem.OrgAIPackNotOfferedErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse;

  /** Newest first. */
  @route("/list-ai-usage")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-required-permission", "org:manage_ai")
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["created_at", "usage_id"]
  )
  listAIUsage(@body request: ListAIUsageRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListAIUsageResponse;
      }
    | AIReadErrors
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  /** Needs org:manage_ai and the permission that reads what the operation
   * worked on (org:view_openings for drafting); otherwise not found. */
  @route("/get-ai-usage-text")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-required-permission", "org:manage_ai")
  getAIUsageText(@body request: GetAIUsageTextRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AIUsageText;
      }
    | AIReadErrors
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAIUsageNotFoundErrorResponse;

  /** Drafts Opening content from an instruction. Reserves credits, calls the
   * model, and charges only a usable answer; nothing is saved to an Opening.
   * A replay returns the stored answer without charging again; a failed
   * attempt may be retried with the same key. */
  @route("/draft-opening-with-ai")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_openings"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  draftOpeningWithAI(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: DraftOpeningRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: DraftOpeningResponse;
      }
    | AIReadErrors
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAIUnavailableErrorResponse
    | Vetchium.Problem.OrgAINotEnabledErrorResponse
    | Vetchium.Problem.OrgPlanRequiredErrorResponse
    | Vetchium.Problem.OrgAIModelNotAllowedErrorResponse
    | Vetchium.Problem.OrgAICreditsInsufficientErrorResponse
    | Vetchium.Problem.OrgAIRequestInProgressErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.OrgAIOutputUnusableErrorResponse
    | Vetchium.Problem.OrgAIModelFailedErrorResponse;
}
