import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../common/pagination.tsp";
import "../../orgs/applications/applications.tsp";
import "../../orgs/hiring/vocabulary.tsp";
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
 * routing, results, and feedback never reach the Hub. `declined` is the
 * applicant turning the job down: declining the offer, or accepting it and
 * not joining. `joined`, `not_selected`, `declined`, and `withdrawn` are
 * closed; the rest are active. A portal older than its API shows a status it
 * does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #[
    "applied",
    "in_review",
    "interviewing",
    "offered",
    "offer_accepted",
    "joined",
    "not_selected",
    "declined",
    "withdrawn"
  ]
)
scalar ApplicationStatus extends string;

/** Which of the applicant's applications a list reads, by status. */
enum MyApplicationView {
  Active: "active",
  Closed: "closed",
}

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

@minLength(1)
@maxLength(200)
scalar MyApplicationQuery extends string;

model ApplyToOpeningRequest {
  domain: Vetchium.Orgs.OrgDomain;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;

  /** Trimmed; a blank note is no note. */
  cover_note?: Vetchium.Orgs.Applications.ApplicationCoverNote;

  /** Primary domain of the agency to credit with this application. */
  referral_agency_domain?: Vetchium.Orgs.OrgDomain;

  /**
   * Answers to the Opening's live questions, trimmed; a blank text answer is
   * no answer. The Org's tenant checks them (HP-QST-004).
   */
  @maxItems(10)
  answers?: Vetchium.Orgs.Applications.ApplicationAnswer[];
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

/**
 * What the applicant sees of an interview: `scheduled`, or `cancelled` so a
 * dropped interview is not mistaken for a pending one. How a finished
 * interview went is the Org's alone and never reaches the Hub. A portal older
 * than its API shows a state it does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["scheduled", "cancelled"]
)
scalar MyInterviewState extends string;

/** An interview of the application, without stage name or interviewers. */
model MyApplicationInterview {
  interview_number: Vetchium.Orgs.Applications.InterviewNumber;
  state: MyInterviewState;
  starts_at: utcDateTime;
  duration_minutes: Vetchium.Orgs.Applications.InterviewDurationMinutes;
  mode: Vetchium.Orgs.Applications.InterviewMode;

  /** `video` only. */
  video_url?: string;

  /** `in_person` only. */
  location?: Vetchium.Orgs.Applications.InterviewLocation;

  /** The applicant's answer; `pending` until they accept or ask to move it. */
  response: Vetchium.Orgs.Applications.InterviewResponse;

  /** Present while `response` is `reschedule_requested`. */
  reschedule_note?: Vetchium.Orgs.Applications.InterviewRescheduleNote;

  /** The provider holding the interview for the Org; absent when in-house. */
  provider?: Vetchium.Orgs.Marketplace.EngagementCounterparty;
}

/**
 * The background-check consent request awaiting the applicant: the check
 * types, and who performs them. Nothing is recorded until they consent.
 */
model MyBackgroundCheckConsent {
  check_number: Vetchium.Orgs.Applications.BackgroundCheckNumber;
  check_types: Vetchium.Orgs.Hiring.CheckType[];
  performer: Vetchium.Orgs.Applications.WorkPerformer;

  /** The provider performing the checks, when `performer` is `provider`. */
  provider?: Vetchium.Orgs.Marketplace.EngagementCounterparty;

  /** The provider's text the applicant consents to; with a provider only. */
  disclosure?: string;

  requested_at: utcDateTime;
}

/** The live read of one application, with what the applicant may act on. */
model MyApplicationDetail {
  ...MyApplication;
  offer?: MyApplicationOffer;

  /** Present while consent awaits the applicant. */
  background_check_consent?: MyBackgroundCheckConsent;

  /** Earliest start first; empty when none was scheduled. */
  interviews: MyApplicationInterview[];

  /** The questions as asked when applying, with the applicant's answers. */
  answers: Vetchium.Orgs.Applications.AnsweredQuestion[];
}

/** Names an interview of the application, by its number. */
model InterviewReference {
  ...ApplicationReference;
  interview_number: Vetchium.Orgs.Applications.InterviewNumber;
}

/** Accepts an upcoming interview. */
model AcceptInterviewRequest {
  ...InterviewReference;
}

/** Asks the Org to move an upcoming interview. */
model RequestInterviewRescheduleRequest {
  ...InterviewReference;
  note: Vetchium.Orgs.Applications.InterviewRescheduleNote;
}

/** Answers the consent request the applicant read, named by its number. */
model BackgroundCheckConsentRequest {
  ...ApplicationReference;
  check_number: Vetchium.Orgs.Applications.BackgroundCheckNumber;
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
  view: MyApplicationView;

  /** Trimmed; a blank query is no query. Matches a substring of the Org's
   * display name or the Opening title, ignoring case. */
  query?: MyApplicationQuery;

  /** True lists only applications with a pending action; false is the same
   * as omission. */
  awaiting_answer?: boolean;

  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: MyApplicationPageSize = 50;
}

model ListMyApplicationsResponse {
  /** Newest activity first. */
  applications: MyApplicationSummary[];

  next_pagination_key?: Vetchium.PaginationKey;
}

/** Counted from the same projection as the list. */
model MyApplicationCounts {
  active: int32;
  closed: int32;

  /** Applications with at least one pending action. */
  awaiting_answer: int32;
}

/** Names an Opening the caller may have applied to. */
model FindMyOpeningApplicationRequest {
  domain: Vetchium.Orgs.OrgDomain;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
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
    | Vetchium.Problem.HubApplicationExistsErrorResponse
    | Vetchium.Problem.HubApplicationAnswersInvalidErrorResponse
    | Vetchium.Problem.HubReferralAgencyNotEligibleErrorResponse;

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
    #["view", "normalized-filters", "last_activity_at", "projection_id"]
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

  /** Counts the caller's applications in each view of the list. */
  @route("/my-application-counts")
  @get
  @useAuth(BearerAuth)
  counts():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: MyApplicationCounts;
      }
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Reads the caller's application to an Opening from the list's projection;
   * none is `hub-application-not-found`. */
  @route("/find-my-opening-application")
  @post
  @useAuth(BearerAuth)
  findForOpening(@body request: FindMyOpeningApplicationRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: MyApplicationSummary;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.HubApplicationNotFoundErrorResponse
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

  /** Accepts an upcoming interview, with the same outcomes as applying. An
   * interview that is unknown or not the applicant's is
   * `hub-application-not-found`; one that is cancelled, past, or already
   * accepted is `hub-application-state-conflict`. */
  @route("/accept-application-interview")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 2592000)
  @useAuth(BearerAuth)
  acceptInterview(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: AcceptInterviewRequest,
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

  /** Asks the Org to reschedule an upcoming interview, with a note, and the
   * same outcomes and refusals as accepting it. */
  @route("/request-application-interview-reschedule")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 2592000)
  @useAuth(BearerAuth)
  requestInterviewReschedule(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: RequestInterviewRescheduleRequest,
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

  /** Gives consent to the background-check request the body names, with the
   * same outcomes as applying. A request that is unknown is
   * `hub-application-not-found`; one already answered or ended, or an
   * application that left the pipeline, is `hub-application-state-conflict`. */
  @route("/give-application-background-check-consent")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 2592000)
  @useAuth(BearerAuth)
  giveBackgroundCheckConsent(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: BackgroundCheckConsentRequest,
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

  /** Declines consent to the background-check request the body names, with
   * the same outcomes and refusals as giving it. Declining completes
   * nothing; the Org decides what follows. */
  @route("/decline-application-background-check-consent")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 2592000)
  @useAuth(BearerAuth)
  declineBackgroundCheckConsent(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: BackgroundCheckConsentRequest,
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
