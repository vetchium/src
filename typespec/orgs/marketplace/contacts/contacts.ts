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
/** Bounds the new conversations an agency starts per UTC day. */
export const maxNewConversationsPerDay = 50;
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

export const messageKinds = ["text", "suggestion"] as const;
export type MessageKind = (typeof messageKinds)[number];

export const messageSenderTypes = ["agency", "hub_user"] as const;
export type MessageSenderType = (typeof messageSenderTypes)[number];

export const conversationReadOnlyReasons = [
  "messages_off",
  "hub_user_deleted",
  "agency_deleted",
] as const;
export type ConversationReadOnlyReason =
  (typeof conversationReadOnlyReasons)[number];

export const contactFilters = [
  "all",
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

export interface ConversationMessage {
  message_id: MessageID;
  sender_type: MessageSenderType;
  sender_display_name: string;
  kind: MessageKind;
  text?: MessageText;
  suggestion?: OpeningSuggestion;
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
  /** The person does not accept messages from agencies. */
  messages_off: boolean;
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
  created_by: EmailAddress;
  suggested_openings: ContactOpeningSuggestion[];
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

export interface StartConversationRequest {
  address: ProfileAddress;
  text?: MessageText;
  suggestion?: OpeningSuggestion;
}

export function validateStartConversationRequest(
  request: StartConversationRequest,
): string[] {
  const fields: string[] = [];
  if (!isProfileAddress(request.address)) fields.push("address");
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
