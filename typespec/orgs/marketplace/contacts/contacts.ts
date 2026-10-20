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

/** Bounds the notes on one Contact. */
export const maxNotesPerContact = 200;
/** Bounds the Contacts an agency creates per UTC day. */
export const maxNewContactsPerDay = 200;
/** Bounds a note in code points. */
export const maxNoteLength = 5000;
/** Bounds one page of Contacts or notes. */
export const maxPage = 100;

/** Names one Contact of an agency; never reused. */
export type ContactID = string;
export type ContactNoteID = string;
export type NoteText = string;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Accepts the lowercase form the API returns. */
export function isContactID(value: string): boolean {
  return uuidPattern.test(value);
}

export function isContactNoteID(value: string): boolean {
  return uuidPattern.test(value);
}

/** Plain text of 1–5,000 code points once trimmed. */
export function isNoteText(value: string): boolean {
  const length = Array.from(value.trim()).length;
  return length >= 1 && length <= maxNoteLength;
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
  note_count: number;
  last_activity_at: string;
}

export interface Contact extends ContactSummary {
  created_by: EmailAddress;
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

export interface ListContactsRequest {
  pagination_key?: PaginationKey;
  /** Defaults to 50. */
  limit?: number;
}

export function validateListContactsRequest(
  request: ListContactsRequest,
): string[] {
  return validatePage(request.pagination_key, request.limit);
}

export interface ListContactsResponse {
  items: ContactSummary[];
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
