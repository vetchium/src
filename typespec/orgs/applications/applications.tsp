import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
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
    "withdrawn"
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
}
