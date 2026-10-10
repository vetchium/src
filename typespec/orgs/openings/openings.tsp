import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/idempotency.tsp";
import "../../common/pagination.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/openings.tsp";
import "../../problem/orgs/suspension.tsp";
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
}

model DuplicateOpeningRequest {
  opening_number: OpeningNumber;
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

model SaveOpeningWorkingCopyRequest {
  opening_number: OpeningNumber;
  version: OpeningVersion;
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
