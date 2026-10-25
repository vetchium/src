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

model HubConversationSummary {
  contact_id: Vetchium.Orgs.Marketplace.Contacts.ContactID;
  agency_display_name: string;
  agency_domain: Vetchium.Orgs.OrgDomain;
  has_conversation: boolean;
  unread: boolean;
  unread_count: int32;
  read_only_reason?: Vetchium.Orgs.Marketplace.Contacts.ConversationReadOnlyReason;
  suggestions: HubOpeningSuggestion[];
  last_activity_at: utcDateTime;
}

model HubConversationDetail {
  conversation: HubConversationSummary;

  /** One page of messages, newest first. */
  messages: Vetchium.Orgs.Marketplace.Contacts.ConversationMessage[];

  /** Resumes with older messages. */
  next_pagination_key?: Vetchium.PaginationKey;
}

model ListConversationsRequest {
  pagination_key?: Vetchium.PaginationKey;

  @minValue(1)
  @maxValue(100)
  limit?: int32;
}

model ListConversationsResponse {
  items: HubConversationSummary[];
  next_pagination_key?: Vetchium.PaginationKey;
}

model GetConversationRequest {
  contact_id: Vetchium.Orgs.Marketplace.Contacts.ContactID;
  pagination_key?: Vetchium.PaginationKey;

  @minValue(1)
  @maxValue(100)
  limit?: int32;
}

model ReplyToConversationRequest {
  contact_id: Vetchium.Orgs.Marketplace.Contacts.ContactID;
  text: Vetchium.Orgs.Marketplace.Contacts.MessageText;
}

model DeleteConversationRequest {
  contact_id: Vetchium.Orgs.Marketplace.Contacts.ContactID;
}

model MarkConversationReadRequest {
  contact_id: Vetchium.Orgs.Marketplace.Contacts.ContactID;
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
    | Vetchium.Problem.HubAgencyMessagesOffErrorResponse
    | Vetchium.Problem.HubConversationPartyDeletedErrorResponse;

  /** Deletes an agency conversation for both sides. */
  @route("/delete-conversation")
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
  deleteConversation(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: DeleteConversationRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
      }
    | PendingMessageResponse
    | MessageErrors
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.HubConversationNotFoundErrorResponse;

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
