import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "../hub/candidacies.tsp";

using TypeSpec.Http;
namespace Vetchium;

union FeedbackDecision {
  StrongYes: "strong_yes",
  Yes:       "yes",
  Neutral:   "neutral",
  No:        "no",
  StrongNo:  "strong_no",
}

model ScheduleInterviewRequest {
  candidacy_id:            string;
  interview_type:          InterviewType;
  starts_at:               utcDateTime;
  ends_at:                 utcDateTime;
  description?:            string;       // 0..2000
  interviewer_email_addresses: string[]; // 1..5, must be active org users at the org
}
model ScheduleInterviewResponse { interview_id: string; }

model UpdateInterviewRequest {
  interview_id:  string;
  starts_at?:    utcDateTime;
  ends_at?:      utcDateTime;
  description?:  string;
}

model InterviewIdRequest { interview_id: string; }

model AddInterviewerRequest    { interview_id: string; org_user_email_address: string; }
model RemoveInterviewerRequest { interview_id: string; org_user_id: string; }

model SetInterviewerRSVPRequest { interview_id: string; rsvp: InterviewRSVP; }

model SubmitInterviewFeedbackRequest {
  interview_id:       string;
  decision:           FeedbackDecision;
  positives:          string;     // 1..4000
  negatives:          string;     // 1..4000
  overall_assessment: string;     // 1..4000
  candidate_feedback?: string;    // 0..2000
}

model InterviewerEntry {
  org_user_id:           string;
  org_user_email_address: string;
  display_name:          string;
  rsvp?:                 InterviewRSVP;
  feedback_submitted:    boolean;
}

model OrgInterview {
  interview_id:   string;
  candidacy_id:   string;
  interview_type: InterviewType;
  starts_at:      utcDateTime;
  ends_at:        utcDateTime;
  description?:   string;
  state:          InterviewState;
  candidate_rsvp?: InterviewRSVP;
  interviewers:   InterviewerEntry[];
  // Feedback section: visible only to org users (never candidate).
  // For each interviewer who has submitted, full feedback is included.
  feedback: {
    org_user_id:        string;
    decision:           FeedbackDecision;
    positives:          string;
    negatives:          string;
    overall_assessment: string;
    candidate_feedback?: string;
    submitted_at:       utcDateTime;
  }[];
}

model ListInterviewsRequest {
  filter_candidacy_id?: string;
  filter_state?:        InterviewState[];
  filter_starts_at_from?: utcDateTime;
  filter_starts_at_to?:   utcDateTime;
  pagination_key?:      string;
  limit?:               int32;
}
model ListInterviewsResponse { interviews: OrgInterviewSummary[]; next_pagination_key?: string; }

// A single interview the calling org user is personally assigned to, enriched
// with the candidacy/opening/candidate context needed for a flat list view.
model OrgMyInterview {
  interview_id:   string;
  candidacy_id:   string;
  opening_title:  string;
  candidate_name: string;
  interview_type: InterviewType;
  starts_at:      utcDateTime;
  ends_at:        utcDateTime;
  state:          InterviewState;
  my_rsvp?:       InterviewRSVP;
  feedback_submitted: boolean;
}

model ListMyInterviewsRequest {
  filter_state?:   InterviewState[];
  pagination_key?: string;
  limit?:          int32;
}
model ListMyInterviewsResponse { interviews: OrgMyInterview[]; next_pagination_key?: string; }

@route("/org/schedule-interview") @post scheduleInterview(...ScheduleInterviewRequest):
  CreatedResponse<ScheduleInterviewResponse> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/update-interview")   @post updateInterview(...UpdateInterviewRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/cancel-interview")   @post cancelInterview(...InterviewIdRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/add-interviewer")    @post addInterviewer(...AddInterviewerRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/remove-interviewer") @post removeInterviewer(...RemoveInterviewerRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/rsvp-interview")     @post orgRsvpInterview(...SetInterviewerRSVPRequest):
  OkResponse<{}> | { @statusCode statusCode: 403 } | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/submit-interview-feedback") @post submitInterviewFeedback(...SubmitInterviewFeedbackRequest):
  OkResponse<{}> | BadRequestResponse | { @statusCode statusCode: 403 } | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/list-interviews")    @post orgListInterviews(...ListInterviewsRequest):
  OkResponse<ListInterviewsResponse> | BadRequestResponse;
@route("/org/get-interview")      @post orgGetInterview(...InterviewIdRequest):
  OkResponse<OrgInterview> | NotFoundResponse;
@route("/org/list-my-interviews") @post orgListMyInterviews(...ListMyInterviewsRequest):
  OkResponse<ListMyInterviewsResponse> | BadRequestResponse;
