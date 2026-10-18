import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/idempotency.tsp";
import "../../common/pagination.tsp";
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

@minLength(2)
@maxLength(200)
scalar OpeningTitleQuery extends string;

model CreateOpeningRequest {
  content: Vetchium.OpeningContent;
  hiring_manager_email?: Vetchium.EmailAddress;
  recruiter_email?: Vetchium.EmailAddress;

  @maxItems(20)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  team_member_emails: Vetchium.EmailAddress[];

  @minLength(1)
  @maxLength(2000)
  internal_notes?: string;

  /** The new Opening copies this template; omission gives one review stage. */
  pipeline_template_id?: Vetchium.Orgs.Hiring.PipelineTemplateID;
}

model DuplicateOpeningRequest {
  opening_number: OpeningNumber;

  /** Overrides the source Opening's pipeline, which is copied by default. */
  pipeline_template_id?: Vetchium.Orgs.Hiring.PipelineTemplateID;
}

model GetOpeningRequest {
  opening_number: OpeningNumber;
}

model ListOpeningsRequest {
  /** Omission lists every state except discarded. */
  @minItems(1)
  @maxItems(6)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  states?: OpeningState[];

  @minItems(1)
  @maxItems(5)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  pending_request_kinds?: OpeningRequestKind[];

  awaiting_my_approval?: boolean;
  hiring_manager_email?: Vetchium.EmailAddress;
  recruiter_email?: Vetchium.EmailAddress;
  employing_country?: Vetchium.CountryCode;
  work_arrangement?: Vetchium.OpeningWorkArrangement;
  employment_type?: Vetchium.OpeningEmploymentType;
  title_query?: OpeningTitleQuery;
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: Vetchium.PageSize = 50;
}

model ListOpeningsResponse {
  openings: OrgOpeningSummary[];
  next_pagination_key?: Vetchium.PaginationKey;
}

model OpeningSummaryResponse {
  counts: OpeningStateCount[];
  quota: OpeningQuotaUsage;
}

model LookupOpeningTeamMemberRequest {
  email_address: Vetchium.EmailAddress;
}

model LookupOpeningTeamMemberResponse {
  member?: OpeningTeamUser;
}

model SaveOpeningWorkingCopyRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;

  /** Replaces the whole working copy; an omitted field is cleared. */
  content: Vetchium.OpeningContent;
}

model DiscardOpeningWorkingCopyRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
}

model SetOpeningTeamRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
  hiring_manager_email?: Vetchium.EmailAddress;
  recruiter_email?: Vetchium.EmailAddress;

  @maxItems(20)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  team_member_emails: Vetchium.EmailAddress[];

  @minLength(1)
  @maxLength(2000)
  internal_notes?: string;
}

model DiscardOpeningRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
}

model RequestOpeningChangeRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
  kind: OpeningRequestKind;

  @minLength(1)
  @maxLength(2000)
  note?: string;
}

model DecideOpeningRequestRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
  decision: OpeningDecision;

  @minLength(1)
  @maxLength(2000)
  note?: string;
}

model WithdrawOpeningRequestRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
}

model ListOpeningHistoryRequest {
  opening_number: OpeningNumber;
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: Vetchium.PageSize = 50;
}

model ListOpeningHistoryResponse {
  entries: OpeningHistoryEntry[];
  next_pagination_key?: Vetchium.PaginationKey;
}

alias OpeningBaseErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
  | Vetchium.Problem.OrgSuspendedErrorResponse
  | Vetchium.Problem.RateLimitExceededErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias OpeningWriteErrors =
  | OpeningBaseErrors
  | Vetchium.Problem.OrgPermissionRequiredErrorResponse
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse;

alias OpeningSummaryErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
  | Vetchium.Problem.OrgSuspendedErrorResponse
  | Vetchium.Problem.RateLimitExceededErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

@route("/api/orgs")
@tag("Org Openings")
interface OpeningOperations {
  @route("/create-opening")
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
  createOpening(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: CreateOpeningRequest,
  ):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OrgOpening;
      }
    | OpeningWriteErrors
    | Vetchium.Problem.OrgOpeningHiringTeamInvalidErrorResponse
    | Vetchium.Problem.OrgPipelineTemplateNotFoundErrorResponse
    | Vetchium.Problem.OrgOpeningsQuotaExceededErrorResponse;

  @route("/duplicate-opening")
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
  duplicateOpening(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: DuplicateOpeningRequest,
  ):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OrgOpening;
      }
    | OpeningWriteErrors
    | Vetchium.Problem.OrgOpeningNotFoundErrorResponse
    | Vetchium.Problem.OrgOpeningStateConflictErrorResponse
    | Vetchium.Problem.OrgPipelineTemplateNotFoundErrorResponse
    | Vetchium.Problem.OrgOpeningsQuotaExceededErrorResponse;

  @route("/get-opening")
  @post
  @useAuth(BearerAuth)
  getOpening(@body request: GetOpeningRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OrgOpening;
      }
    | OpeningBaseErrors
    | Vetchium.Problem.OrgOpeningNotFoundErrorResponse;

  @route("/list-openings")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["normalized-filters", "updated_at", "opening_number"]
  )
  listOpenings(@body request: ListOpeningsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListOpeningsResponse;
      }
    | OpeningBaseErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  @route("/opening-summary")
  @post
  @useAuth(BearerAuth)
  openingSummary(@body request: {}):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OpeningSummaryResponse;
      }
    | OpeningSummaryErrors
    | Vetchium.Problem.OrgOpeningNotFoundErrorResponse;

  @route("/lookup-opening-team-member")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_openings"
  )
  lookupOpeningTeamMember(@body request: LookupOpeningTeamMemberRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: LookupOpeningTeamMemberResponse;
      }
    | OpeningBaseErrors
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse;

  @route("/save-opening-working-copy")
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
  saveOpeningWorkingCopy(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: SaveOpeningWorkingCopyRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OrgOpening;
      }
    | OpeningWriteErrors
    | Vetchium.Problem.OrgOpeningNotFoundErrorResponse
    | Vetchium.Problem.OrgOpeningVersionConflictErrorResponse
    | Vetchium.Problem.OrgOpeningRequestPendingErrorResponse
    | Vetchium.Problem.OrgOpeningStateConflictErrorResponse;

  @route("/discard-opening-working-copy")
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
  discardOpeningWorkingCopy(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: DiscardOpeningWorkingCopyRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OrgOpening;
      }
    | OpeningWriteErrors
    | Vetchium.Problem.OrgOpeningNotFoundErrorResponse
    | Vetchium.Problem.OrgOpeningVersionConflictErrorResponse
    | Vetchium.Problem.OrgOpeningRequestPendingErrorResponse
    | Vetchium.Problem.OrgOpeningStateConflictErrorResponse;

  @route("/set-opening-team")
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
  setOpeningTeam(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: SetOpeningTeamRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OrgOpening;
      }
    | OpeningWriteErrors
    | Vetchium.Problem.OrgOpeningNotFoundErrorResponse
    | Vetchium.Problem.OrgOpeningVersionConflictErrorResponse
    | Vetchium.Problem.OrgOpeningStateConflictErrorResponse
    | Vetchium.Problem.OrgOpeningHiringTeamInvalidErrorResponse;

  @route("/discard-opening")
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
  discardOpening(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: DiscardOpeningRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OrgOpening;
      }
    | OpeningWriteErrors
    | Vetchium.Problem.OrgOpeningNotFoundErrorResponse
    | Vetchium.Problem.OrgOpeningVersionConflictErrorResponse
    | Vetchium.Problem.OrgOpeningRequestPendingErrorResponse
    | Vetchium.Problem.OrgOpeningStateConflictErrorResponse;

  @route("/request-opening-change")
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
  requestOpeningChange(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: RequestOpeningChangeRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OrgOpening;
      }
    | OpeningWriteErrors
    | Vetchium.Problem.OrgOpeningNotFoundErrorResponse
    | Vetchium.Problem.OrgOpeningVersionConflictErrorResponse
    | Vetchium.Problem.OrgOpeningRequestPendingErrorResponse
    | Vetchium.Problem.OrgOpeningStateConflictErrorResponse
    | Vetchium.Problem.OrgOpeningIncompleteErrorResponse
    | Vetchium.Problem.OrgOpeningHiringTeamInvalidErrorResponse;

  @route("/decide-opening-request")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:approve_openings"
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
  decideOpeningRequest(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: DecideOpeningRequestRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OrgOpening;
      }
    | OpeningWriteErrors
    | Vetchium.Problem.OrgOpeningNotFoundErrorResponse
    | Vetchium.Problem.OrgOpeningVersionConflictErrorResponse
    | Vetchium.Problem.OrgOpeningStateConflictErrorResponse
    | Vetchium.Problem.OrgOpeningIncompleteErrorResponse
    | Vetchium.Problem.OrgOpeningHiringTeamInvalidErrorResponse;

  @route("/withdraw-opening-request")
  @post
  @useAuth(BearerAuth)
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
  withdrawOpeningRequest(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: WithdrawOpeningRequestRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OrgOpening;
      }
    | OpeningWriteErrors
    | Vetchium.Problem.OrgOpeningNotFoundErrorResponse
    | Vetchium.Problem.OrgOpeningVersionConflictErrorResponse
    | Vetchium.Problem.OrgOpeningStateConflictErrorResponse;

  @route("/list-opening-history")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["opening_number", "created_at", "history_id"]
  )
  listOpeningHistory(@body request: ListOpeningHistoryRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListOpeningHistoryResponse;
      }
    | OpeningBaseErrors
    | Vetchium.Problem.OrgOpeningNotFoundErrorResponse
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;
}
