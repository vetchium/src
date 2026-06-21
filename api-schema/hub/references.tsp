import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

union ReferenceNominationState {
  Nominated: "nominated",
  Accepted:  "accepted",
  Declined:  "declined",
  Submitted: "submitted",
  Expired:   "expired",
}

union ReferenceInboxRequestKind {
  ToNominate: "to_nominate",
  ToRespond:  "to_respond",
}

model ReferenceQuestion {
  question_id: string;
  text:        string;
  min_chars:   int32;
  max_chars:   int32;
  required:    boolean;
}

model HubReferenceRequestSummary {
  kind:                  ReferenceInboxRequestKind;
  request_id:            string;
  nomination_id?:        string;
  org_domain:            string;
  org_name:              string;
  opening_title:         string;
  candidate_handle?:     Handle;
  max_references?:       int32;
  questions:             ReferenceQuestion[];
  response_deadline:     plainDate;
  state?:                ReferenceNominationState;
  created_at:            utcDateTime;
}

model ListReferenceRequestsIncomingRequest {
  filter_kind?:    ReferenceInboxRequestKind[];
  filter_state?:   ReferenceNominationState[];
  pagination_key?: string;
  limit?: int32;
}

model ListReferenceRequestsIncomingResponse {
  requests:             HubReferenceRequestSummary[];
  next_pagination_key?: string;
}

model NominateReferencesRequest {
  request_id:       string;
  nominee_handles:  Handle[];
}

model AcceptReferenceNominationRequest {
  nomination_id: string;
}

model DeclineReferenceNominationRequest {
  nomination_id: string;
}

model SubmitReferenceResponseRequest {
  nomination_id: string;
  answers: { question_id: string; response_text: string; }[];
}

@route("/hub/list-reference-requests-incoming")
@post
op listReferenceRequestsIncoming(...ListReferenceRequestsIncomingRequest):
  OkResponse<ListReferenceRequestsIncomingResponse>;

@route("/hub/nominate-references")
@post
op nominateReferences(...NominateReferencesRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/accept-reference-nomination")
@post
op acceptReferenceNomination(...AcceptReferenceNominationRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/decline-reference-nomination")
@post
op declineReferenceNomination(...DeclineReferenceNominationRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/submit-reference-response")
@post
op submitReferenceResponse(...SubmitReferenceResponseRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
