import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

union CandidacyState {
  Interviewing:             "interviewing",
  Offered:                  "offered",
  OfferAccepted:            "offer_accepted",
  OfferDeclined:            "offer_declined",
  CandidateUnsuitable:      "candidate_unsuitable",
  CandidateNotResponding:   "candidate_not_responding",
  EmployerDefunct:          "employer_defunct",
}

union InterviewType {
  InPerson: "in_person",
  Video:    "video",
  TakeHome: "take_home",
  Other:    "other",
}

union InterviewState {
  Scheduled: "scheduled",
  Completed: "completed",
  Cancelled: "cancelled",
}

union InterviewRSVP {
  Yes: "yes",
  No:  "no",
}

model HubCandidacySummary {
  candidacy_id:       string;
  application_id:     string;
  org_domain:         string;
  org_name:           string;
  opening_title:      string;
  state:              CandidacyState;
  created_at:         utcDateTime;
  state_changed_at:   utcDateTime;
  latest_activity_at: utcDateTime;
}

model HubCandidacy {
  candidacy_id:     string;
  application_id:   string;
  org_domain:       string;
  org_name:         string;
  opening_number:   int32;
  opening_title:    string;
  state:            CandidacyState;
  created_at:       utcDateTime;
  state_changed_at: utcDateTime;
  interviews:       HubInterview[];
  comments:         CandidacyComment[];
  offer?:           HubOfferView;
}

model HubInterview {
  interview_id:    string;
  interview_type:  InterviewType;
  starts_at:       utcDateTime;
  ends_at:         utcDateTime;
  description?:    string;
  state:           InterviewState;
  candidate_rsvp?: InterviewRSVP;
  interviewer_rsvp_summary: {
    total: int32;
    yes: int32;
    no: int32;
    pending: int32;
  };
}

model CandidacyComment {
  comment_id:     string;
  author_kind:    "org_user" | "hub_user" | "system";
  author_handle?: Handle;
  body:           string;
  created_at:     utcDateTime;
}

model HubOfferView {
  extended_at:       utcDateTime;
  salary_currency?:  string;
  salary_amount?:    decimal;
  start_date?:       plainDate;
  notes?:            string;
}

model ListMyCandidaciesRequest {
  filter_state?:    CandidacyState[];
  pagination_key?:  string;
  limit?:           int32;
}

model ListMyCandidaciesResponse {
  candidacies:          HubCandidacySummary[];
  next_pagination_key?: string;
}

model GetMyCandidacyRequest {
  candidacy_id: string;
}

model AddCandidacyCommentRequest {
  candidacy_id: string;
  body:         string;
}

model RSVPInterviewRequest {
  interview_id: string;
  rsvp:         InterviewRSVP;
}

@route("/hub/list-my-candidacies")
@post
op listMyCandidacies(...ListMyCandidaciesRequest):
  OkResponse<ListMyCandidaciesResponse>;

@route("/hub/get-my-candidacy")
@post
op getMyCandidacy(...GetMyCandidacyRequest):
  OkResponse<HubCandidacy> | NotFoundResponse;

@route("/hub/add-candidacy-comment")
@post
op addCandidacyComment(...AddCandidacyCommentRequest):
  CreatedResponse<{ comment_id: string }>
  | BadRequestResponse
  | NotFoundResponse
  | UnprocessableEntityResponse;

@route("/hub/rsvp-interview")
@post
op rsvpInterview(...RSVPInterviewRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;
