import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "./connections.tsp";

using TypeSpec.Http;
namespace Vetchium;

union EndorsementRequestState {
  Pending:  "pending",
  Written:  "written",
  Declined: "declined",
  Expired:  "expired",
}

model RequestEndorsementsRequest {
  application_id:   string;
  endorser_handles: Handle[];     // 1..10
  note?:            string;       // 0..500
}

model EndorsementRequestIncoming {
  request_id:                 string;
  application_id:             string;
  candidate_handle:           Handle;
  candidate_display_name:     string;
  org_domain:                 string;
  org_name:                   string;
  opening_title:              string;
  shared_domain:              string;
  overlap_start_year:         int32;
  overlap_end_year:           int32;
  note?:                      string;
  state:                      EndorsementRequestState;
  requested_at:               utcDateTime;
  candidate_connection_state: ConnectionState;
}

model EndorsementRequestOutgoing {
  request_id:            string;
  application_id:        string;
  endorser_handle:       Handle;
  endorser_display_name: string;
  state:                 EndorsementRequestState;
  requested_at:          utcDateTime;
}

model ListEndorsementRequestsIncomingRequest {
  filter_state?:   EndorsementRequestState[];
  pagination_key?: string;
  limit?:          int32;
}
model ListEndorsementRequestsIncomingResponse {
  requests:             EndorsementRequestIncoming[];
  next_pagination_key?: string;
}

model ListEndorsementRequestsOutgoingRequest {
  application_id:  string;
  pagination_key?: string;
  limit?:          int32;
}
model ListEndorsementRequestsOutgoingResponse {
  requests:             EndorsementRequestOutgoing[];
  next_pagination_key?: string;
}

model WriteEndorsementRequest {
  request_id?:     string;
  application_id?: string;
  text:            string;     // 100..2000
}

model WriteEndorsementResponse {
  endorsement_id: string;
}

model UpdateEndorsementRequest {
  endorsement_id: string;
  text:           string;     // 100..2000
}

model DeclineEndorsementRequestRequest { request_id: string; }

model HideEndorsementOnApplicationRequest { endorsement_id: string; }
model ShowEndorsementOnApplicationRequest { endorsement_id: string; }

@route("/hub/request-endorsements")
@post op requestEndorsements(...RequestEndorsementsRequest):
  OkResponse<{}>
  | BadRequestResponse
  | NotFoundResponse
  | ConflictResponse
  | UnprocessableEntityResponse;

@route("/hub/list-endorsement-requests-incoming")
@post op listEndorsementRequestsIncoming(...ListEndorsementRequestsIncomingRequest):
  OkResponse<ListEndorsementRequestsIncomingResponse> | BadRequestResponse;

@route("/hub/list-endorsement-requests-outgoing")
@post op listEndorsementRequestsOutgoing(...ListEndorsementRequestsOutgoingRequest):
  OkResponse<ListEndorsementRequestsOutgoingResponse> | NotFoundResponse;

@route("/hub/write-endorsement")
@post op writeEndorsement(...WriteEndorsementRequest):
  CreatedResponse<WriteEndorsementResponse>
  | BadRequestResponse
  | { @statusCode statusCode: 403 }
  | NotFoundResponse
  | ConflictResponse
  | UnprocessableEntityResponse;

@route("/hub/update-endorsement")
@post op updateEndorsement(...UpdateEndorsementRequest):
  OkResponse<{}> | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/decline-endorsement-request")
@post op declineEndorsementRequest(...DeclineEndorsementRequestRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;

@route("/hub/hide-endorsement-on-application")
@post op hideEndorsement(...HideEndorsementOnApplicationRequest):
  OkResponse<{}> | NotFoundResponse;

@route("/hub/show-endorsement-on-application")
@post op showEndorsement(...ShowEndorsementOnApplicationRequest):
  OkResponse<{}> | NotFoundResponse | UnprocessableEntityResponse;
