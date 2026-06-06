import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "../hub/candidacies.tsp";

using TypeSpec.Http;
namespace Vetchium;

model ListCandidaciesRequest {
  filter_opening_id?: string;
  filter_state?:      CandidacyState[];
  pagination_key?:    string;
  limit?:             int32;
}

model OrgCandidacySummary {
  candidacy_id:             string;
  application_id:           string;
  opening_id:               string;
  candidate_handle:         Handle;
  candidate_display_name:   string;
  state:                    CandidacyState;
  scheduled_interview_count: int32;
  created_at:               utcDateTime;
  state_changed_at:         utcDateTime;
}

model ListCandidaciesResponse {
  candidacies:          OrgCandidacySummary[];
  next_pagination_key?: string;
}

model CandidacyIdRequest {
  candidacy_id: string;
}

model OrgInterviewSummary {
  interview_id:             string;
  interview_type:           InterviewType;
  starts_at:                utcDateTime;
  ends_at:                  utcDateTime;
  state:                    InterviewState;
  interviewer_count:        int32;
  candidate_rsvp?:          InterviewRSVP;
  feedback_submitted_count: int32;
}

model OrgOfferView {
  extended_by_org_user_id: string;
  extended_at:             utcDateTime;
  start_date?:             plainDate;
  notes?:                  string;
  offer_letter_download_url: string;
}

model OrgCandidacy {
  candidacy_id:           string;
  application_id:         string;
  opening_id:             string;
  opening_title:          string;
  candidate_handle:       Handle;
  candidate_display_name: string;
  state:                  CandidacyState;
  created_at:             utcDateTime;
  state_changed_at:       utcDateTime;
  interviews:             OrgInterviewSummary[];
  comments:               CandidacyComment[];
  offer?:                 OrgOfferView;
}

model OrgAddCandidacyCommentRequest {
  candidacy_id: string;
  body:         string;
}

@route("/org/list-candidacies")
@post
op listCandidacies(...ListCandidaciesRequest):
  OkResponse<ListCandidaciesResponse> | BadRequestResponse;

@route("/org/get-candidacy")
@post
op getCandidacy(...CandidacyIdRequest):
  OkResponse<OrgCandidacy> | NotFoundResponse;

@route("/org/add-candidacy-comment")
@post
op addCandidacyCommentOrg(...OrgAddCandidacyCommentRequest):
  CreatedResponse<{ comment_id: string }>
  | BadRequestResponse
  | NotFoundResponse
  | UnprocessableEntityResponse;
