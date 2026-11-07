import type { EmailAddress } from "../../../common/common.ts";
import type { ProfessionalDomain } from "../../../common/domain.ts";
import type { DisplayName } from "../../../common/localization.ts";
import type { PaginationKey } from "../../../common/pagination.ts";
import { isPaginationKey } from "../../../common/pagination.ts";
import type {
  ProfileAddress,
  ProfileMonth,
  PublicProfile,
} from "../../../hub/profile/public.ts";
import { isProfileAddress } from "../../../hub/profile/public.ts";
import type { HubHandle } from "../../../hub/types.ts";
import type { OpeningNumber } from "../../openings/types.ts";
import type { OrgDomain } from "../../types.ts";
import { isOrgDomain } from "../../types.ts";

/** Bounds the notes on one Contact. */
export const maxNotesPerContact = 200;
/** Bounds the Contacts an agency creates per UTC day. */
export const maxNewContactsPerDay = 200;
/** Bounds the chat requests an agency sends per UTC day. */
export const maxChatRequestsPerDay = 50;
/** Bounds a chat request's note in code points. */
export const maxChatRequestNoteLength = 1000;
/** Bounds a note in code points. */
export const maxNoteLength = 5000;
/** Bounds a message in code points. */
export const maxMessageLength = 5000;
/** Bounds one page of Contacts or notes. */
export const maxPage = 100;

/** Names one Contact of an agency; never reused. */
export type ContactID = string;
export type ContactNoteID = string;
export type ConversationID = string;
export type MessageID = string;
export type NoteText = string;
export type MessageText = string;

export const messageKinds = ["text", "suggestion", "request"] as const;
export type MessageKind = (typeof messageKinds)[number];

export const messageSenderTypes = ["agency", "hub_user"] as const;
export type MessageSenderType = (typeof messageSenderTypes)[number];

export const conversationReadOnlyReasons = [
  "hub_user_deleted",
  "agency_deleted",
] as const;
export type ConversationReadOnlyReason =
  (typeof conversationReadOnlyReasons)[number];

export const contactFilters = [
  "all",
  "requests",
  "unread",
  "has_conversation",
  "not_contacted",
] as const;
export type ContactFilter = (typeof contactFilters)[number];

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Accepts the lowercase form the API returns. */
export function isContactID(value: string): boolean {
  return uuidPattern.test(value);
}

export function isContactNoteID(value: string): boolean {
  return uuidPattern.test(value);
}

export function isConversationID(value: string): boolean {
  return uuidPattern.test(value);
}

export function isMessageID(value: string): boolean {
  return uuidPattern.test(value);
}

export function normalizeNoteText(value: NoteText): NoteText {
  return value.trim();
}

export function normalizeMessageText(value: MessageText): MessageText {
  return value.trim();
}

/** Plain text of 1–5,000 code points once trimmed. */
export function isNoteText(value: string): boolean {
  const length = Array.from(normalizeNoteText(value)).length;
  return length >= 1 && length <= maxNoteLength;
}

export function isMessageText(value: string): boolean {
  const length = Array.from(normalizeMessageText(value)).length;
  return length >= 1 && length <= maxMessageLength;
}

export interface OpeningSuggestion {
  consumer_domain: OrgDomain;
  opening_number: OpeningNumber;
}

export function isOpeningSuggestion(value: OpeningSuggestion): boolean {
  return (
    isOrgDomain(value.consumer_domain) &&
    Number.isInteger(value.opening_number) &&
    value.opening_number > 0
  );
}

/** Names one chat request; never reused. */
export type ChatRequestID = string;
/** Plain text of 1–1,000 code points once trimmed. */
export type ChatRequestNote = string;

export function isChatRequestID(value: string): boolean {
  return uuidPattern.test(value);
}

export function normalizeChatRequestNote(
  value: ChatRequestNote,
): ChatRequestNote {
  return value.trim();
}

export function isChatRequestNote(value: string): boolean {
  const length = Array.from(normalizeChatRequestNote(value)).length;
  return length >= 1 && length <= maxChatRequestNoteLength;
}

export const chatRequestStates = [
  "pending",
  "accepted",
  "declined",
  "expired",
] as const;
export type ChatRequestState = (typeof chatRequestStates)[number];

/** Who the request asks. */
export const chatRequestDirections = ["to_hub_user", "to_agency"] as const;
export type ChatRequestDirection = (typeof chatRequestDirections)[number];

/** What a decline blocks: one Opening, or the sender for one window. */
export const chatRequestDeclineScopes = ["opening", "sender"] as const;
export type ChatRequestDeclineScope = (typeof chatRequestDeclineScopes)[number];

/** A chat request as the agency sees it. */
export interface ChatRequest {
  request_id: ChatRequestID;
  contact_id: ContactID;
  direction: ChatRequestDirection;
  state: ChatRequestState;
  opening: OpeningSuggestion;
  /** Present only while the request is pending. */
  note?: ChatRequestNote;
  hub_user_name: DisplayName;
  hub_user_handle: HubHandle;
  /** The sending agency user's email address; absent for a Hub request. */
  sent_by?: EmailAddress;
  sent_at: string;
  answered_at?: string;
  decline_scope?: ChatRequestDeclineScope;
  /** When a `sender` decline lifts. */
  blocked_until?: string;
  /** The conversation window in whole days, for "Not for N days". */
  window_days?: number;
}

export interface ConversationMessage {
  message_id: MessageID;
  sender_type: MessageSenderType;
  sender_display_name: string;
  kind: MessageKind;
  text?: MessageText;
  /** The Opening of a `suggestion` or `request` message. */
  suggestion?: OpeningSuggestion;
  /** The note of a `request` message, when its sender wrote one. */
  note?: ChatRequestNote;
  sent_at: string;
}

export interface ConversationSummary {
  conversation_id: ConversationID;
  contact_id: ContactID;
  recorded_hub_user_name: string;
  recorded_hub_user_handle: HubHandle;
  recorded_agency_name: string;
  recorded_agency_domain: OrgDomain;
  agency_unread: boolean;
  read_only_reason?: ConversationReadOnlyReason;
  /** Until when the agency may write; absent when it may not. */
  agency_may_write_until?: string;
  /** Until when the Hub user may write; absent when they may not. */
  hub_may_write_until?: string;
  created_at: string;
  last_activity_at: string;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  /** One page of messages, newest first. */
  messages: ConversationMessage[];
  /** Resumes with older messages. */
  next_pagination_key?: PaginationKey;
}

/** A verified professional-email domain with the months of its first and last verification. */
export interface VerifiedDomain {
  domain: ProfessionalDomain;
  first_verified_month: ProfileMonth;
  last_verified_month: ProfileMonth;
}

export interface ContactSummary {
  contact_id: ContactID;
  display_name: DisplayName;
  handle: HubHandle;
  /** The person does not accept chat requests from agencies. */
  requests_off: boolean;
  /** The person's account no longer exists; only the conversation remains. */
  account_deleted: boolean;
  note_count: number;
  has_conversation: boolean;
  /** The direction of a pending chat request between the two, if any. */
  pending_request_direction?: ChatRequestDirection;
  unread_messages_count: number;
  credited_count: number;
  last_activity_at: string;
}

export interface ContactOpeningSuggestion {
  consumer_domain: OrgDomain;
  opening_number: OpeningNumber;
  suggested_at: string;
}

export interface Contact extends ContactSummary {
  /** Absent when a Hub user's chat request created the Contact. */
  created_by?: EmailAddress;
  suggested_openings: ContactOpeningSuggestion[];
  /** The latest chat request between the two, in any state. */
  latest_request?: ChatRequest;
  created_at: string;
}

export interface ContactNote {
  note_id: ContactNoteID;
  author: EmailAddress;
  /** The caller wrote it, so the caller may edit it. */
  mine: boolean;
  text: NoteText;
  created_at: string;
  edited_at?: string;
}

/** A Hub user's profile as an agency sees it. */
export interface AgencyProfile {
  profile: PublicProfile;
  verified_domains: VerifiedDomain[];
  contact?: ContactSummary;
}

export interface ViewHubProfileRequest {
  address: ProfileAddress;
}

export function validateViewHubProfileRequest(
  request: ViewHubProfileRequest,
): string[] {
  return isProfileAddress(request.address) ? [] : ["address"];
}

function validatePage(
  paginationKey: PaginationKey | undefined,
  limit: number | undefined,
): string[] {
  const fields: string[] = [];
  if (paginationKey !== undefined && !isPaginationKey(paginationKey))
    fields.push("pagination_key");
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > maxPage)
  )
    fields.push("limit");
  return fields;
}

/** A case-insensitive substring of the Contact's recorded display name. */
export type ContactNameQuery = string;

export function normalizeContactNameQuery(
  value: ContactNameQuery,
): ContactNameQuery {
  return value.trim();
}

/** Reports a trimmed query of 2 to 100 code points. */
export function isContactNameQuery(value: ContactNameQuery): boolean {
  const length = Array.from(value).length;
  return (
    length >= 2 && length <= 100 && value === normalizeContactNameQuery(value)
  );
}

export interface ListContactsRequest {
  pagination_key?: PaginationKey;
  /** Defaults to 50. */
  limit?: number;
  filter?: ContactFilter;
  name_query?: ContactNameQuery;
}

export function validateListContactsRequest(
  request: ListContactsRequest,
): string[] {
  const fields = validatePage(request.pagination_key, request.limit);
  if (
    request.filter !== undefined &&
    !contactFilters.includes(request.filter)
  ) {
    fields.push("filter");
  }
  if (
    request.name_query !== undefined &&
    !isContactNameQuery(request.name_query)
  ) {
    fields.push("name_query");
  }
  return fields;
}

/** How many of the agency's Contacts each Contacts tab holds. */
export interface ContactCounts {
  all: number;
  requests: number;
  unread: number;
  has_conversation: number;
  not_contacted: number;
}

export interface ListContactsResponse {
  items: ContactSummary[];
  /** Counts every Contact of the agency, whatever the filter and query. */
  counts: ContactCounts;
  next_pagination_key?: PaginationKey;
}

export interface ContactReference {
  contact_id: ContactID;
}

export function validateContactReference(request: ContactReference): string[] {
  return isContactID(request.contact_id) ? [] : ["contact_id"];
}

export interface ListContactNotesRequest {
  contact_id: ContactID;
  pagination_key?: PaginationKey;
  /** Defaults to 50. */
  limit?: number;
}

export function validateListContactNotesRequest(
  request: ListContactNotesRequest,
): string[] {
  return [
    ...validateContactReference(request),
    ...validatePage(request.pagination_key, request.limit),
  ];
}

export interface ListContactNotesResponse {
  items: ContactNote[];
  next_pagination_key?: PaginationKey;
}

/** Writes a note on the person at `address`, creating the agency's Contact if it has none. */
export interface AddPersonNoteRequest {
  address: ProfileAddress;
  text: NoteText;
}

export function validateAddPersonNoteRequest(
  request: AddPersonNoteRequest,
): string[] {
  const fields: string[] = [];
  if (!isProfileAddress(request.address)) fields.push("address");
  if (!isNoteText(request.text)) fields.push("text");
  return fields;
}

export interface AddContactNoteRequest {
  contact_id: ContactID;
  text: NoteText;
}

export function validateAddContactNoteRequest(
  request: AddContactNoteRequest,
): string[] {
  const fields = validateContactReference(request);
  if (!isNoteText(request.text)) fields.push("text");
  return fields;
}

/** The note written and the Contact it belongs to. */
export interface AddedNote {
  contact: ContactSummary;
  note: ContactNote;
}

export interface EditContactNoteRequest {
  contact_id: ContactID;
  note_id: ContactNoteID;
  text: NoteText;
}

export function validateEditContactNoteRequest(
  request: EditContactNoteRequest,
): string[] {
  const fields = validateContactReference(request);
  if (!isContactNoteID(request.note_id)) fields.push("note_id");
  if (!isNoteText(request.text)) fields.push("text");
  return fields;
}

export interface DeleteContactNoteRequest {
  contact_id: ContactID;
  note_id: ContactNoteID;
}

export function validateDeleteContactNoteRequest(
  request: DeleteContactNoteRequest,
): string[] {
  const fields = validateContactReference(request);
  if (!isContactNoteID(request.note_id)) fields.push("note_id");
  return fields;
}

export interface DeletedNote {
  /** The note was the Contact's last, and the Contact went with it. */
  contact_deleted: boolean;
}

/**
 * Asks a person, by handle or alias or by the agency's Contact, to open the
 * conversation about an Opening. Exactly one of `address` and `contact_id`.
 */
export interface SendChatRequestRequest {
  address?: ProfileAddress;
  contact_id?: ContactID;
  suggestion: OpeningSuggestion;
  note?: ChatRequestNote;
}

export function normalizeSendChatRequestRequest(
  request: SendChatRequestRequest,
): SendChatRequestRequest {
  return {
    ...request,
    ...(request.address !== undefined && { address: request.address.trim() }),
    ...(request.note !== undefined && {
      note: normalizeChatRequestNote(request.note),
    }),
  };
}

export function validateSendChatRequestRequest(
  request: SendChatRequestRequest,
): string[] {
  const fields: string[] = [];
  if ((request.address === undefined) === (request.contact_id === undefined)) {
    fields.push("address", "contact_id");
  } else if (
    request.address !== undefined &&
    !isProfileAddress(request.address)
  ) {
    fields.push("address");
  } else if (
    request.contact_id !== undefined &&
    !isContactID(request.contact_id)
  ) {
    fields.push("contact_id");
  }
  if (!isOpeningSuggestion(request.suggestion)) fields.push("suggestion");
  if (request.note !== undefined && !isChatRequestNote(request.note))
    fields.push("note");
  return fields;
}

export interface ListChatRequestsRequest {
  direction: ChatRequestDirection;
  pagination_key?: PaginationKey;
  /** Defaults to 50. */
  limit?: number;
}

export function validateListChatRequestsRequest(
  request: ListChatRequestsRequest,
): string[] {
  const fields: string[] = [];
  if (!chatRequestDirections.includes(request.direction))
    fields.push("direction");
  return [...fields, ...validatePage(request.pagination_key, request.limit)];
}

export interface ListChatRequestsResponse {
  /** Pending requests oldest first, then answered ones newest first. */
  items: ChatRequest[];
  next_pagination_key?: PaginationKey;
}

/** Pending requests from Hub users to the agency. */
export interface PendingChatRequestCount {
  count: number;
}

export interface AcceptChatRequestRequest {
  request_id: ChatRequestID;
}

export function validateAcceptChatRequestRequest(
  request: AcceptChatRequestRequest,
): string[] {
  return isChatRequestID(request.request_id) ? [] : ["request_id"];
}

export interface DeclineChatRequestRequest {
  request_id: ChatRequestID;
  scope: ChatRequestDeclineScope;
}

export function validateDeclineChatRequestRequest(
  request: DeclineChatRequestRequest,
): string[] {
  const fields = validateAcceptChatRequestRequest(request);
  if (!chatRequestDeclineScopes.includes(request.scope)) fields.push("scope");
  return fields;
}

export interface SendMessageRequest {
  contact_id: ContactID;
  text?: MessageText;
  suggestion?: OpeningSuggestion;
}

export function validateSendMessageRequest(
  request: SendMessageRequest,
): string[] {
  const fields = validateContactReference(request);
  const hasText = request.text !== undefined && isMessageText(request.text);
  const hasSuggestion =
    request.suggestion !== undefined && isOpeningSuggestion(request.suggestion);
  if ((!hasText && !hasSuggestion) || (hasText && hasSuggestion)) {
    if (request.text !== undefined && !isMessageText(request.text)) {
      fields.push("text");
    } else if (
      request.suggestion !== undefined &&
      !isOpeningSuggestion(request.suggestion)
    ) {
      fields.push("suggestion");
    } else {
      fields.push("text");
    }
  }
  return fields;
}

export interface GetConversationRequest {
  contact_id: ContactID;
  pagination_key?: PaginationKey;
  /** Defaults to 50. */
  limit?: number;
}

export function validateGetConversationRequest(
  request: GetConversationRequest,
): string[] {
  return [
    ...validatePage(request.pagination_key, request.limit),
    ...validateContactReference(request),
  ];
}

export interface MarkConversationReadRequest {
  contact_id: ContactID;
}

export function validateMarkConversationReadRequest(
  request: MarkConversationReadRequest,
): string[] {
  return validateContactReference(request);
}
