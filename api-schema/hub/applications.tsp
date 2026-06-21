import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "./connections.tsp";

using TypeSpec.Http;
namespace Vetchium;

union ApplicationState {
  Applied:     "applied",
  Shortlisted: "shortlisted",
  Rejected:    "rejected",
  Withdrawn:   "withdrawn",
  Expired:     "expired",
}

union ApplicationColorLabel {
  Green:  "green",
  Yellow: "yellow",
  Red:    "red",
}

@multipartBody
model ApplyForOpeningRequest {
  org_domain:                    HttpPart<string>;
  opening_number:                HttpPart<int32>;
  cover_letter:                  HttpPart<string>;
  resume:                        HttpPart<File>;
  endorser_handles?:             HttpPart<string>[];
  endorsement_request_note?:     HttpPart<string>;
}

model ApplyForOpeningResponse {
  application_id: string;
}

model CannotApplyError {
  code: "live_application_exists" | "already_applied" | "cool_off_active" | "not_a_connection" | "invalid_resume";
  earliest_next_apply_at?: utcDateTime;
  offending_handles?: Handle[];
}

model WithdrawApplicationRequest {
  application_id: string;
}

model HubApplicationSummary {
  application_id:    string;
  org_domain:        string;
  org_name:          string;
  opening_number:    int32;
  opening_title:     string;
  state:             ApplicationState;
  label?:            ApplicationColorLabel;
  endorsement_count: int32;
  applied_at:        utcDateTime;
  state_changed_at:  utcDateTime;
}

model HubApplication {
  application_id:            string;
  org_domain:                string;
  org_name:                  string;
  opening_number:            int32;
  opening_title:             string;
  state:                     ApplicationState;
  label?:                    ApplicationColorLabel;
  ai_score?:                 decimal;
  applied_at:                utcDateTime;
  state_changed_at:          utcDateTime;
  cover_letter:              string;
  resume_download_url:       string;
  endorsements:              MyEndorsementOnApplication[];
  endorsement_requests:      MyEndorsementRequestSent[];
  candidacy_id?:             string;
}

model MyEndorsementOnApplication {
  endorsement_id:        string;
  endorser_handle:       Handle;
  endorser_display_name: string;
  shared_domain:         string;
  overlap_start_year:    int32;
  overlap_end_year:      int32;
  is_referral:           boolean;
  is_unsolicited:        boolean;
  text:                  string;
  hidden_by_candidate:   boolean;
  written_at:            utcDateTime;
  edited_at?:            utcDateTime;
}

model MyEndorsementRequestSent {
  request_id:            string;
  endorser_handle:       Handle;
  endorser_display_name: string;
  shared_domain:         string;
  overlap_start_year:    int32;
  overlap_end_year:      int32;
  state:                 "pending" | "written" | "declined" | "expired";
  requested_at:          utcDateTime;
}

model ListMyApplicationsRequest {
  filter_state?:    ApplicationState[];
  pagination_key?:  string;
  limit?:           int32;
}

model ListMyApplicationsResponse {
  applications:         HubApplicationSummary[];
  next_pagination_key?: string;
}

model GetMyApplicationRequest {
  application_id: string;
}

@route("/hub/apply-for-opening")
@post
op applyForOpening(...ApplyForOpeningRequest):
  CreatedResponse<ApplyForOpeningResponse>
  | { @statusCode statusCode: 400; @body body: CannotApplyError | ValidationError[]; }
  | { @statusCode statusCode: 409; @body body: CannotApplyError; }
  | { @statusCode statusCode: 422; @body body: CannotApplyError; }
  | NotFoundResponse;

@route("/hub/withdraw-application")
@post
op withdrawApplication(...WithdrawApplicationRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/list-my-applications")
@post
op listMyApplications(...ListMyApplicationsRequest):
  OkResponse<ListMyApplicationsResponse> | BadRequestResponse;

@route("/hub/get-my-application")
@post
op getMyApplication(...GetMyApplicationRequest):
  OkResponse<HubApplication> | NotFoundResponse;
