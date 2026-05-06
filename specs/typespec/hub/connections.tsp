import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

union ConnectionState {
  NotConnected:           "not_connected",
  Ineligible:             "ineligible",
  RequestSent:            "request_sent",
  RequestReceived:        "request_received",
  Connected:              "connected",
  IRejectedTheirRequest:  "i_rejected_their_request",
  TheyRejectedMyRequest:  "they_rejected_my_request",
  IDisconnected:          "i_disconnected",
  TheyDisconnected:       "they_disconnected",
  IBlockedThem:           "i_blocked_them",
  BlockedByThem:          "blocked_by_them",
}

model HandleRequest          { handle: Handle; }
model HandleAndNoteRequest   { handle: Handle; rejection_note?: string; }
model GetStatusRequest       { handle: Handle; }
model GetStatusResponse      { connection_state: ConnectionState; }

model Connection {
  handle:              Handle;
  display_name:        string;
  short_bio?:          string;
  has_profile_picture: boolean;
  profile_picture_url?: string;
  connected_at:        utcDateTime;
}

model PendingRequest {
  handle:              Handle;
  display_name:        string;
  short_bio?:          string;
  has_profile_picture: boolean;
  profile_picture_url?: string;
  created_at:          utcDateTime;
}

model BlockedUser {
  handle:       Handle;
  display_name: string;
  blocked_at:   utcDateTime;
}

model ListConnectionsRequest {
  filter_query?:    string;
  pagination_key?:  string;
  limit?:           int32;
}
model ListConnectionsResponse {
  connections:          Connection[];
  next_pagination_key?: string;
}

model ListPendingRequestsRequest {
  pagination_key?: string;
  limit?:          int32;
}
model ListIncomingRequestsResponse { incoming: PendingRequest[]; next_pagination_key?: string; }
model ListOutgoingRequestsResponse { outgoing: PendingRequest[]; next_pagination_key?: string; }

model ListBlockedRequest  { pagination_key?: string; limit?: int32; }
model ListBlockedResponse { blocked: BlockedUser[]; next_pagination_key?: string; }

model SearchConnectionsRequest  { query: string; }
model SearchConnectionsResponse { results: Connection[]; }

model ConnectionCounts {
  pending_incoming: int32;
  pending_outgoing: int32;
  connected:        int32;
  blocked:          int32;
}

@route("/hub/connections/send-request")           @post sendRequest          (...HandleRequest):                CreatedResponse<{}> | BadRequestResponse | NotFoundResponse | { @statusCode statusCode: 452 } | { @statusCode statusCode: 453 } | { @statusCode statusCode: 454 } | { @statusCode statusCode: 455 } | { @statusCode statusCode: 456 } | { @statusCode statusCode: 457 } | { @statusCode statusCode: 460 };
@route("/hub/connections/accept-request")         @post acceptRequest        (...HandleRequest):                OkResponse<{}>      | NotFoundResponse;
@route("/hub/connections/reject-request")         @post rejectRequest        (...HandleRequest):                OkResponse<{}>      | NotFoundResponse;
@route("/hub/connections/withdraw-request")       @post withdrawRequest      (...HandleRequest):                NoContentResponse   | NotFoundResponse;
@route("/hub/connections/disconnect")             @post disconnect           (...HandleRequest):                OkResponse<{}>      | NotFoundResponse;
@route("/hub/connections/list")                   @post listConnections      (...ListConnectionsRequest):       OkResponse<ListConnectionsResponse>      | BadRequestResponse;
@route("/hub/connections/list-incoming-requests") @post listIncoming         (...ListPendingRequestsRequest):   OkResponse<ListIncomingRequestsResponse> | BadRequestResponse;
@route("/hub/connections/list-outgoing-requests") @post listOutgoing         (...ListPendingRequestsRequest):   OkResponse<ListOutgoingRequestsResponse> | BadRequestResponse;
@route("/hub/connections/get-status")             @post getStatus            (...GetStatusRequest):             OkResponse<GetStatusResponse>            | BadRequestResponse | NotFoundResponse;
@route("/hub/connections/search")                 @post search               (...SearchConnectionsRequest):     OkResponse<SearchConnectionsResponse>    | BadRequestResponse;
@route("/hub/connections/block")                  @post blockUser            (...HandleRequest):                CreatedResponse<{}> | NotFoundResponse | { @statusCode statusCode: 452 } | { @statusCode statusCode: 458 };
@route("/hub/connections/unblock")                @post unblockUser          (...HandleRequest):                NoContentResponse   | { @statusCode statusCode: 459 };
@route("/hub/connections/list-blocked")           @post listBlocked          (...ListBlockedRequest):           OkResponse<ListBlockedResponse>          | BadRequestResponse;
@route("/hub/connections/counts")                 @get  counts               ():                                OkResponse<ConnectionCounts>;
