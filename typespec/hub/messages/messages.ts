import type { PaginationKey } from "../../common/pagination.ts";
import { isPaginationKey } from "../../common/pagination.ts";
import type {
  ContactID,
  ConversationMessage,
  ConversationReadOnlyReason,
  MessageText,
} from "../../orgs/marketplace/contacts/contacts.ts";
import {
  isContactID,
  isMessageText,
} from "../../orgs/marketplace/contacts/contacts.ts";
import type { OpeningNumber } from "../../orgs/openings/types.ts";
import type { OrgDID, OrgDomain } from "../../orgs/types.ts";

export const maxPage = 100;

export interface HubOpeningSuggestion {
  consumer_domain: OrgDomain;
  opening_number: OpeningNumber;
  sent_at: string;
}

export interface HubConversationSummary {
  contact_id: ContactID;
  agency_org_did: OrgDID;
  agency_display_name: string;
  agency_domain: OrgDomain;
  agency_logo_url?: string;
  has_conversation: boolean;
  unread: boolean;
  unread_count: number;
  read_only_reason?: ConversationReadOnlyReason;
  suggestions: HubOpeningSuggestion[];
  last_activity_at: string;
}

export interface HubConversationDetail {
  conversation: HubConversationSummary;
  messages: ConversationMessage[];
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

export interface ListConversationsRequest {
  pagination_key?: PaginationKey;
  limit?: number;
}

export function validateListConversationsRequest(
  request: ListConversationsRequest,
): string[] {
  return validatePage(request.pagination_key, request.limit);
}

export interface ListConversationsResponse {
  items: HubConversationSummary[];
  next_pagination_key?: PaginationKey;
}

export interface GetConversationRequest {
  contact_id: ContactID;
}

export function validateGetConversationRequest(
  request: GetConversationRequest,
): string[] {
  return isContactID(request.contact_id) ? [] : ["contact_id"];
}

export interface ReplyToConversationRequest {
  contact_id: ContactID;
  text: MessageText;
}

export function validateReplyToConversationRequest(
  request: ReplyToConversationRequest,
): string[] {
  const fields: string[] = [];
  if (!isContactID(request.contact_id)) fields.push("contact_id");
  if (!isMessageText(request.text)) fields.push("text");
  return fields;
}

export interface DeleteConversationRequest {
  contact_id: ContactID;
}

export function validateDeleteConversationRequest(
  request: DeleteConversationRequest,
): string[] {
  return isContactID(request.contact_id) ? [] : ["contact_id"];
}

export interface MarkConversationReadRequest {
  contact_id: ContactID;
}

export function validateMarkConversationReadRequest(
  request: MarkConversationReadRequest,
): string[] {
  return isContactID(request.contact_id) ? [] : ["contact_id"];
}
