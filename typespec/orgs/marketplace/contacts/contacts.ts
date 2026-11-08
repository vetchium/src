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
import { isHubHandle } from "../../../hub/types.ts";
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

/** Numbers the notes of one Contact from 1; never reused while it exists. */
export type NoteNumber = number;
/** Numbers the messages of one conversation from 1. */
export type MessageNumber = number;
/** Numbers the chat requests of one Contact from 1. */
export type ChatRequestNumber = number;
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
] as const;
export type ContactFilter = (typeof contactFilters)[number];

/**
 * Where the agency stands with a Contact, in precedence order: the first
 * that holds is the Contact's (MKT-UI-007).
 */
export const contactStatuses = [
  "request_received",
  "request_sent",
  "in_conversation",
  "request_declined",
  "request_expired",
  "conversation_closed",
  "no_conversation",
] as const;
export type ContactStatus = (typeof contactStatuses)[number];

function isPositiveNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 2147483647;
}

export function isNoteNumber(value: number): boolean {
  return isPositiveNumber(value);
}

export function isMessageNumber(value: number): boolean {
  return isPositiveNumber(value);
}

export function isChatRequestNumber(value: number): boolean {
  return isPositiveNumber(value);
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

/** Plain text of 1–1,000 code points once trimmed. */
export type ChatRequestNote = string;

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
  request_number: ChatRequestNumber;
  direction: ChatRequestDirection;
  state: ChatRequestState;
  opening: OpeningSuggestion;
  /** Present only while the request is pending. */
  note?: ChatRequestNote;
  hub_user_name: DisplayName;
  /** Names the Contact the request belongs to. */
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
  message_number: MessageNumber;
  sender_type: MessageSenderType;
  sender_display_name: string;
  kind: MessageKind;
  /** Its sender deleted it; only this stub remains. */
  deleted: boolean;
  /** Absent once the message is deleted. */
  text?: MessageText;
  /** The Opening of a `suggestion` or `request` message. */
  suggestion?: OpeningSuggestion;
  /** The note of a `request` message, when its sender wrote one. */
  note?: ChatRequestNote;
  sent_at: string;
}

export interface ConversationSummary {
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
  display_name: DisplayName;
  /** Names the Contact; permanent and unique across Vetchium. */
  handle: HubHandle;
  status: ContactStatus;
  /** The person does not accept chat requests from agencies. */
  requests_off: boolean;
  /** The person's account no longer exists; only the conversation remains. */
  account_deleted: boolean;
  note_count: number;
  has_conversation: boolean;
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
  suggested_openings: ContactOpeningSuggestion[];
  /** The latest chat request between the two, in any state. */
  latest_request?: ChatRequest;
}

export interface ContactNote {
  note_number: NoteNumber;
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
}

export interface ListContactsResponse {
  items: ContactSummary[];
  /** Counts every Contact of the agency, whatever the filter and query. */
  counts: ContactCounts;
  next_pagination_key?: PaginationKey;
}

export interface ContactReference {
  handle: HubHandle;
}

export function validateContactReference(request: ContactReference): string[] {
  return isHubHandle(request.handle) ? [] : ["handle"];
}

export interface ListContactNotesRequest {
  handle: HubHandle;
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
  handle: HubHandle;
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
  handle: HubHandle;
  note_number: NoteNumber;
  text: NoteText;
}

export function validateEditContactNoteRequest(
  request: EditContactNoteRequest,
): string[] {
  const fields = validateContactReference(request);
  if (!isNoteNumber(request.note_number)) fields.push("note_number");
  if (!isNoteText(request.text)) fields.push("text");
  return fields;
}

/**
 * Asks a person, by handle or alias, to open the conversation about an
 * Opening the agency is assigned to.
 */
export interface SendChatRequestRequest {
  address: ProfileAddress;
  suggestion: OpeningSuggestion;
  note?: ChatRequestNote;
}

export function normalizeSendChatRequestRequest(
  request: SendChatRequestRequest,
): SendChatRequestRequest {
  return {
    ...request,
    address: request.address.trim(),
    ...(request.note !== undefined && {
      note: normalizeChatRequestNote(request.note),
    }),
  };
}

export function validateSendChatRequestRequest(
  request: SendChatRequestRequest,
): string[] {
  const fields: string[] = [];
  if (!isProfileAddress(request.address)) fields.push("address");
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
  handle: HubHandle;
  request_number: ChatRequestNumber;
}

export function validateAcceptChatRequestRequest(
  request: AcceptChatRequestRequest,
): string[] {
  const fields = validateContactReference(request);
  if (!isChatRequestNumber(request.request_number))
    fields.push("request_number");
  return fields;
}

export interface DeclineChatRequestRequest {
  handle: HubHandle;
  request_number: ChatRequestNumber;
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
  handle: HubHandle;
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

/** Deletes one of the agency's own text messages. */
export interface DeleteMessageRequest {
  handle: HubHandle;
  message_number: MessageNumber;
}

export function validateDeleteMessageRequest(
  request: DeleteMessageRequest,
): string[] {
  const fields = validateContactReference(request);
  if (!isMessageNumber(request.message_number)) fields.push("message_number");
  return fields;
}

export interface GetConversationRequest {
  handle: HubHandle;
  pagination_key?: PaginationKey;
  /** Defaults to 50. */
  limit?: number;
}

export function validateGetConversationRequest(
  request: GetConversationRequest,
): string[] {
  return [
    ...validateContactReference(request),
    ...validatePage(request.pagination_key, request.limit),
  ];
}

export interface MarkConversationReadRequest {
  handle: HubHandle;
}

export function validateMarkConversationReadRequest(
  request: MarkConversationReadRequest,
): string[] {
  return validateContactReference(request);
}
