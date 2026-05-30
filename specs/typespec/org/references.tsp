import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "../hub/references.tsp";

using TypeSpec.Http;
namespace Vetchium;

model RequestReferencesRequest {
  candidacy_id:      string;
  max_references:    int32;
  response_deadline: plainDate;
  questions:         ReferenceQuestion[];
}

model RequestReferencesResponse {
  request_id: string;
}

model RequestIdRequest {
  request_id: string;
}

model OrgReferenceNomination {
  nomination_id:         string;
  nominee_handle:        Handle;
  nominee_display_name:  string;
  shared_domain:         string;
  overlap_start_year:    int32;
  overlap_end_year:      int32;
  state:                 ReferenceNominationState;
  nominated_at:          utcDateTime;
  submitted_at?:         utcDateTime;
}

model ListReferenceNominationsResponse {
  nominations: OrgReferenceNomination[];
}

model OrgReferenceResponse {
  nomination_id:   string;
  nominee_handle:  Handle;
  nominee_display_name: string;
  shared_domain:   string;
  overlap_start_year: int32;
  overlap_end_year:   int32;
  answers: { question_id: string; question_text: string; response_text: string; }[];
  submitted_at: utcDateTime;
}

model ListReferenceResponsesResponse {
  responses:                OrgReferenceResponse[];
  declined_nominations:     OrgReferenceNomination[];
}

@route("/org/request-references")
@post
op orgRequestReferences(...RequestReferencesRequest):
  CreatedResponse<RequestReferencesResponse> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;

@route("/org/list-reference-nominations")
@post
op orgListReferenceNominations(...RequestIdRequest):
  OkResponse<ListReferenceNominationsResponse> | NotFoundResponse;

@route("/org/list-reference-responses")
@post
op orgListReferenceResponses(...RequestIdRequest):
  OkResponse<ListReferenceResponsesResponse> | NotFoundResponse;
