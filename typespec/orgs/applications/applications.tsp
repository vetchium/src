import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../common/localization.tsp";
import "../../common/pagination.tsp";
import "../../hub/profile/public.tsp";
import "../../hub/profile/snapshot.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/applications.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/suspension.tsp";
import "../hiring/pipelines.tsp";
import "../hiring/vocabulary.tsp";
import "../marketplace/assignments.tsp";
import "../marketplace/attribution.tsp";
import "../openings/types.tsp";
import "./answers.tsp";

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

/** Allocated per application from 1, in the order interviews were scheduled. */
@minValue(1)
scalar InterviewNumber extends int32;

@minValue(15)
@maxValue(480)
scalar InterviewDurationMinutes extends int32;

/** An in-person interview's place, at most 500 code points. */
@minLength(1)
@maxLength(500)
scalar InterviewLocation extends string;

/** The applicant's reason for asking to reschedule, at most 500 code points. */
@minLength(1)
@maxLength(500)
scalar InterviewRescheduleNote extends string;

/** An interviewer's notes, at most 10,000 code points. */
@minLength(1)
@maxLength(10000)
scalar InterviewFeedbackNotes extends string;

/**
 * How an interview is held: `video` with an HTTPS link, or `in_person` with a
 * location. A portal older than its API shows a mode it does not recognize as
 * the raw value.
 */
@TypeSpec.OpenAPI.extension("x-vetchium-known-values", #["video", "in_person"])
scalar InterviewMode extends string;

/**
 * Where an interview stands. A portal older than its API shows a state it does
 * not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["scheduled", "completed", "no_show", "cancelled"]
)
scalar InterviewState extends string;

/**
 * The applicant's answer to an interview. A portal older than its API shows a
 * response it does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["pending", "accepted", "reschedule_requested"]
)
scalar InterviewResponse extends string;

/**
 * An interviewer's verdict. A portal older than its API shows a value it does
 * not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["strong_yes", "yes", "no", "strong_no"]
)
scalar InterviewRecommendation extends string;

/** What an interviewer or recruiter records after the start time. */
enum InterviewOutcome {
  Completed: "completed",
  NoShow: "no_show",
}

/**
 * How an assessment went. A portal older than its API shows an outcome it does
 * not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["pass", "fail", "inconclusive"]
)
scalar AssessmentOutcome extends string;

@minValue(0)
@maxValue(100)
scalar AssessmentScore extends int32;

/**
 * The notes of an assessment or a background check, trimmed, at most 2,000
 * code points. A blank note is no note.
 */
@minLength(1)
@maxLength(2000)
scalar ResultNotes extends string;

/**
 * What one background check found. A portal older than its API shows an
 * outcome it does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["clear", "discrepancy", "unable_to_verify"]
)
scalar CheckOutcome extends string;

/** Allocated per application from 1, in the order consent was requested. */
@minValue(1)
scalar BackgroundCheckNumber extends int32;

/**
 * Where a background-check consent request stands: `requested` awaits the
 * applicant, `given` and `declined` are their answer, and `ended` is a request
 * the Org's candidacy left the stage or the pipeline before it was answered. A
 * portal older than its API shows a state it does not recognize as the raw
 * value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["requested", "given", "declined", "ended"]
)
scalar ConsentState extends string;

/**
 * Who performs a stage's work: the Org itself, or a provider the Org routed
 * the candidacy to. A portal older than its API shows a performer it does not
 * recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension("x-vetchium-known-values", #["org", "provider"])
scalar WorkPerformer extends string;

/**
 * An action awaiting the applicant, for the `pending_applicant_action`
 * filter. A portal older than its API shows a value it does not recognize as
 * the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["interview_response", "background_check_consent", "offer_response"]
)
scalar PendingApplicantAction extends string;

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
    "separated_corrected",
    "interview_scheduled",
    "interview_changed",
    "interview_cancelled",
    "interview_completed",
    "interview_no_show",
    "interview_accepted",
    "interview_reschedule_requested",
    "interview_feedback_submitted",
    "assessment_recorded",
    "background_check_consent_requested",
    "background_check_consent_given",
    "background_check_consent_declined",
    "background_check_result_recorded",
    "routed",
    "removed"
  ]
)
scalar ApplicationHistoryAction extends string;

/**
 * Who caused a history entry. A portal older than its API shows an actor it
 * does not recognize as the raw value.
 */
@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["applicant", "org_user", "provider", "system"]
)
scalar ApplicationActorKind extends string;

model ApplicationSummary {
  application_number: ApplicationNumber;
  state: ApplicationState;
  version: ApplicationVersion;
  display_name: Vetchium.DisplayName;
  resident_country: Vetchium.CountryCode;

  /**
   * True once retention removed the applicant's personal data (HP-RET-001);
   * `display_name` is then a placeholder the portal replaces with its own
   * "Removed applicant" text, and `resident_country` is empty.
   */
  removed: boolean;

  /** The stage a candidacy is at. */
  current_stage?: Vetchium.Orgs.Hiring.PipelineStage;

  /** The provider performing the current stage; absent when in-house. */
  route?: Vetchium.Orgs.Marketplace.ApplicationRoute;

  /** The agency credited with the application; absent when uncredited. */
  credited_agency?: Vetchium.Orgs.Marketplace.CreditedAgency;

  /** The route of the credit: suggested by the agency or declared by the applicant. */
  referral_route?: Vetchium.Orgs.Marketplace.ReferralRoute;

  /**
   * Present when the request named `answer_columns`: this application's
   * answers to those questions, unanswered ones omitted.
   */
  answers?: ApplicationAnswer[];

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

/** One interviewer of an interview. */
model InterviewerStatus {
  email: Vetchium.EmailAddress;

  /** Whether the interviewer has submitted feedback; never its content. */
  feedback_submitted: boolean;
}

model InterviewFeedback {
  interviewer_email: Vetchium.EmailAddress;
  recommendation: InterviewRecommendation;
  notes: InterviewFeedbackNotes;

  /** The stage's form as the interviewer answered it; empty without one. */
  @maxItems(10)
  criteria_answers: AnsweredCriterion[];

  submitted_at: utcDateTime;
}

/**
 * One interview of a candidacy. `feedback` holds the caller's own feedback and,
 * unless the caller is an interviewer who has not yet submitted theirs,
 * everyone's.
 */
model Interview {
  interview_number: InterviewNumber;

  /** The stage the interview was scheduled at. */
  stage: Vetchium.Orgs.Hiring.PipelineStage;

  starts_at: utcDateTime;
  duration_minutes: InterviewDurationMinutes;
  mode: InterviewMode;

  /** `video` only. */
  video_url?: string;

  /** `in_person` only. */
  location?: InterviewLocation;

  state: InterviewState;
  applicant_response: InterviewResponse;

  /** Present while the applicant's response is `reschedule_requested`. */
  reschedule_note?: InterviewRescheduleNote;

  interviewers: InterviewerStatus[];
  feedback: InterviewFeedback[];

  /** The provider that scheduled and holds the interview; absent in-house. */
  provider?: Vetchium.Orgs.Marketplace.EngagementCounterparty;
}

/** The recorded result of an assessment stage. */
model AssessmentResult {
  stage: Vetchium.Orgs.Hiring.PipelineStage;
  outcome: AssessmentOutcome;
  score?: AssessmentScore;
  notes?: ResultNotes;

  /** A normalized HTTPS link to the performer's report. */
  report_url?: Vetchium.Hub.Profile.WebsiteURL;

  /**
   * Present for an Org user who is still in the Org, or the provider's user
   * who recorded it.
   */
  recorded_by_email?: Vetchium.EmailAddress;

  recorded_at: utcDateTime;

  /** The provider that recorded the result; absent in-house. */
  provider?: Vetchium.Orgs.Marketplace.EngagementCounterparty;
}

/** What one background check found. */
model BackgroundCheckResult {
  check_type: Vetchium.Orgs.Hiring.CheckType;
  outcome: CheckOutcome;
  notes?: ResultNotes;

  /** A normalized HTTPS link to the performer's report. */
  report_url?: Vetchium.Hub.Profile.WebsiteURL;

  /** Present for an Org user who is still in the Org. */
  recorded_by_email?: Vetchium.EmailAddress;

  recorded_at: utcDateTime;
}

/**
 * One consent request of a candidacy at a background-check stage, with the
 * results recorded after consent. Nothing is recorded until the applicant
 * gives consent.
 */
model BackgroundCheck {
  check_number: BackgroundCheckNumber;
  stage: Vetchium.Orgs.Hiring.PipelineStage;
  consent_state: ConsentState;

  /** The types the Org asked to run. */
  check_types: Vetchium.Orgs.Hiring.CheckType[];

  performer: WorkPerformer;

  /** The provider that performs the checks, when `performer` is `provider`. */
  provider?: Vetchium.Orgs.Marketplace.EngagementCounterparty;

  /**
   * The provider's consent disclosure as copied when the candidacy was routed,
   * which the applicant consents to.
   */
  consent_disclosure?: string;

  requested_at: utcDateTime;

  /** Present once the applicant gave or declined consent. */
  responded_at?: utcDateTime;

  /** In the order recorded. */
  results: BackgroundCheckResult[];
}

model ApplicationDetail {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: ApplicationNumber;
  state: ApplicationState;
  version: ApplicationVersion;
  snapshot: Vetchium.Hub.Profile.ApplicantSnapshot;

  /**
   * True once retention removed the personal data (HP-RET-001): the snapshot
   * holds only a placeholder `display_name` (every other field empty), and
   * the cover note, interviews, results, and offers are gone.
   */
  removed: boolean;

  cover_note?: ApplicationCoverNote;
  current_stage?: Vetchium.Orgs.Hiring.PipelineStage;

  /** The provider performing the current stage; absent when in-house. */
  route?: Vetchium.Orgs.Marketplace.ApplicationRoute;

  /** The agency credited with the application; absent when uncredited. */
  credited_agency?: Vetchium.Orgs.Marketplace.CreditedAgency;

  /** The route of the credit: suggested by the agency or declared by the applicant. */
  referral_route?: Vetchium.Orgs.Marketplace.ReferralRoute;

  /**
   * The questions as the application was asked them, in order, with each
   * answer and its currency (HP-QST-006); empty when none were asked or
   * retention removed them.
   */
  answers: AnswerRecord[];

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

  /** Every interview, earliest start first, as the caller may see it. */
  interviews: Interview[];

  /**
   * Assessment results in pipeline order. Empty for a caller who reads only
   * the candidacies they interview.
   */
  assessments: AssessmentResult[];

  /**
   * Background-check requests, oldest first. Empty for a caller who reads
   * only the candidacies they interview.
   */
  background_checks: BackgroundCheck[];

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

  /** The interview an interview action concerns. */
  interview_number?: InterviewNumber;

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

  /**
   * Candidates view only: candidacies with this action awaiting the
   * applicant.
   */
  pending_applicant_action?: PendingApplicantAction;

  /** Candidates view only: candidacies routed to this engagement. */
  routed_engagement_id?: Vetchium.Orgs.Marketplace.EngagementID;

  credited_agency_domain?: Vetchium.Orgs.OrgDomain;
  referral_route?: Vetchium.Orgs.Marketplace.ReferralRoute;

  /**
   * Live `number`, `yes_no`, `single_choice`, or `multiple_choice` questions
   * whose answers each row returns (HP-QST-007); never a filter or sort key.
   */
  @maxItems(3)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  answer_columns?: Vetchium.ApplicationQuestionID[];

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

/**
 * Routes a candidacy at its current stage to an engagement assigned to that
 * stage, or back in-house when `engagement_id` is absent.
 */
model RouteApplicationRequest {
  ...ApplicationReference;
  engagement_id?: Vetchium.Orgs.Marketplace.EngagementID;
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

/** The details of an interview, as scheduled and as changed. */
model InterviewDetails {
  /** In the future when scheduled or changed. */
  start_time: utcDateTime;

  duration_minutes: InterviewDurationMinutes;
  mode: InterviewMode;

  /** `video` only: a normalized HTTPS URL of at most 2,048 characters. */
  video_url?: Vetchium.Hub.Profile.WebsiteURL;

  /** `in_person` only. */
  location?: InterviewLocation;

  /** Active users of the Org. */
  @minItems(1)
  @maxItems(10)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  interviewer_emails: Vetchium.EmailAddress[];
}

/** Schedules an interview for an `in_pipeline` candidacy at an interview stage. */
model ScheduleInterviewRequest {
  ...ApplicationReference;
  ...InterviewDetails;
}

/** Replaces the details of an upcoming interview. */
model ChangeInterviewRequest {
  ...ApplicationReference;
  interview_number: InterviewNumber;
  ...InterviewDetails;
}

model InterviewReference {
  ...ApplicationReference;
  interview_number: InterviewNumber;
}

model CancelInterviewRequest {
  ...InterviewReference;
}

model RecordInterviewOutcomeRequest {
  ...InterviewReference;
  outcome: InterviewOutcome;
}

model SubmitInterviewFeedbackRequest {
  ...InterviewReference;
  recommendation: InterviewRecommendation;
  notes: InterviewFeedbackNotes;

  /**
   * Answers to the criteria of the interview's stage form, checked against it
   * when submitting (HP-FRM-003).
   */
  @maxItems(10)
  criteria_answers?: CriterionAnswer[];
}

/** Records the assessment result of a candidacy at an assessment stage. */
model RecordAssessmentResultRequest {
  ...ApplicationReference;
  outcome: AssessmentOutcome;
  score?: AssessmentScore;

  /** Trimmed; a blank note is no note. */
  notes?: ResultNotes;

  /** An HTTPS link, normalized. */
  report_url?: Vetchium.Hub.Profile.WebsiteURL;
}

/**
 * Asks the applicant to consent to the check types at the candidacy's
 * background-check stage.
 */
model RequestBackgroundCheckConsentRequest {
  ...ApplicationReference;

  @minItems(1)
  @maxItems(20)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-items", true)
  check_types: Vetchium.Orgs.Hiring.CheckType[];
}

/** Records one check's result after the applicant gave consent. */
model RecordBackgroundCheckResultRequest {
  ...ApplicationReference;

  /** One of the types the consent request named. */
  check_type: Vetchium.Orgs.Hiring.CheckType;

  outcome: CheckOutcome;

  /** Trimmed; a blank note is no note. */
  notes?: ResultNotes;

  /** An HTTPS link, normalized. */
  report_url?: Vetchium.Hub.Profile.WebsiteURL;
}

/**
 * Which of the caller's interviews a list reads. The two views never share an
 * interview; omission reads every interview, most recently scheduled first.
 */
enum MyInterviewView {
  /** `scheduled` and not yet over, soonest first. */
  Upcoming: "upcoming",

  /**
   * Over, neither cancelled nor a no-show, and without the caller's feedback,
   * oldest first. A `scheduled` one still needs its outcome recorded.
   */
  FeedbackDue: "feedback_due",
}

model ListMyInterviewsRequest {
  view?: MyInterviewView;
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: Vetchium.PageSize = 50;
}

/** An interview the caller is an interviewer of. */
model MyInterview {
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  application_number: ApplicationNumber;
  display_name: Vetchium.DisplayName;
  interview_number: InterviewNumber;
  starts_at: utcDateTime;
  duration_minutes: InterviewDurationMinutes;
  mode: InterviewMode;
  state: InterviewState;
  applicant_response: InterviewResponse;
  feedback_submitted: boolean;
}

model ListMyInterviewsResponse {
  /** In the order the view states. */
  interviews: MyInterview[];

  next_pagination_key?: Vetchium.PaginationKey;
}

/** The size of each view of the caller's interviews. */
model MyInterviewCounts {
  upcoming: int32;
  feedback_due: int32;
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

/**
 * An interview write also refuses an unknown interview number, and an action
 * the interview's state or time does not allow.
 */
alias InterviewWriteErrors =
  | ApplicationWriteErrors
  | Vetchium.Problem.OrgInterviewNotFoundErrorResponse
  | Vetchium.Problem.OrgInterviewStateConflictErrorResponse;

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

  /**
   * Routes a candidacy at a pending stage to a provider assigned to it, or
   * back in-house. Rerouting ends the previous provider's access; work it
   * recorded stays. Routing to a `background_check` provider copies the
   * Listing's current consent disclosure from the provider's tenant.
   */
  @route("/route-application")
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
  routeApplication(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: RouteApplicationRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors
    | Vetchium.Problem.OrgAssignmentNotFoundErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse;

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

  /**
   * Schedules an interview for a candidacy `in_pipeline` at an interview
   * stage, at most ten per stage that are not cancelled.
   */
  @route("/schedule-interview")
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
  scheduleInterview(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ScheduleInterviewRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors
    | Vetchium.Problem.OrgInterviewLimitReachedErrorResponse
    | Vetchium.Problem.OrgInterviewInterviewersInvalidErrorResponse;

  /**
   * Replaces an upcoming interview's details. A change of time, duration, or
   * mode resets the applicant's response.
   */
  @route("/change-interview")
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
  changeInterview(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ChangeInterviewRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | InterviewWriteErrors
    | Vetchium.Problem.OrgInterviewInterviewersInvalidErrorResponse;

  /** Cancels an upcoming interview. */
  @route("/cancel-interview")
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
  cancelInterview(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: CancelInterviewRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | InterviewWriteErrors;

  /**
   * Records `completed` or `no_show` once the start time has passed. Done by
   * an interviewer of the interview or by someone who acts on the Opening's
   * applications.
   */
  @route("/record-interview-outcome")
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
  recordInterviewOutcome(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: RecordInterviewOutcomeRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | InterviewWriteErrors;

  /**
   * Stores the caller's feedback, once, on an interview recorded as
   * `completed`. Only an interviewer of the interview may submit.
   */
  @route("/submit-interview-feedback")
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
  submitInterviewFeedback(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: SubmitInterviewFeedbackRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | InterviewWriteErrors
    | Vetchium.Problem.OrgInterviewFeedbackExistsErrorResponse
    | Vetchium.Problem.OrgInterviewFeedbackAnswersInvalidErrorResponse;

  /**
   * Records the assessment result of a candidacy `in_pipeline` at an
   * assessment stage that is still pending, and completes the stage. A result
   * is recorded once.
   */
  @route("/record-assessment-result")
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
  recordAssessmentResult(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: RecordAssessmentResultRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors;

  /**
   * Asks the applicant for consent at the candidacy's pending
   * background-check stage. One request is active per stage; after a declined
   * or ended one the Org may ask again. The applicant answers in the Hub.
   */
  @route("/request-background-check-consent")
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
  requestBackgroundCheckConsent(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: RequestBackgroundCheckConsentRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors;

  /**
   * Records one check's result. Without the applicant's consent, for a type
   * the request did not name (`validation-failed` on `check_type`), or for a
   * type already recorded, nothing is recorded. The result that completes the
   * requested set completes the stage.
   */
  @route("/record-background-check-result")
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
  recordBackgroundCheckResult(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: RecordBackgroundCheckResultRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ApplicationDetail;
      }
    | ApplicationWriteErrors;

  /** Lists the interviews the caller is an interviewer of. */
  @route("/list-my-interviews")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["view", "starts_at", "interview_id"]
  )
  listMyInterviews(@body request: ListMyInterviewsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListMyInterviewsResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  /** Counts the caller's interviews in each view of the list. */
  @route("/my-interview-counts")
  @get
  @useAuth(BearerAuth)
  myInterviewCounts():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: MyInterviewCounts;
      }
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
