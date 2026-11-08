import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../common/pagination.tsp";
import "../../orgs/openings/types.tsp";
import "../../orgs/marketplace/contacts/contacts.tsp";
import "../../orgs/types.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/conversations.tsp";
import "../../problem/hub/openings.tsp";
import "../operations/operations.tsp";
import "../types.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Messages;

alias MessageErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias PendingMessageResponse = {
  @statusCode status_code: 202;
  @header("Cache-Control") cache_control: "no-store";
  @body body: Vetchium.Hub.Operations.PendingOperation;
};

model HubOpeningSuggestion {
  consumer_domain: Vetchium.Orgs.OrgDomain;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  sent_at: utcDateTime;
}

/**
 * A chat request between the Hub user and an agency, as the Hub user's
 * pointer keeps it. It never carries the note; the conversation read does.
 */
model HubChatRequest {
  request_number: Vetchium.Orgs.Marketplace.Contacts.ChatRequestNumber;
  direction: Vetchium.Orgs.Marketplace.Contacts.ChatRequestDirection;
  state: Vetchium.Orgs.Marketplace.Contacts.ChatRequestState;
  opening: Vetchium.Orgs.Marketplace.Contacts.OpeningSuggestion;
  agency_display_name: string;

  /** Names the agency: its primary domain. */
  agency_domain: Vetchium.Orgs.OrgDomain;

  sent_at: utcDateTime;
  answered_at?: utcDateTime;
  decline_scope?: Vetchium.Orgs.Marketplace.Contacts.ChatRequestDeclineScope;

  /** When a `sender` decline lifts. */
  blocked_until?: utcDateTime;

  /** The conversation window in whole days, for "Not for N days". */
  window_days: int32;
}

model HubConversationSummary {
  agency_display_name: string;

  /** Names the conversation: the agency's primary domain. */
  agency_domain: Vetchium.Orgs.OrgDomain;

  has_conversation: boolean;
  unread: boolean;
  unread_count: int32;
  read_only_reason?: Vetchium.Orgs.Marketplace.Contacts.ConversationReadOnlyReason;
  suggestions: HubOpeningSuggestion[];

  /** Until when the agency may write; absent when it may not (MKT-REQ-004). */
  agency_may_write_until?: utcDateTime;

  /** Until when the Hub user may write; absent when they may not. */
  hub_may_write_until?: utcDateTime;

  /** The latest chat request between the two, in any state. */
  latest_request?: HubChatRequest;

  last_activity_at: utcDateTime;
}

model HubConversationDetail {
  conversation: HubConversationSummary;

  /** One page of messages, newest first. */
  messages: Vetchium.Orgs.Marketplace.Contacts.ConversationMessage[];

  /** The note of a pending chat request, read live from the agency's tenant. */
  pending_request_note?: Vetchium.Orgs.Marketplace.Contacts.ChatRequestNote;

  /** Resumes with older messages. */
  next_pagination_key?: Vetchium.PaginationKey;
}

/** The Hub user's chat with one agency assigned to an Opening. */
enum OpeningAgencyChatState {
  /** No conversation or request between the two. */
  none: "none",

  /** The Hub user may write in the conversation. */
  open: "open",

  /** A conversation exists, but the Hub user may not write in it. */
  closed: "closed",

  request_sent: "request_sent",
  request_received: "request_received",

  /** The agency's decline blocks a request about this Opening now. */
  declined: "declined",
}

/** An agency with an active `sourcing` engagement assigned to the Opening. */
model OpeningAgency {
  agency_display_name: string;
  agency_domain: Vetchium.Orgs.OrgDomain;
  chat_state: OpeningAgencyChatState;

  /** The latest chat request between the two, in any state. */
  latest_request?: HubChatRequest;
}

model ListOpeningAgenciesRequest {
  domain: Vetchium.Orgs.OrgDomain;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
}

model ListOpeningAgenciesResponse {
  /** At most 20, the cap on `sourcing` assignments per Opening. */
  items: OpeningAgency[];
}

/** Asks an agency assigned to a `published` Opening to open a conversation. */
model HubSendChatRequestRequest {
  domain: Vetchium.Orgs.OrgDomain;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  agency_domain: Vetchium.Orgs.OrgDomain;
  note?: Vetchium.Orgs.Marketplace.Contacts.ChatRequestNote;
}

model ListHubChatRequestsRequest {
  direction: Vetchium.Orgs.Marketplace.Contacts.ChatRequestDirection;
  pagination_key?: Vetchium.PaginationKey;

  @minValue(1)
  @maxValue(100)
  limit?: int32;
}

model ListHubChatRequestsResponse {
  /** Pending requests oldest first, then answered ones newest first. */
  items: HubChatRequest[];

  next_pagination_key?: Vetchium.PaginationKey;
}

model HubAcceptChatRequestRequest {
  agency_domain: Vetchium.Orgs.OrgDomain;
  request_number: Vetchium.Orgs.Marketplace.Contacts.ChatRequestNumber;
}

model HubDeclineChatRequestRequest {
  agency_domain: Vetchium.Orgs.OrgDomain;
  request_number: Vetchium.Orgs.Marketplace.Contacts.ChatRequestNumber;
  scope: Vetchium.Orgs.Marketplace.Contacts.ChatRequestDeclineScope;
}

/** Which of the Hub user's conversations a list holds (MKT-HUB-001). */
enum ConversationFilter {
  all: "all",

  /** A pending chat request from the agency to the Hub user. */
  requests_received: "requests_received",

  /** Agency messages the Hub user has not read. */
  unread: "unread",
}

model ListConversationsRequest {
  pagination_key?: Vetchium.PaginationKey;

  @minValue(1)
  @maxValue(100)
  limit?: int32;

  filter?: ConversationFilter = ConversationFilter.all;
}

model ListConversationsResponse {
  items: HubConversationSummary[];
  next_pagination_key?: Vetchium.PaginationKey;
}

/**
 * The conversations waiting on the Hub user, each counted under the filter
 * of the same name.
 */
model AwaitingConversationCounts {
  requests_received: int32;
  unread: int32;
}

model GetConversationRequest {
  agency_domain: Vetchium.Orgs.OrgDomain;
  pagination_key?: Vetchium.PaginationKey;

  @minValue(1)
  @maxValue(100)
  limit?: int32;
}

model ReplyToConversationRequest {
  agency_domain: Vetchium.Orgs.OrgDomain;
  text: Vetchium.Orgs.Marketplace.Contacts.MessageText;
}

/** Deletes one of the Hub user's own text messages (MKT-CNV-007). */
model DeleteMessageRequest {
  agency_domain: Vetchium.Orgs.OrgDomain;
  message_number: Vetchium.Orgs.Marketplace.Contacts.MessageNumber;
}

model MarkConversationReadRequest {
  agency_domain: Vetchium.Orgs.OrgDomain;
}

@route("/api/hub")
@tag("Hub messages")
interface MessageOperations {
  /** Lists the Hub user's agency conversations ordered by last activity. */
  @route("/list-conversations")
  @post
  @useAuth(BearerAuth)
  listConversations(@body request: ListConversationsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListConversationsResponse;
      }
    | MessageErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  /** Reads a conversation's messages live from the agency's tenant. */
  @route("/get-conversation")
  @post
  @useAuth(BearerAuth)
  getConversation(@body request: GetConversationRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: HubConversationDetail;
      }
    | MessageErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.HubConversationNotFoundErrorResponse
    | Vetchium.Problem.HubOrgUnavailableErrorResponse;

  /** Replies to an agency conversation. */
  @route("/reply-to-conversation")
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
  replyToConversation(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ReplyToConversationRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Orgs.Marketplace.Contacts.ConversationMessage;
      }
    | PendingMessageResponse
    | MessageErrors
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.HubConversationNotFoundErrorResponse
    | Vetchium.Problem.HubConversationPartyDeletedErrorResponse
    | Vetchium.Problem.HubConversationClosedErrorResponse;

  /**
   * Deletes the text of one of the Hub user's own text messages; the message
   * stays as a stub for both sides (MKT-CNV-007).
   */
  @route("/delete-message")
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
  deleteMessage(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: DeleteMessageRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Orgs.Marketplace.Contacts.ConversationMessage;
      }
    | PendingMessageResponse
    | MessageErrors
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.HubConversationNotFoundErrorResponse
    | Vetchium.Problem.HubConversationMessageNotFoundErrorResponse
    | Vetchium.Problem.HubOrgUnavailableErrorResponse;

  /**
   * Counts the conversations waiting on the Hub user: chat requests to
   * answer, and conversations with agency messages not yet read
   * (MKT-HUB-001).
   */
  @route("/count-awaiting-conversations")
  @get
  @useAuth(BearerAuth)
  countAwaitingConversations():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AwaitingConversationCounts;
      }
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * Lists the agencies assigned to an Opening with the Hub user's chat state
   * with each (MKT-HUB-005).
   */
  @route("/list-opening-agencies")
  @post
  @useAuth(BearerAuth)
  listOpeningAgencies(@body request: ListOpeningAgenciesRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListOpeningAgenciesResponse;
      }
    | MessageErrors
    | Vetchium.Problem.HubOrgNotFoundErrorResponse
    | Vetchium.Problem.HubOpeningNotFoundErrorResponse
    | Vetchium.Problem.HubOrgUnavailableErrorResponse;

  /**
   * Sends a chat request to an agency assigned to a `published` Opening
   * (MKT-REQ-002, MKT-DAT-014).
   */
  @route("/send-chat-request")
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
  sendChatRequest(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: HubSendChatRequestRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: HubChatRequest;
      }
    | PendingMessageResponse
    | MessageErrors
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.HubOrgNotFoundErrorResponse
    | Vetchium.Problem.HubOpeningNotFoundErrorResponse
    | Vetchium.Problem.HubOrgUnavailableErrorResponse
    | Vetchium.Problem.HubAgencyNotAssignedErrorResponse
    | Vetchium.Problem.HubChatRequestLimitReachedErrorResponse
    | Vetchium.Problem.HubChatRequestExistsErrorResponse
    | Vetchium.Problem.HubConversationOpenErrorResponse
    | Vetchium.Problem.HubChatRequestBlockedErrorResponse
    | Vetchium.Problem.HubConversationPartyDeletedErrorResponse;

  /** Lists the Hub user's chat requests in one direction. */
  @route("/list-chat-requests")
  @post
  @useAuth(BearerAuth)
  listChatRequests(@body request: ListHubChatRequestsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListHubChatRequestsResponse;
      }
    | MessageErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  /** Accepts an agency's pending chat request, opening the conversation. */
  @route("/accept-chat-request")
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
  acceptChatRequest(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: HubAcceptChatRequestRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: HubConversationDetail;
      }
    | PendingMessageResponse
    | MessageErrors
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.HubChatRequestNotFoundErrorResponse
    | Vetchium.Problem.HubConversationPartyDeletedErrorResponse
    | Vetchium.Problem.HubOrgUnavailableErrorResponse;

  /** Declines an agency's pending chat request for an Opening or a window. */
  @route("/decline-chat-request")
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
  declineChatRequest(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: HubDeclineChatRequestRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: HubChatRequest;
      }
    | PendingMessageResponse
    | MessageErrors
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.HubChatRequestNotFoundErrorResponse;

  /** Marks an agency conversation read on the Hub side. */
  @route("/mark-conversation-read")
  @post
  @useAuth(BearerAuth)
  markConversationRead(@body request: MarkConversationReadRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
      }
    | MessageErrors
    | Vetchium.Problem.HubConversationNotFoundErrorResponse;
}
