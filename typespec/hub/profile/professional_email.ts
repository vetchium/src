import type { EmailAddress } from "../../common/common.ts";
import { isEmailAddress, normalizeEmailAddress } from "../../common/common.ts";
import type { ProfessionalDomain } from "../../common/domain.ts";
import { isProfessionalDomain } from "../../common/domain.ts";
import type { PaginationKey } from "../../common/pagination.ts";
import { isPaginationKey } from "../../common/pagination.ts";
import type { ProfileEntryID } from "./public.ts";
import { isProfileEntryID } from "./public.ts";

export interface ProfessionalEmail {
  id: ProfileEntryID;
  email_address: EmailAddress;
  domain: ProfessionalDomain;
  first_verified_at?: string;
  last_verified_at?: string;
  // Set when a newer proof elsewhere claimed this address (GU-PEM-004):
  // verification "moved to another account" without naming who holds it
  // now. A verified address is last_verified_at set AND superseded_at
  // unset; never treat last_verified_at alone as verified.
  superseded_at?: string;
  created_at: string;
}

export type ProfessionalEmailPageSize = number;

export function isProfessionalEmailPageSize(
  value: ProfessionalEmailPageSize,
): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 10;
}

export interface ListProfessionalEmailsRequest {
  limit?: ProfessionalEmailPageSize;
  pagination_key?: PaginationKey;
}

export function effectiveProfessionalEmailLimit(
  request: ListProfessionalEmailsRequest,
): ProfessionalEmailPageSize {
  return request.limit ?? 10;
}

export function validateListProfessionalEmailsRequest(
  request: ListProfessionalEmailsRequest,
): string[] {
  const fields: string[] = [];
  if (!isProfessionalEmailPageSize(effectiveProfessionalEmailLimit(request))) {
    fields.push("limit");
  }
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  ) {
    fields.push("pagination_key");
  }
  return fields;
}

export interface ListProfessionalEmailsResponse {
  emails: ProfessionalEmail[];
  next_pagination_key?: PaginationKey;
}

export interface AddProfessionalEmailRequest {
  email_address: EmailAddress;
}

export function normalizeAddProfessionalEmailRequest(
  request: AddProfessionalEmailRequest,
): AddProfessionalEmailRequest {
  return {
    ...request,
    email_address: normalizeEmailAddress(request.email_address),
  };
}

export function validateAddProfessionalEmailRequest(
  request: AddProfessionalEmailRequest,
): string[] {
  if (!isEmailAddress(request.email_address)) return ["email_address"];
  const domain = request.email_address.split("@")[1] ?? "";
  return isProfessionalDomain(domain) ? [] : ["email_address"];
}

export interface ProfessionalEmailIDRequest {
  id: ProfileEntryID;
}

export function validateProfessionalEmailIDRequest(
  request: ProfessionalEmailIDRequest,
): string[] {
  return isProfileEntryID(request.id) ? [] : ["id"];
}

export interface ProfessionalEmailChallenge {
  challenge_id: ProfileEntryID;
  expires_at: string;
}

export interface VerifyProfessionalEmailRequest {
  id: ProfileEntryID;
  challenge_id: ProfileEntryID;
  code: string;
}

export function validateVerifyProfessionalEmailRequest(
  request: VerifyProfessionalEmailRequest,
): string[] {
  const fields: string[] = [];
  if (!isProfileEntryID(request.id)) fields.push("id");
  if (!isProfileEntryID(request.challenge_id)) fields.push("challenge_id");
  if (!/^[0-9]{6}$/.test(request.code)) fields.push("code");
  return fields;
}
