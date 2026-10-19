import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../common/pagination.tsp";
import "../../orgs/applications/applications.tsp";
import "../../orgs/openings/types.tsp";
import "../../orgs/types.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/applications.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/openings.tsp";
import "../operations/operations.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Applications;

/**
 * Where an application stands for the applicant, derived at the Org's tenant
 * from its state and current stage kind and never stored there. Stage names,
 * routing, results, and feedback never reach the Hub. A portal older than its
 * API shows a status it does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #[
    "applied",
    "in_review",
    "interviewing",
    "offer",
    "hired",
    "not_progressing",
    "withdrawn"
  ]
)
scalar ApplicationStatus extends string;

/**
 * An action awaiting the applicant. A portal older than its API shows a kind
 * it does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["interview_response", "background_check_consent", "offer_response"]
)
scalar PendingActionKind extends string;

@minValue(1)
@maxValue(50)
scalar MyApplicationPageSize extends int32;

model ApplyToOpeningRequest {
  domain: Vetchium.Orgs.OrgDomain;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;

  /** Trimmed; a blank note is no note. */
  cover_note?: Vetchium.Orgs.Applications.ApplicationCoverNote;
}

/** Names one application on the wire. */
model ApplicationReference {
  domain: Vetchium.Orgs.OrgDomain;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
}

model WithdrawApplicationRequest {
  ...ApplicationReference;
}

model GetMyApplicationRequest {
  ...ApplicationReference;
}

/** What the applicant sees of an application: never stage names, routing,
 * results, or feedback. */
model MyApplication {
  org_domain: Vetchium.Orgs.OrgDomain;
  org_display_name: Vetchium.DisplayName;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  opening_title: string;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
  status: ApplicationStatus;

  /** Empty when nothing awaits the applicant. */
  pending_actions: PendingActionKind[];
}

/**
 * The application's latest offer, unless the Org withdrew it. Its letter
 * link is signed by the Org's tenant and opens from any region.
 */
model MyApplicationOffer {
  offer_number: Vetchium.Orgs.Applications.OfferNumber;

  /** `extended`, `accepted`, `declined`, or `expired`; never `withdrawn`. */
  status: Vetchium.Orgs.Applications.OfferStatus;

  /** A signed `GET` link to the PDF letter, valid for ten minutes. */
  letter_url: url;

  letter_byte_size: int32;
  proposed_joining_date?: Vetchium.Orgs.Applications.CalendarDate;

  /** Answer before this instant; afterwards the offer counts as declined. */
  respond_by: utcDateTime;

  extended_at: utcDateTime;
}

/** The live read of one application, with what the applicant may act on. */
model MyApplicationDetail {
  ...MyApplication;
  offer?: MyApplicationOffer;
}

/** Answers the offer the applicant read, named by its number. */
model RespondToOfferRequest {
  ...ApplicationReference;
  offer_number: Vetchium.Orgs.Applications.OfferNumber;
}

/** A list entry, read from the applicant's home tenant's projection, which
 * may trail the Org's tenant briefly. */
model MyApplicationSummary {
  ...MyApplication;
  applied_at: utcDateTime;
  last_activity_at: utcDateTime;
}

model ListMyApplicationsRequest {
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: MyApplicationPageSize = 50;
}

model ListMyApplicationsResponse {
  /** Newest activity first. */
  applications: MyApplicationSummary[];

  next_pagination_key?: Vetchium.PaginationKey;
}

alias ApplicationWriteErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
  | Vetchium.Problem.HubOrgUnavailableErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias PendingApplicationResponse = {
  @statusCode status_code: 202;
  @header("Cache-Control") cache_control: "no-store";
  @body body: Vetchium.Hub.Operations.PendingOperation;
};

@route("/api/hub")
@tag("Hub Applications")
interface ApplicationOperations {
  /**
   * Applies the signed-in Hub user to a published Opening with a snapshot of
   * their profile, through a durable command to the Org's tenant. `202` means
   * the outcome is not yet known: poll the operation and replay this request
   * with the same `Idempotency-Key`. `503` means nothing was sent.
   */
  @route("/apply-to-opening")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 2592000)
  @useAuth(BearerAuth)
  apply(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ApplyToOpeningRequest,
  ):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationReference;
      }
    | PendingApplicationResponse
    | ApplicationWriteErrors
    | Vetchium.Problem.HubOrgNotFoundErrorResponse
    | Vetchium.Problem.HubOpeningNotFoundErrorResponse
    | Vetchium.Problem.HubOpeningNotAcceptingErrorResponse
    | Vetchium.Problem.HubApplicationExistsErrorResponse;

  /** Withdraws the caller's own application from `submitted`, `in_pipeline`,
   * `offered`, or `offer_accepted`, with the same outcomes as applying. */
  @route("/withdraw-application")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 2592000)
  @useAuth(BearerAuth)
  withdraw(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: WithdrawApplicationRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationReference;
      }
    | PendingApplicationResponse
    | ApplicationWriteErrors
    | Vetchium.Problem.HubApplicationNotFoundErrorResponse
    | Vetchium.Problem.HubApplicationStateConflictErrorResponse;

  @route("/list-my-applications")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["last_activity_at", "projection_id"]
  )
  list(@body request: ListMyApplicationsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListMyApplicationsResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Reads the application live from the Org's tenant, bounded by a
   * deadline; an unreachable tenant or directory is `hub-org-unavailable`. */
  @route("/get-my-application")
  @post
  @useAuth(BearerAuth)
  get(@body request: GetMyApplicationRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: MyApplicationDetail;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.HubApplicationNotFoundErrorResponse
    | Vetchium.Problem.HubOrgUnavailableErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Accepts the offer the request names, moving the application to `offer_accepted`,
   * with the same outcomes as applying. Another offer, a state other than
   * `offered`, or a passed deadline is `hub-application-state-conflict`. */
  @route("/accept-application-offer")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 2592000)
  @useAuth(BearerAuth)
  acceptOffer(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: RespondToOfferRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationReference;
      }
    | PendingApplicationResponse
    | ApplicationWriteErrors
    | Vetchium.Problem.HubApplicationNotFoundErrorResponse
    | Vetchium.Problem.HubApplicationStateConflictErrorResponse;

  /** Declines the offer the request names, moving the application to `offer_declined`,
   * with the same outcomes as applying. Another offer, a state other than
   * `offered`, or a passed deadline is `hub-application-state-conflict`. */
  @route("/decline-application-offer")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 2592000)
  @useAuth(BearerAuth)
  declineOffer(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: RespondToOfferRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationReference;
      }
    | PendingApplicationResponse
    | ApplicationWriteErrors
    | Vetchium.Problem.HubApplicationNotFoundErrorResponse
    | Vetchium.Problem.HubApplicationStateConflictErrorResponse;
}
