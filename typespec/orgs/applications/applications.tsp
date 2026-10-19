import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../common/localization.tsp";
import "../../common/pagination.tsp";
import "../../hub/profile/snapshot.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/applications.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/suspension.tsp";
import "../hiring/pipelines.tsp";
import "../openings/types.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Applications;

/** Allocated per Opening from a counter on the Opening, never reused. */
@minValue(1)
scalar ApplicationNumber extends int32;

/** Changes with every write to the application. */
@minValue(1)
scalar ApplicationVersion extends int32;

/** At most 5,000 code points. */
@minLength(1)
@maxLength(5000)
scalar ApplicationCoverNote extends string;

/**
 * A calendar date, `YYYY-MM-DD`, with no time or zone: a fact the Org records.
 */
scalar CalendarDate extends plainDate;

/** An offer letter uploaded by the caller and not yet claimed by an offer. */
@format("uuid")
scalar OfferLetterID extends string;

/** Allocated per application from 1, in the order offers were extended. */
@minValue(1)
scalar OfferNumber extends int32;

/** Days the applicant has to answer an offer. */
@minValue(1)
@maxValue(60)
scalar OfferResponseDays extends int32;

/**
 * Where an offer stands: awaiting an answer (`extended`), answered
 * (`accepted`, `declined`), unanswered by its deadline (`expired`), or ended
 * by the Org or by the application leaving the pipeline (`withdrawn`). A
 * portal older than its API shows a status it does not recognize as the raw
 * value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["extended", "accepted", "declined", "expired", "withdrawn"]
)
scalar OfferStatus extends string;

/** A case-insensitive substring of the applicant's display name. */
@minLength(2)
@maxLength(100)
scalar ApplicantNameQuery extends string;

/**
 * The state of an application. A portal older than its API shows a state it
 * does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #[
    "submitted",
    "in_pipeline",
    "offered",
    "offer_accepted",
    "offer_declined",
    "joined",
    "did_not_join",
    "not_progressing",
    "withdrawn"
  ]
)
scalar ApplicationState extends string;

/** Which list of an Opening's applications a request reads. */
enum ApplicationView {
  /** Applications in `submitted`, awaiting a shortlist decision. */
  Applicants: "applicants",

  /** Candidacies, and with a state filter the terminal ones. */
  Candidates: "candidates",
}

/**
 * Where a candidacy stands at one stage. A portal older than its API shows a
 * status it does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["pending", "completed", "skipped"]
)
scalar StageStatus extends string;

/**
 * What an application's history entry records. A portal older than its API
 * shows an action it does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #[
    "applied",
    "shortlisted",
    "stage_moved",
    "offer_extended",
    "offer_withdrawn",
    "offer_accepted",
    "offer_declined",
    "joined",
    "did_not_join",
    "not_progressing",
    "withdrawn",
    "stage_completed",
    "separated",
    "joined_corrected",
    "separated_corrected"
  ]
)
scalar ApplicationHistoryAction extends string;

/**
 * Who caused a history entry. A portal older than its API shows an actor it
 * does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["applicant", "org_user", "system"]
)
scalar ApplicationActorKind extends string;

model ApplicationSummary {
  application_number: ApplicationNumber;
  state: ApplicationState;
  version: ApplicationVersion;
  display_name: Vetchium.DisplayName;
  resident_country: Vetchium.CountryCode;

  /** The stage a candidacy is at. */
  current_stage?: Vetchium.Orgs.Hiring.PipelineStage;

  submitted_at: utcDateTime;
  updated_at: utcDateTime;
}

/** Where one candidacy stands at one stage of the Opening's pipeline. */
model ApplicationStageRecord {
  stage: Vetchium.Orgs.Hiring.PipelineStage;
  status: StageStatus;
}

/** One offer of an application, with a short-lived link to its letter. */
model ApplicationOffer {
  offer_number: OfferNumber;
  status: OfferStatus;

  /** A signed `GET` link to the PDF letter, valid for ten minutes. */
  letter_url: url;

  /** The letter's size in bytes. */
  letter_byte_size: int32;

  proposed_joining_date?: CalendarDate;

  /** The applicant answers before this instant, or the offer expires. */
  respond_by: utcDateTime;

  extended_at: utcDateTime;

  /** When the offer was answered, expired, or withdrawn. */
  ended_at?: utcDateTime;
}

model ApplicationDetail {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: ApplicationNumber;
  state: ApplicationState;
  version: ApplicationVersion;
  snapshot: Vetchium.Hub.Profile.ApplicantSnapshot;
  cover_note?: ApplicationCoverNote;
  current_stage?: Vetchium.Orgs.Hiring.PipelineStage;

  /** The candidacy's stages in pipeline order; empty before shortlisting. */
  stage_records: ApplicationStageRecord[];

  /** Present once joined. */
  joined_on?: CalendarDate;

  /** Present once a separation is recorded. */
  separated_on?: CalendarDate;

  /** The Opening's live `positions`, so a portal can warn on over-hiring. */
  positions: int32;

  /** Applications of the Opening in `joined`, this one included. */
  joined_count: int32;

  /** Every offer of the application, newest first, withdrawn ones included. */
  offers: ApplicationOffer[];

  submitted_at: utcDateTime;
  updated_at: utcDateTime;
}

model ApplicationHistoryEntry {
  action: ApplicationHistoryAction;
  actor: ApplicationActorKind;

  /** Present for an Org user who is still in the Org. */
  actor_email?: Vetchium.EmailAddress;

  /** The application's state after the entry. */
  state: ApplicationState;

  version: ApplicationVersion;

  /** The stage a shortlist, move, or completion concerns. */
  stage?: Vetchium.Orgs.Hiring.PipelineStage;

  /** The date a joining or its correction recorded. */
  joined_on?: CalendarDate;

  /** The date a separation or its correction recorded. */
  separated_on?: CalendarDate;

  created_at: utcDateTime;
}

model ApplicationStateCount {
  state: ApplicationState;
  count: int32;
}

model StageApplicationCount {
  stage: Vetchium.Orgs.Hiring.PipelineStage;

  /** Candidacies currently at the stage. */
  count: int32;
}

model ApplicationCounts {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;

  /** One entry per state, zero included. */
  states: ApplicationStateCount[];

  /** One entry per stage in pipeline order, zero included. */
  stages: StageApplicationCount[];
}

model ListApplicationsRequest {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  view: ApplicationView;

  /**
   * Candidates view only. Omission lists `in_pipeline`, `offered`, and
   * `offer_accepted`; name terminal states to list them.
   */
  @minItems(1)
  @maxItems(8)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  states?: ApplicationState[];

  /** Candidates view only: candidacies currently at this stage. */
  stage_id?: Vetchium.Orgs.Hiring.PipelineStageID;

  name_query?: ApplicantNameQuery;
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: Vetchium.PageSize = 50;
}

model ListApplicationsResponse {
  applications: ApplicationSummary[];
  next_pagination_key?: Vetchium.PaginationKey;
}

model GetApplicationRequest {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: ApplicationNumber;
}

model GetApplicationCountsRequest {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
}

model ListApplicationHistoryRequest {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: ApplicationNumber;
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: Vetchium.PageSize = 50;
}

model ListApplicationHistoryResponse {
  entries: ApplicationHistoryEntry[];
  next_pagination_key?: Vetchium.PaginationKey;
}

model ApplicationReference {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: ApplicationNumber;

  /** The `version` the caller last read. */
  version: ApplicationVersion;
}

/** Requests that name no further input. */
model ApplicationActionRequest {
  ...ApplicationReference;
}

/** Shortlists a `submitted` application, or moves a candidacy forward. */
model ApplicationStageRequest {
  ...ApplicationReference;

  /** A stage of the Opening's pipeline. */
  stage_id: Vetchium.Orgs.Hiring.PipelineStageID;
}

/** Records or corrects when the candidate joined. */
model ApplicationJoinedOnRequest {
  ...ApplicationReference;

  /** At most today and not before the offer was extended. */
  joined_on: CalendarDate;
}

/** Records or corrects when the employee separated. */
model ApplicationSeparatedOnRequest {
  ...ApplicationReference;

  /** After `joined_on`, within 365 days of it, and at most today. */
  separated_on: CalendarDate;
}

/** Extends an offer to an `in_pipeline` candidacy at any stage. */
model ExtendApplicationOfferRequest {
  ...ApplicationReference;

  /** The caller's own letter from `upload-offer-letter`, not yet claimed. */
  letter_id: OfferLetterID;

  /** On or after today. */
  proposed_joining_date?: CalendarDate;

  respond_within_days: OfferResponseDays;
}

model OfferLetterUploaded {
  letter_id: OfferLetterID;
}

/**
 * Reading is authorized by the Opening's team or `org:manage_candidacies`, so
 * a caller without access sees the same not-found as an unknown number.
 */
alias ApplicationReadErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
  | Vetchium.Problem.OrgSuspendedErrorResponse
  | Vetchium.Problem.RateLimitExceededErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse
  | Vetchium.Problem.OrgApplicationNotFoundErrorResponse;

/**
 * Acting is authorized by the Opening's hiring manager, its recruiter, or
 * `org:manage_candidacies`; a reader without that gets the permission
 * problem, a caller who cannot read the application gets not-found.
 */
alias ApplicationWriteErrors =
  | ApplicationReadErrors
  | Vetchium.Problem.OrgPermissionRequiredErrorResponse
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
  | Vetchium.Problem.OrgApplicationVersionConflictErrorResponse
  | Vetchium.Problem.OrgApplicationStateConflictErrorResponse;

@route("/api/orgs")
@tag("Org Applications")
interface ApplicationOperations {
  @route("/list-applications")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["normalized-filters", "application_number"]
  )
  listApplications(@body request: ListApplicationsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListApplicationsResponse;
      }
    | ApplicationReadErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  @route("/get-application")
  @post
  @useAuth(BearerAuth)
  getApplication(@body request: GetApplicationRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationReadErrors;

  @route("/get-application-counts")
  @post
  @useAuth(BearerAuth)
  getApplicationCounts(@body request: GetApplicationCountsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationCounts;
      }
    | ApplicationReadErrors;

  @route("/list-application-history")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["opening_number", "application_number", "created_at", "history_id"]
  )
  listApplicationHistory(@body request: ListApplicationHistoryRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListApplicationHistoryResponse;
      }
    | ApplicationReadErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  @route("/shortlist-application")
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
  shortlistApplication(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ApplicationStageRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors;

  @route("/move-application-stage")
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
  moveApplicationStage(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ApplicationStageRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors;

  @route("/complete-application-stage")
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
  completeApplicationStage(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ApplicationActionRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors;

  @route("/mark-application-not-progressing")
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
  markApplicationNotProgressing(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ApplicationActionRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors;

  @route("/record-application-joined")
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
  recordApplicationJoined(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ApplicationJoinedOnRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors;

  @route("/record-application-did-not-join")
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
  recordApplicationDidNotJoin(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ApplicationActionRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors;

  @route("/record-application-separated")
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
  recordApplicationSeparated(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ApplicationSeparatedOnRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors;

  @route("/correct-application-joined-on")
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
  correctApplicationJoinedOn(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ApplicationJoinedOnRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors;

  @route("/correct-application-separated-on")
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
  correctApplicationSeparatedOn(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ApplicationSeparatedOnRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors;

  /**
   * Stores a PDF offer letter for the caller's next offer. The body is the
   * letter itself, at most 5,242,880 bytes, starting with `%PDF-`. The
   * caller must act on some Opening's applications. The letter is claimable
   * for one hour by `extend-application-offer`; a newer upload by the same
   * user supersedes an unclaimed one.
   */
  @route("/upload-offer-letter")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  uploadOfferLetter(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @header("Content-Type") content_type: "application/pdf",
    @body body: bytes,
  ):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OfferLetterUploaded;
      }
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.OrgOfferLetterInvalidErrorResponse
    | Vetchium.Problem.OrgOfferLetterTooLargeErrorResponse
    | Vetchium.Problem.OrgOfferLetterConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/extend-application-offer")
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
  extendApplicationOffer(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ExtendApplicationOfferRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors;

  @route("/withdraw-application-offer")
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
  withdrawApplicationOffer(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ApplicationActionRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors;
}
