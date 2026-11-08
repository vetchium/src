import "@typespec/http";
import "@typespec/openapi";

import "../../../common/authentication.tsp";
import "../../../common/domain.tsp";
import "../../../common/idempotency.tsp";
import "../../../common/localization.tsp";
import "../../../common/pagination.tsp";
import "../../../hub/profile/public.tsp";
import "../../../hub/types.tsp";
import "../../../problem/common.tsp";
import "../../../problem/details.tsp";
import "../../../problem/orgs/authentication.tsp";
import "../../../problem/orgs/marketplace.tsp";
import "../../../problem/orgs/suspension.tsp";
import "../../openings/types.tsp";
import "../../types.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Marketplace.Contacts;

/** Numbers the notes of one Contact from 1; never reused while it exists. */
@minValue(1)
scalar NoteNumber extends int32;

/** Plain text, 1–5,000 code points after trimming. */
@maxLength(20000)
scalar NoteText extends string;

/** Plain text message, 1–5,000 code points after trimming. */
@maxLength(20000)
scalar MessageText extends string;

/** Numbers the messages of one conversation from 1; never reused. */
@minValue(1)
scalar MessageNumber extends int32;

enum MessageKind {
  text: "text",
  suggestion: "suggestion",

  /** An accepted chat request: its Opening and note (MKT-REQ-005). */
  request: "request",
}

enum MessageSenderType {
  agency: "agency",
  hub_user: "hub_user",
}

enum ConversationReadOnlyReason {
  hub_user_deleted: "hub_user_deleted",
  agency_deleted: "agency_deleted",
}

enum ContactFilter {
  all: "all",

  /** Contacts with a pending chat request in either direction. */
  requests: "requests",

  unread: "unread",
  has_conversation: "has_conversation",
}

model OpeningSuggestion {
  consumer_domain: Vetchium.Orgs.OrgDomain;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
}

/** Numbers the chat requests of one Contact from 1; never reused while it exists. */
@minValue(1)
scalar ChatRequestNumber extends int32;

/** Plain text, 1–1,000 code points after trimming. */
@maxLength(4000)
scalar ChatRequestNote extends string;

enum ChatRequestState {
  pending: "pending",
  accepted: "accepted",
  declined: "declined",
  expired: "expired",
}

/** Who the request asks: the agency sent it, or the Hub user did. */
enum ChatRequestDirection {
  to_hub_user: "to_hub_user",
  to_agency: "to_agency",
}

/**
 * `opening` stops the sender requesting with that Opening again; `sender`
 * stops every request from the sender for one conversation window
 * (MKT-REQ-007).
 */
enum ChatRequestDeclineScope {
  opening: "opening",
  sender: "sender",
}

/** A chat request as the agency sees it (MKT-REQ-001). */
model ChatRequest {
  request_number: ChatRequestNumber;
  direction: ChatRequestDirection;
  state: ChatRequestState;
  opening: OpeningSuggestion;

  /** Present only while the request is `pending` (MKT-REQ-012). */
  note?: ChatRequestNote;

  /** The Hub user's name as the agency last recorded it. */
  hub_user_name: Vetchium.DisplayName;

  /** Names the Contact the request belongs to. */
  hub_user_handle: Vetchium.Hub.HubHandle;

  /** The agency user who sent it, by email address; absent for a Hub request. */
  sent_by?: Vetchium.EmailAddress;

  sent_at: utcDateTime;
  answered_at?: utcDateTime;
  decline_scope?: ChatRequestDeclineScope;

  /** When a `sender` decline lifts. */
  blocked_until?: utcDateTime;

  /** The conversation window in whole days, for "Not for N days". */
  window_days?: int32;
}

model ConversationMessage {
  message_number: MessageNumber;
  sender_type: MessageSenderType;
  sender_display_name: string;
  kind: MessageKind;

  /** Its sender deleted it; only this stub remains (MKT-CNV-007). */
  deleted: boolean;

  /** Absent once the message is deleted. */
  text?: MessageText;

  /** The Opening of a `suggestion` or a `request` message. */
  suggestion?: OpeningSuggestion;

  /** The note of a `request` message, when its sender wrote one. */
  note?: ChatRequestNote;

  sent_at: utcDateTime;
}

model ConversationSummary {
  recorded_hub_user_name: string;
  recorded_hub_user_handle: Vetchium.Hub.HubHandle;
  recorded_agency_name: string;
  recorded_agency_domain: Vetchium.Orgs.OrgDomain;
  agency_unread: boolean;
  read_only_reason?: ConversationReadOnlyReason;

  /** Until when the agency may write; absent when it may not (MKT-REQ-004). */
  agency_may_write_until?: utcDateTime;

  /** Until when the Hub user may write; absent when they may not. */
  hub_may_write_until?: utcDateTime;

  created_at: utcDateTime;
  last_activity_at: utcDateTime;
}

model ConversationDetail {
  conversation: ConversationSummary;

  /** One page of messages, newest first. */
  messages: ConversationMessage[];

  /** Resumes with older messages. */
  next_pagination_key?: Vetchium.PaginationKey;
}

/**
 * Asks a person, by handle or alias, to open the conversation about an
 * Opening the agency is assigned to.
 */
model SendChatRequestRequest {
  address: Vetchium.Hub.Profile.ProfileAddress;
  suggestion: OpeningSuggestion;
  note?: ChatRequestNote;
}

model ListChatRequestsRequest {
  direction: ChatRequestDirection;
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: ContactPageSize = 50;
}

model ListChatRequestsResponse {
  /** Pending requests oldest first, then answered ones newest first. */
  items: ChatRequest[];

  next_pagination_key?: Vetchium.PaginationKey;
}

/** Pending requests from Hub users to the agency. */
model PendingChatRequestCount {
  count: int32;
}

model AcceptChatRequestRequest {
  handle: Vetchium.Hub.HubHandle;
  request_number: ChatRequestNumber;
}

model DeclineChatRequestRequest {
  handle: Vetchium.Hub.HubHandle;
  request_number: ChatRequestNumber;
  scope: ChatRequestDeclineScope;
}

model SendMessageRequest {
  handle: Vetchium.Hub.HubHandle;
  text?: MessageText;
  suggestion?: OpeningSuggestion;
}

/** Deletes one of the agency's own text messages (MKT-CNV-007). */
model DeleteMessageRequest {
  handle: Vetchium.Hub.HubHandle;
  message_number: MessageNumber;
}

model GetConversationRequest {
  handle: Vetchium.Hub.HubHandle;
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: ContactPageSize = 50;
}

model MarkConversationReadRequest {
  handle: Vetchium.Hub.HubHandle;
}

@minValue(1)
@maxValue(100)
scalar ContactPageSize extends int32;

/** A case-insensitive substring of the Contact's recorded display name. */
@minLength(2)
@maxLength(100)
scalar ContactNameQuery extends string;

/** How many of the agency's Contacts each Contacts tab holds. */
model ContactCounts {
  all: int32;
  requests: int32;
  unread: int32;
  has_conversation: int32;
}

/**
 * A verified professional-email domain with the months of its first and last
 * verification. Never an address, a local part, or an exact instant.
 */
model VerifiedDomain {
  domain: Vetchium.ProfessionalDomain;
  first_verified_month: Vetchium.Hub.Profile.ProfileMonth;
  last_verified_month: Vetchium.Hub.Profile.ProfileMonth;
}

/**
 * Where the agency stands with a Contact (MKT-UI-007), the first that holds:
 * a pending request from the person, a pending request to them, a
 * conversation the agency may write in, the agency's latest request declined
 * or expired after the conversation's last activity, a conversation the
 * agency may not write in, and no conversation.
 */
enum ContactStatus {
  request_received: "request_received",
  request_sent: "request_sent",
  in_conversation: "in_conversation",
  request_declined: "request_declined",
  request_expired: "request_expired",
  conversation_closed: "conversation_closed",
  no_conversation: "no_conversation",
}

/** One Contact in a list or beside a profile. */
model ContactSummary {
  /** As last read from the person's profile. */
  display_name: Vetchium.DisplayName;

  /** Names the Contact; permanent and unique across Vetchium. */
  handle: Vetchium.Hub.HubHandle;

  status: ContactStatus;

  /** The person does not accept chat requests from agencies. */
  requests_off: boolean;

  /** The person's account no longer exists; only the conversation remains. */
  account_deleted: boolean;

  note_count: int32;
  has_conversation: boolean;
  unread_messages_count: int32;
  credited_count: int32;
  last_activity_at: utcDateTime;
}

model ContactOpeningSuggestion {
  consumer_domain: Vetchium.Orgs.OrgDomain;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  suggested_at: utcDateTime;
}

model Contact {
  ...ContactSummary;
  suggested_openings: ContactOpeningSuggestion[];

  /** The latest chat request between the two, in any state. */
  latest_request?: ChatRequest;
}

model ContactNote {
  note_number: NoteNumber;

  /** The email address of the agency user who wrote it. */
  author: Vetchium.EmailAddress;

  /** The caller wrote it, so the caller may edit it. */
  mine: boolean;

  text: NoteText;
  created_at: utcDateTime;
  edited_at?: utcDateTime;
}

/**
 * A Hub user's profile as an agency sees it: the public profile plus each
 * verified professional-email domain, and the agency's Contact when it has
 * one.
 */
model AgencyProfile {
  profile: Vetchium.Hub.Profile.PublicProfile;
  verified_domains: VerifiedDomain[];
  contact?: ContactSummary;
}

model ViewHubProfileRequest {
  address: Vetchium.Hub.Profile.ProfileAddress;
}

model ListContactsRequest {
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: ContactPageSize = 50;

  filter?: ContactFilter = ContactFilter.all;
  name_query?: ContactNameQuery;
}

model ListContactsResponse {
  items: ContactSummary[];

  /** Counts every Contact of the agency, whatever the filter and query. */
  counts: ContactCounts;

  next_pagination_key?: Vetchium.PaginationKey;
}

model ContactReference {
  handle: Vetchium.Hub.HubHandle;
}

model ListContactNotesRequest {
  handle: Vetchium.Hub.HubHandle;
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: ContactPageSize = 50;
}

model ListContactNotesResponse {
  items: ContactNote[];
  next_pagination_key?: Vetchium.PaginationKey;
}

/**
 * Writes a note on the person at `address`, creating the Contact if the
 * agency has none.
 */
model AddPersonNoteRequest {
  address: Vetchium.Hub.Profile.ProfileAddress;
  text: NoteText;
}

model AddContactNoteRequest {
  handle: Vetchium.Hub.HubHandle;
  text: NoteText;
}

/** The note written and the Contact it belongs to. */
model AddedNote {
  contact: ContactSummary;
  note: ContactNote;
}

model EditContactNoteRequest {
  handle: Vetchium.Hub.HubHandle;
  note_number: NoteNumber;
  text: NoteText;
}

alias ContactReadErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
  | Vetchium.Problem.OrgPermissionRequiredErrorResponse
  | Vetchium.Problem.OrgSuspendedErrorResponse
  | Vetchium.Problem.RateLimitExceededErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias ContactWriteErrors =
  | ContactReadErrors
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse;

@route("/api/orgs")
@tag("Org agency Contacts")
interface ContactOperations {
  /**
   * Reads a Hub user's profile by handle or alias, with each verified
   * professional-email domain, and records nothing about the view.
   */
  @route("/view-hub-profile")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  viewHubProfile(@body request: ViewHubProfileRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AgencyProfile;
      }
    | ContactReadErrors
    | Vetchium.Problem.OrgHubUserNotFoundErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse;

  /** Lists the agency's Contacts, most recent activity first. */
  @route("/list-contacts")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  listContacts(@body request: ListContactsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListContactsResponse;
      }
    | ContactReadErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  @route("/get-contact")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  getContact(@body request: ContactReference):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Contact;
      }
    | ContactReadErrors
    | Vetchium.Problem.OrgContactNotFoundErrorResponse;

  /** Lists a Contact's notes, newest first. */
  @route("/list-contact-notes")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  listContactNotes(@body request: ListContactNotesRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListContactNotesResponse;
      }
    | ContactReadErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.OrgContactNotFoundErrorResponse;

  /**
   * Writes a note on a person by handle or alias. The first note on a person
   * creates the agency's Contact, within the daily limit of new Contacts and
   * only while the agency has a listed `sourcing` Listing.
   */
  @route("/add-person-note")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
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
  addPersonNote(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: AddPersonNoteRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AddedNote;
      }
    | ContactWriteErrors
    | Vetchium.Problem.OrgHubUserNotFoundErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse
    | Vetchium.Problem.OrgListingNotAvailableErrorResponse
    | Vetchium.Problem.OrgContactLimitReachedErrorResponse
    | Vetchium.Problem.OrgContactNoteLimitReachedErrorResponse;

  /** Writes a note on one of the agency's Contacts. */
  @route("/add-contact-note")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
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
  addContactNote(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: AddContactNoteRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AddedNote;
      }
    | ContactWriteErrors
    | Vetchium.Problem.OrgContactNotFoundErrorResponse
    | Vetchium.Problem.OrgContactNoteLimitReachedErrorResponse
    | Vetchium.Problem.OrgConversationPartyDeletedErrorResponse;

  /** Replaces the text of a note its author wrote. */
  @route("/edit-contact-note")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
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
  editContactNote(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: EditContactNoteRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ContactNote;
      }
    | ContactWriteErrors
    | Vetchium.Problem.OrgContactNotFoundErrorResponse
    | Vetchium.Problem.OrgContactNoteNotFoundErrorResponse
    | Vetchium.Problem.OrgContactNoteNotAuthorErrorResponse;

  /**
   * Sends a chat request about an Opening the agency is assigned to, creating
   * the Contact if absent (MKT-REQ-002, MKT-DAT-004).
   */
  @route("/send-chat-request")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
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
    @body request: SendChatRequestRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ChatRequest;
      }
    | ContactWriteErrors
    | Vetchium.Problem.OrgListingNotAvailableErrorResponse
    | Vetchium.Problem.OrgChatRequestLimitReachedErrorResponse
    | Vetchium.Problem.OrgContactLimitReachedErrorResponse
    | Vetchium.Problem.OrgHubUserNotFoundErrorResponse
    | Vetchium.Problem.OrgAgencyRequestsOffErrorResponse
    | Vetchium.Problem.OrgConversationPartyDeletedErrorResponse
    | Vetchium.Problem.OrgChatRequestExistsErrorResponse
    | Vetchium.Problem.OrgConversationOpenErrorResponse
    | Vetchium.Problem.OrgChatRequestBlockedErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse;

  /** Lists the agency's chat requests in one direction. */
  @route("/list-chat-requests")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  listChatRequests(@body request: ListChatRequestsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListChatRequestsResponse;
      }
    | ContactReadErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  /** Counts the chat requests from Hub users awaiting the agency's answer. */
  @route("/count-pending-chat-requests")
  @get
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  countPendingChatRequests():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: PendingChatRequestCount;
      }
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Accepts a Hub user's pending chat request, opening the conversation. */
  @route("/accept-chat-request")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
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
    @body request: AcceptChatRequestRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ConversationDetail;
      }
    | ContactWriteErrors
    | Vetchium.Problem.OrgChatRequestNotFoundErrorResponse
    | Vetchium.Problem.OrgConversationPartyDeletedErrorResponse;

  /** Declines a Hub user's pending chat request for an Opening or a window. */
  @route("/decline-chat-request")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
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
    @body request: DeclineChatRequestRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ChatRequest;
      }
    | ContactWriteErrors
    | Vetchium.Problem.OrgChatRequestNotFoundErrorResponse;

  /** Sends a text message or an Opening suggestion in an existing conversation. */
  @route("/send-message")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
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
  sendMessage(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: SendMessageRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ConversationMessage;
      }
    | ContactWriteErrors
    | Vetchium.Problem.OrgContactNotFoundErrorResponse
    | Vetchium.Problem.OrgConversationNotFoundErrorResponse
    | Vetchium.Problem.OrgConversationPartyDeletedErrorResponse
    | Vetchium.Problem.OrgConversationClosedErrorResponse;

  /**
   * Deletes the text of one of the agency's own text messages; any agency
   * user may. The message stays as a stub, and the Hub user's tenant learns
   * of the deletion without the text (MKT-CNV-007).
   */
  @route("/delete-message")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
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
        @body body: ConversationMessage;
      }
    | ContactWriteErrors
    | Vetchium.Problem.OrgContactNotFoundErrorResponse
    | Vetchium.Problem.OrgConversationNotFoundErrorResponse
    | Vetchium.Problem.OrgConversationMessageNotFoundErrorResponse;

  /** Reads a Contact's conversation and its messages. */
  @route("/get-conversation")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  getConversation(@body request: GetConversationRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ConversationDetail;
      }
    | ContactReadErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.OrgContactNotFoundErrorResponse
    | Vetchium.Problem.OrgConversationNotFoundErrorResponse;

  /** Clears the agency's unread count on a conversation. */
  @route("/mark-conversation-read")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  markConversationRead(@body request: MarkConversationReadRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
      }
    | ContactReadErrors
    | Vetchium.Problem.OrgContactNotFoundErrorResponse
    | Vetchium.Problem.OrgConversationNotFoundErrorResponse;
}
