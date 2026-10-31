import "@typespec/http";
import "@typespec/openapi";

import "../../../common/authentication.tsp";
import "../../../common/idempotency.tsp";
import "../../../common/localization.tsp";
import "../../../common/pagination.tsp";
import "../../../directory/directory.tsp";
import "../../../hub/profile/snapshot.tsp";
import "../../../problem/common.tsp";
import "../../../problem/details.tsp";
import "../../../problem/orgs/applications.tsp";
import "../../../problem/orgs/authentication.tsp";
import "../../../problem/orgs/marketplace.tsp";
import "../../../problem/orgs/suspension.tsp";
import "../../applications/applications.tsp";
import "../../hiring/vocabulary.tsp";
import "../../openings/types.tsp";
import "../../operations/operations.tsp";
import "../attribution.tsp";
import "../capabilities.tsp";
import "../contacts/contacts.tsp";
import "../engagements.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Marketplace.Work;

/**
 * Names one routed candidacy to its provider. It changes whenever the
 * candidacy is routed again, so an old id never reaches new work.
 */
@format("uuid")
scalar WorkID extends string;

/**
 * Where a routed candidacy stands for its provider. A portal older than its
 * API shows a status it does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["pending", "scheduled", "awaiting_consent", "in_progress", "completed"]
)
scalar WorkStatus extends string;

/** An Opening as its provider names it. */
model WorkOpening {
  number: Vetchium.Orgs.Openings.OpeningNumber;
  title: string;
  employing_country?: Vetchium.CountryCode;
}

/** One routed candidacy in a list. */
model WorkItem {
  work_id: WorkID;
  engagement_id: EngagementID;

  /** The consumer. */
  client: EngagementCounterparty;

  capability: Capability;
  opening: WorkOpening;
  stage_name: string;
  status: WorkStatus;
  applicant_name: Vetchium.DisplayName;

  /** The earliest upcoming interview the provider scheduled. */
  next_interview_at?: utcDateTime;

  routed_at: utcDateTime;
}

/**
 * A routed candidacy and what its provider may see: the snapshot, the cover
 * note, and the provider's own work, never another stage, provider, or
 * result, the hiring team, notes, or offers.
 */
model WorkDetail {
  item: WorkItem;
  snapshot: Vetchium.Hub.Profile.ApplicantSnapshot;
  cover_note?: Vetchium.Orgs.Applications.ApplicationCoverNote;
  interviews: Vetchium.Orgs.Applications.Interview[];
  assessment?: Vetchium.Orgs.Applications.AssessmentResult;
  background_check?: Vetchium.Orgs.Applications.BackgroundCheck;
}

/** Names a routed candidacy by its engagement and work id. */
model WorkReference {
  engagement_id: EngagementID;
  work_id: WorkID;
}

@minValue(1)
@maxValue(50)
scalar WorkPageSize extends int32;

model ListWorkQueueRequest {
  client_domain?: Vetchium.Orgs.OrgDomain;
  capability?: Capability;

  /** With `client_domain` only: Opening numbers are per client. */
  opening_number?: Vetchium.Orgs.Openings.OpeningNumber;

  @minLength(1)
  @maxLength(100)
  stage_name?: string;

  status?: WorkStatus;
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: WorkPageSize = 50;
}

model ListWorkQueueResponse {
  items: WorkItem[];

  /** Tenants that did not answer, so the queue is incomplete. */
  unavailable_tenants: Vetchium.Directory.TenantID[];

  next_pagination_key?: Vetchium.PaginationKey;
}

/**
 * Counts the changes to a Job's owner; 0 before the Job first had one. It
 * keeps rising when the owner is cleared, so a stale write never matches.
 */
@minValue(0)
scalar JobOwnerVersion extends int32;

/**
 * An Opening assigned to a `sourcing` engagement. `credited_count` counts
 * the applications credited to the agency, not to one of its users.
 */
model Job {
  engagement_id: EngagementID;
  client: EngagementCounterparty;
  opening: WorkOpening;
  state: Vetchium.Orgs.Openings.OpeningState;
  credited_count: int32;
  assigned_at: utcDateTime;

  /**
   * The agency user who looks after the Job. The agency's own tenant keeps
   * it and sets it with `owner_version`; a client's tenant never sends
   * either.
   */
  owner?: Vetchium.EmailAddress;

  owner_version?: JobOwnerVersion;
}

model JobCreditedApplication {
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
  route: ReferralRoute;
  status: Vetchium.Hub.Applications.ApplicationStatus;
  applied_at: utcDateTime;
}

model JobSuggestedContact {
  contact_id: Contacts.ContactID;
  display_name: Vetchium.DisplayName;
  handle: Vetchium.Hub.HubHandle;
  suggested_at: utcDateTime;
}

/** The Opening's live content, as Hub users see a published one. */
model JobDetail {
  job: Job;
  content: Vetchium.OpeningContent;
  credited_applications: JobCreditedApplication[];
  suggested_contacts: JobSuggestedContact[];
}

model JobReference {
  engagement_id: EngagementID;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
}

/** A title substring or an Opening number, trimmed. */
@minLength(1)
@maxLength(100)
scalar JobSearchText extends string;

model ListJobsRequest {
  client_domain?: Vetchium.Orgs.OrgDomain;

  /** Defaults to `published`. */
  state?: Vetchium.Orgs.Openings.OpeningState;

  /**
   * Only the Jobs this agency user owns. An address that owns none, or is
   * not the agency's, lists nothing.
   */
  owner_email?: Vetchium.EmailAddress;

  /** Matches the title case-insensitively, or the Opening number exactly. */
  search?: JobSearchText;

  employing_country?: Vetchium.CountryCode;
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: WorkPageSize = 50;
}

model ListJobsResponse {
  jobs: Job[];
  unavailable_tenants: Vetchium.Directory.TenantID[];
  next_pagination_key?: Vetchium.PaginationKey;
}

/**
 * Sets or clears the one agency user who looks after a Job. Any user with
 * `org:fulfil_engagements` may set any colleague who also holds it; the
 * agency's tenant keeps the owner and no client sees it.
 */
model SetJobOwnerRequest {
  engagement_id: EngagementID;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;

  /** The `owner_version` the caller read; 0 when the Job never had an owner. */
  owner_version: JobOwnerVersion;

  /**
   * An active user of the agency holding `org:fulfil_engagements`. Absent
   * clears the owner.
   */
  owner_email?: Vetchium.EmailAddress;
}

model JobOwnership {
  owner?: Vetchium.EmailAddress;
  owner_version: JobOwnerVersion;
}

/** The most suggestions one autocomplete answer holds. */
@minValue(1)
@maxValue(20)
scalar SuggestionLimit extends int32;

/** Text an autocomplete matches, trimmed. */
@minLength(1)
@maxLength(100)
scalar SuggestionQuery extends string;

/**
 * Suggests the agency's users who may own a Job: active, holding
 * `org:fulfil_engagements`, whose address contains `query`
 * case-insensitively. It answers at most `limit` in address order and has no
 * further pages: typing more narrows it.
 */
model SuggestJobOwnersRequest {
  query?: SuggestionQuery;

  /** Defaults to 20. */
  limit?: SuggestionLimit = 20;
}

model SuggestJobOwnersResponse {
  owners: Vetchium.EmailAddress[];
}

/**
 * Suggests the Org's clients: the consumers of its active engagements as
 * provider, of `capability` when given, whose display name or domain
 * contains `query` case-insensitively. It answers at most `limit`, ordered by
 * display name then domain, and has no further pages: typing more narrows
 * it.
 */
model SuggestClientsRequest {
  capability?: Capability;
  query?: SuggestionQuery;

  /** Defaults to 20. */
  limit?: SuggestionLimit = 20;
}

model SuggestClientsResponse {
  clients: EngagementCounterparty[];
}

/** The work a write names, and its status afterwards. */
model WorkWriteResult {
  work_id: WorkID;
  status: WorkStatus;

  /** The interview a scheduling created or another interview write touched. */
  interview_number?: Vetchium.Orgs.Applications.InterviewNumber;
}

model WorkInterviewReference {
  ...WorkReference;
  interview_number: Vetchium.Orgs.Applications.InterviewNumber;
}

model ScheduleWorkInterviewRequest {
  ...WorkReference;
  ...Vetchium.Orgs.Applications.InterviewDetails;
}

model ChangeWorkInterviewRequest {
  ...WorkInterviewReference;
  ...Vetchium.Orgs.Applications.InterviewDetails;
}

model RecordWorkInterviewOutcomeRequest {
  ...WorkInterviewReference;
  outcome: Vetchium.Orgs.Applications.InterviewOutcome;
}

model SubmitWorkInterviewFeedbackRequest {
  ...WorkInterviewReference;
  recommendation: Vetchium.Orgs.Applications.InterviewRecommendation;
  notes: Vetchium.Orgs.Applications.InterviewFeedbackNotes;

  /** Answers to the consumer's form for the stage (HP-FRM-004). */
  @maxItems(10)
  criteria_answers?: Vetchium.Orgs.Applications.CriterionAnswer[];
}

model RecordWorkAssessmentRequest {
  ...WorkReference;
  outcome: Vetchium.Orgs.Applications.AssessmentOutcome;
  score?: Vetchium.Orgs.Applications.AssessmentScore;
  notes?: Vetchium.Orgs.Applications.ResultNotes;
  report_url?: Vetchium.Hub.Profile.WebsiteURL;
}

model RecordWorkBackgroundCheckResultRequest {
  ...WorkReference;
  check_type: Vetchium.Orgs.Hiring.CheckType;
  outcome: Vetchium.Orgs.Applications.CheckOutcome;
  notes?: Vetchium.Orgs.Applications.ResultNotes;
  report_url?: Vetchium.Hub.Profile.WebsiteURL;
}

alias WorkReadErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
  | Vetchium.Problem.OrgPermissionRequiredErrorResponse
  | Vetchium.Problem.OrgSuspendedErrorResponse
  | Vetchium.Problem.RateLimitExceededErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

/**
 * A provider write is a durable command to the client's tenant: an uncertain
 * outcome is `202` with a pending operation, and a client tenant that was
 * never reached is `503`. Every work item the provider may not reach is
 * `org-engagement-work-not-found`.
 */
alias WorkWriteErrors =
  | WorkReadErrors
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
  | Vetchium.Problem.OrgEngagementWorkNotFoundErrorResponse
  | Vetchium.Problem.OrgTenantUnavailableErrorResponse;

@route("/api/orgs")
@tag("Org provider work")
interface WorkOperations {
  /** Lists the candidacies routed to the Org's engagements, live from each client tenant, upcoming interviews first. A tenant that does not answer is named, and its work is missing. */
  @route("/list-work-queue")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  listWorkQueue(@body request: ListWorkQueueRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListWorkQueueResponse;
      }
    | WorkReadErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  /** Reads one routed candidacy as its provider may see it: the application snapshot, cover note, stage name, and the provider's own work. */
  @route("/get-work-item")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  getWorkItem(@body request: WorkReference):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: WorkDetail;
      }
    | WorkReadErrors
    | Vetchium.Problem.OrgEngagementWorkNotFoundErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse;

  /** Lists the Openings assigned to the Org's `sourcing` engagements, live from each client tenant. A tenant that does not answer is named. */
  @route("/list-jobs")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  listJobs(@body request: ListJobsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListJobsResponse;
      }
    | WorkReadErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  /** Reads one assigned Opening's live content. */
  @route("/get-job")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  getJob(@body request: JobReference):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: JobDetail;
      }
    | WorkReadErrors
    | Vetchium.Problem.OrgEngagementWorkNotFoundErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse;

  /**
   * Sets or clears the agency user who looks after a Job of an active
   * `sourcing` engagement. An owner who already looks after 200 Jobs of
   * active engagements takes no more.
   */
  @route("/set-job-owner")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
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
  setJobOwner(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: SetJobOwnerRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: JobOwnership;
      }
    | WorkReadErrors
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.OrgEngagementWorkNotFoundErrorResponse
    | Vetchium.Problem.OrgJobOwnerInvalidErrorResponse
    | Vetchium.Problem.OrgJobOwnerLimitReachedErrorResponse
    | Vetchium.Problem.OrgJobOwnerVersionConflictErrorResponse;

  /** Suggests the agency users who may own a Job, for an autocomplete. */
  @route("/suggest-job-owners")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  suggestJobOwners(@body request: SuggestJobOwnersRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: SuggestJobOwnersResponse;
      }
    | WorkReadErrors;

  /** Suggests the Org's clients by name or domain, for an autocomplete. */
  @route("/suggest-clients")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  suggestClients(@body request: SuggestClientsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: SuggestClientsResponse;
      }
    | WorkReadErrors;

  /** Schedules an interview of a routed candidacy at an interview stage. The interviewers are the provider's own active users with `org:fulfil_engagements`. */
  @route("/schedule-work-interview")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
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
  scheduleWorkInterview(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ScheduleWorkInterviewRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: WorkWriteResult;
      }
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Orgs.Operations.PendingOperation;
      }
    | WorkWriteErrors
    | Vetchium.Problem.OrgApplicationStateConflictErrorResponse
    | Vetchium.Problem.OrgInterviewLimitReachedErrorResponse
    | Vetchium.Problem.OrgInterviewInterviewersInvalidErrorResponse;

  /** Replaces the details and interviewers of an upcoming interview the provider scheduled. */
  @route("/change-work-interview")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
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
  changeWorkInterview(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ChangeWorkInterviewRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: WorkWriteResult;
      }
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Orgs.Operations.PendingOperation;
      }
    | WorkWriteErrors
    | Vetchium.Problem.OrgInterviewNotFoundErrorResponse
    | Vetchium.Problem.OrgInterviewStateConflictErrorResponse
    | Vetchium.Problem.OrgInterviewInterviewersInvalidErrorResponse;

  /** Cancels an upcoming interview the provider scheduled. */
  @route("/cancel-work-interview")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
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
  cancelWorkInterview(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: WorkInterviewReference,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: WorkWriteResult;
      }
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Orgs.Operations.PendingOperation;
      }
    | WorkWriteErrors
    | Vetchium.Problem.OrgInterviewNotFoundErrorResponse
    | Vetchium.Problem.OrgInterviewStateConflictErrorResponse;

  /** Records `completed` or `no_show` once the interview started. */
  @route("/record-work-interview-outcome")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
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
  recordWorkInterviewOutcome(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: RecordWorkInterviewOutcomeRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: WorkWriteResult;
      }
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Orgs.Operations.PendingOperation;
      }
    | WorkWriteErrors
    | Vetchium.Problem.OrgInterviewNotFoundErrorResponse
    | Vetchium.Problem.OrgInterviewStateConflictErrorResponse;

  /** Submits the caller's feedback, once, as an interviewer of a completed interview. */
  @route("/submit-work-interview-feedback")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
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
  submitWorkInterviewFeedback(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: SubmitWorkInterviewFeedbackRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: WorkWriteResult;
      }
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Orgs.Operations.PendingOperation;
      }
    | WorkWriteErrors
    | Vetchium.Problem.OrgInterviewNotFoundErrorResponse
    | Vetchium.Problem.OrgInterviewStateConflictErrorResponse
    | Vetchium.Problem.OrgInterviewFeedbackExistsErrorResponse
    | Vetchium.Problem.OrgInterviewFeedbackAnswersInvalidErrorResponse;

  /** Records the assessment result of a routed candidacy, once. */
  @route("/record-work-assessment")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
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
  recordWorkAssessment(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: RecordWorkAssessmentRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: WorkWriteResult;
      }
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Orgs.Operations.PendingOperation;
      }
    | WorkWriteErrors
    | Vetchium.Problem.OrgApplicationStateConflictErrorResponse;

  /** Records one background check's result after the applicant consented. */
  @route("/record-work-background-check-result")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
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
  recordWorkBackgroundCheckResult(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: RecordWorkBackgroundCheckResultRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: WorkWriteResult;
      }
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Orgs.Operations.PendingOperation;
      }
    | WorkWriteErrors
    | Vetchium.Problem.OrgApplicationStateConflictErrorResponse;
}
