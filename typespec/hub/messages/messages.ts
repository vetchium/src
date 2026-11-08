import type { PaginationKey } from "../../common/pagination.ts";
import { isPaginationKey } from "../../common/pagination.ts";
import type {
  ChatRequestDeclineScope,
  ChatRequestDirection,
  ChatRequestNote,
  ChatRequestNumber,
  ChatRequestState,
  ConversationMessage,
  ConversationReadOnlyReason,
  MessageNumber,
  MessageText,
  OpeningSuggestion,
} from "../../orgs/marketplace/contacts/contacts.ts";
import {
  chatRequestDeclineScopes,
  chatRequestDirections,
  isChatRequestNote,
  isChatRequestNumber,
  isMessageNumber,
  isMessageText,
  normalizeChatRequestNote,
} from "../../orgs/marketplace/contacts/contacts.ts";
import type { OpeningNumber } from "../../orgs/openings/types.ts";
import type { OrgDomain } from "../../orgs/types.ts";
import { isOrgDomain, normalizeOrgDomain } from "../../orgs/types.ts";

export const maxPage = 100;
/** Bounds the chat requests a Hub user sends per UTC day. */
export const maxHubChatRequestsPerDay = 10;

export interface HubOpeningSuggestion {
  consumer_domain: OrgDomain;
  opening_number: OpeningNumber;
  sent_at: string;
}

/**
 * A chat request between the Hub user and an agency, as the Hub user's
 * pointer keeps it. It never carries the note; the conversation read does.
 */
export interface HubChatRequest {
  request_number: ChatRequestNumber;
  direction: ChatRequestDirection;
  state: ChatRequestState;
  opening: OpeningSuggestion;
  agency_display_name: string;
  /** Names the agency: its primary domain. */
  agency_domain: OrgDomain;
  sent_at: string;
  answered_at?: string;
  decline_scope?: ChatRequestDeclineScope;
  /** When a `sender` decline lifts. */
  blocked_until?: string;
  /** The conversation window in whole days, for "Not for N days". */
  window_days: number;
}

export interface HubConversationSummary {
  agency_display_name: string;
  /** Names the conversation: the agency's primary domain. */
  agency_domain: OrgDomain;
  has_conversation: boolean;
  unread: boolean;
  unread_count: number;
  read_only_reason?: ConversationReadOnlyReason;
  suggestions: HubOpeningSuggestion[];
  /** Until when the agency may write; absent when it may not. */
  agency_may_write_until?: string;
  /** Until when the Hub user may write; absent when they may not. */
  hub_may_write_until?: string;
  /** The latest chat request between the two, in any state. */
  latest_request?: HubChatRequest;
  last_activity_at: string;
}

export interface HubConversationDetail {
  conversation: HubConversationSummary;
  /** One page of messages, newest first. */
  messages: ConversationMessage[];
  /** The note of a pending chat request, read live from the agency's tenant. */
  pending_request_note?: ChatRequestNote;
  /** Resumes with older messages. */
  next_pagination_key?: PaginationKey;
}

/** The Hub user's chat with one agency assigned to an Opening. */
export const openingAgencyChatStates = [
  "none",
  "open",
  "closed",
  "request_sent",
  "request_received",
  "declined",
] as const;
export type OpeningAgencyChatState = (typeof openingAgencyChatStates)[number];

/** An agency with an active `sourcing` engagement assigned to the Opening. */
export interface OpeningAgency {
  agency_display_name: string;
  agency_domain: OrgDomain;
  chat_state: OpeningAgencyChatState;
  /** The latest chat request between the two, in any state. */
  latest_request?: HubChatRequest;
}

export interface ListOpeningAgenciesRequest {
  domain: OrgDomain;
  opening_number: OpeningNumber;
}

function validateOpening(domain: OrgDomain, number: OpeningNumber): string[] {
  const fields: string[] = [];
  if (!isOrgDomain(domain)) fields.push("domain");
  if (!Number.isInteger(number) || number < 1) fields.push("opening_number");
  return fields;
}

export function validateListOpeningAgenciesRequest(
  request: ListOpeningAgenciesRequest,
): string[] {
  return validateOpening(request.domain, request.opening_number);
}

export interface ListOpeningAgenciesResponse {
  /** At most 20, the cap on `sourcing` assignments per Opening. */
  items: OpeningAgency[];
}

/** Asks an agency assigned to a `published` Opening to open a conversation. */
export interface HubSendChatRequestRequest {
  domain: OrgDomain;
  opening_number: OpeningNumber;
  agency_domain: OrgDomain;
  note?: ChatRequestNote;
}

export function normalizeHubSendChatRequestRequest(
  request: HubSendChatRequestRequest,
): HubSendChatRequestRequest {
  return {
    ...request,
    domain: normalizeOrgDomain(request.domain),
    agency_domain: normalizeOrgDomain(request.agency_domain),
    ...(request.note !== undefined && {
      note: normalizeChatRequestNote(request.note),
    }),
  };
}

export function validateHubSendChatRequestRequest(
  request: HubSendChatRequestRequest,
): string[] {
  const fields = validateOpening(request.domain, request.opening_number);
  if (!isOrgDomain(request.agency_domain)) fields.push("agency_domain");
  if (request.note !== undefined && !isChatRequestNote(request.note))
    fields.push("note");
  return fields;
}

export interface ListHubChatRequestsRequest {
  direction: ChatRequestDirection;
  pagination_key?: PaginationKey;
  limit?: number;
}

export function validateListHubChatRequestsRequest(
  request: ListHubChatRequestsRequest,
): string[] {
  const fields: string[] = [];
  if (!chatRequestDirections.includes(request.direction))
    fields.push("direction");
  return [...fields, ...validatePage(request.pagination_key, request.limit)];
}

export interface ListHubChatRequestsResponse {
  /** Pending requests oldest first, then answered ones newest first. */
  items: HubChatRequest[];
  next_pagination_key?: PaginationKey;
}

export interface HubAcceptChatRequestRequest {
  agency_domain: OrgDomain;
  request_number: ChatRequestNumber;
}

export function validateHubAcceptChatRequestRequest(
  request: HubAcceptChatRequestRequest,
): string[] {
  const fields = validateAgencyDomain(request.agency_domain);
  if (!isChatRequestNumber(request.request_number))
    fields.push("request_number");
  return fields;
}

export interface HubDeclineChatRequestRequest {
  agency_domain: OrgDomain;
  request_number: ChatRequestNumber;
  scope: ChatRequestDeclineScope;
}

export function validateHubDeclineChatRequestRequest(
  request: HubDeclineChatRequestRequest,
): string[] {
  const fields = validateHubAcceptChatRequestRequest(request);
  if (!chatRequestDeclineScopes.includes(request.scope)) fields.push("scope");
  return fields;
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

/** Which of the Hub user's conversations a list holds. */
export const conversationFilters = [
  "all",
  "requests_received",
  "unread",
] as const;
export type ConversationFilter = (typeof conversationFilters)[number];

export function isConversationFilter(
  value: string | undefined,
): value is ConversationFilter {
  return (
    value !== undefined &&
    (conversationFilters as readonly string[]).includes(value)
  );
}

export interface ListConversationsRequest {
  pagination_key?: PaginationKey;
  limit?: number;
  filter?: ConversationFilter;
}

export function validateListConversationsRequest(
  request: ListConversationsRequest,
): string[] {
  const fields = validatePage(request.pagination_key, request.limit);
  if (request.filter !== undefined && !isConversationFilter(request.filter)) {
    fields.push("filter");
  }
  return fields;
}

export interface ListConversationsResponse {
  items: HubConversationSummary[];
  next_pagination_key?: PaginationKey;
}

/** The conversations waiting on the Hub user, each counted under the
 * filter of the same name. */
export interface AwaitingConversationCounts {
  requests_received: number;
  unread: number;
}

function validateAgencyDomain(domain: OrgDomain): string[] {
  return isOrgDomain(domain) ? [] : ["agency_domain"];
}

export interface GetConversationRequest {
  agency_domain: OrgDomain;
  pagination_key?: PaginationKey;
  limit?: number;
}

export function validateGetConversationRequest(
  request: GetConversationRequest,
): string[] {
  return [
    ...validateAgencyDomain(request.agency_domain),
    ...validatePage(request.pagination_key, request.limit),
  ];
}

export interface ReplyToConversationRequest {
  agency_domain: OrgDomain;
  text: MessageText;
}

export function validateReplyToConversationRequest(
  request: ReplyToConversationRequest,
): string[] {
  const fields = validateAgencyDomain(request.agency_domain);
  if (!isMessageText(request.text)) fields.push("text");
  return fields;
}

/** Deletes one of the Hub user's own text messages. */
export interface DeleteMessageRequest {
  agency_domain: OrgDomain;
  message_number: MessageNumber;
}

export function validateDeleteMessageRequest(
  request: DeleteMessageRequest,
): string[] {
  const fields = validateAgencyDomain(request.agency_domain);
  if (!isMessageNumber(request.message_number)) fields.push("message_number");
  return fields;
}

export interface MarkConversationReadRequest {
  agency_domain: OrgDomain;
}

export function validateMarkConversationReadRequest(
  request: MarkConversationReadRequest,
): string[] {
  return validateAgencyDomain(request.agency_domain);
}
