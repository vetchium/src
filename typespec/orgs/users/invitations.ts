import type { NewPassword, OpaqueToken } from "../../common/authentication.ts";
import { isNewPassword, isOpaqueToken } from "../../common/authentication.ts";
import type { EmailAddress } from "../../common/common.ts";
import { isEmailAddress, normalizeEmailAddress } from "../../common/common.ts";
import type { PageSize, PaginationKey } from "../../common/pagination.ts";
import { isPageSize, isPaginationKey } from "../../common/pagination.ts";
import {
  type OrgPermissionID,
  validatePermissions,
} from "../authorization/types.ts";
import {
  type FrontendLocale,
  isFrontendLocale,
  type OrgDomain,
} from "../types.ts";

/** Bounds every request that targets several addresses or users. */
export const maxBulk = 100;

export type OrgInvitationToken = OpaqueToken;
export type InviteeAddress = string;
export type InvitationFilterText = string;

export const inviteOutcomeValues = [
  "invited",
  "already-member",
  "already-invited",
  "domain-mismatch",
  "invalid",
] as const;

export type InviteOutcome = (typeof inviteOutcomeValues)[number];

function isDistinctBulk<T>(
  values: readonly T[],
  valid: (value: T) => boolean,
): boolean {
  return (
    values.length >= 1 &&
    values.length <= maxBulk &&
    values.every(valid) &&
    new Set(values).size === values.length
  );
}

function isInviteeAddress(value: InviteeAddress): boolean {
  const length = [...value].length;
  return length >= 1 && length <= 320;
}

export interface InviteUsersRequest {
  email_addresses: InviteeAddress[];
  permissions?: OrgPermissionID[];
}

export function normalizeInviteUsersRequest(
  request: InviteUsersRequest,
): InviteUsersRequest {
  return {
    ...request,
    email_addresses: request.email_addresses.map(normalizeEmailAddress),
  };
}

export function validateInviteUsersRequest(
  request: InviteUsersRequest,
): string[] {
  const normalized = normalizeInviteUsersRequest(request);
  const fields: string[] = [];
  if (!isDistinctBulk(normalized.email_addresses, isInviteeAddress)) {
    fields.push("email_addresses");
  }
  if (
    request.permissions !== undefined &&
    !validatePermissions(request.permissions)
  ) {
    fields.push("permissions");
  }
  return fields;
}

export interface InviteResult {
  email_address: string;
  outcome: InviteOutcome;
  expires_at?: string;
}

export interface InviteUsersResponse {
  results: InviteResult[];
}

export interface ListInvitationsRequest {
  limit?: PageSize;
  pagination_key?: PaginationKey;
  filter_search?: InvitationFilterText;
}

/**
 * At least two characters, so one letter never scans a whole Org's
 * invitations.
 */
export function isInvitationFilterText(value: InvitationFilterText): boolean {
  const length = [...value].length;
  return length >= 2 && length <= 320;
}

export function validateListInvitationsRequest(
  request: ListInvitationsRequest,
): string[] {
  const fields: string[] = [];
  if (request.limit !== undefined && !isPageSize(request.limit)) {
    fields.push("limit");
  }
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  ) {
    fields.push("pagination_key");
  }
  if (
    request.filter_search !== undefined &&
    !isInvitationFilterText(request.filter_search)
  ) {
    fields.push("filter_search");
  }
  return fields;
}

export interface InvitationSummary {
  email_address: EmailAddress;
  permissions: OrgPermissionID[];
  invited_by: EmailAddress;
  created_at: string;
  expires_at: string;
}

export interface ListInvitationsResponse {
  invitations: InvitationSummary[];
  next_pagination_key?: PaginationKey;
}

export interface ResendInvitationRequest {
  email_address: EmailAddress;
}

export function normalizeResendInvitationRequest(
  request: ResendInvitationRequest,
): ResendInvitationRequest {
  return {
    ...request,
    email_address: normalizeEmailAddress(request.email_address),
  };
}

export function validateResendInvitationRequest(
  request: ResendInvitationRequest,
): string[] {
  return isEmailAddress(normalizeResendInvitationRequest(request).email_address)
    ? []
    : ["email_address"];
}

export interface ResendInvitationResponse {
  expires_at: string;
}

export interface CancelInvitationsRequest {
  email_addresses: EmailAddress[];
}

export function normalizeCancelInvitationsRequest(
  request: CancelInvitationsRequest,
): CancelInvitationsRequest {
  return {
    ...request,
    email_addresses: request.email_addresses.map(normalizeEmailAddress),
  };
}

export function validateCancelInvitationsRequest(
  request: CancelInvitationsRequest,
): string[] {
  const normalized = normalizeCancelInvitationsRequest(request);
  return isDistinctBulk(normalized.email_addresses, isEmailAddress)
    ? []
    : ["email_addresses"];
}

export interface GetInvitationDetailsRequest {
  invitation_token: OrgInvitationToken;
}

export function validateGetInvitationDetailsRequest(
  request: GetInvitationDetailsRequest,
): string[] {
  return isOpaqueToken(request.invitation_token) ? [] : ["invitation_token"];
}

export interface InvitationDetailsResponse {
  domain: OrgDomain;
  email_address: EmailAddress;
  expires_at: string;
}

export interface AcceptInvitationRequest {
  invitation_token: OrgInvitationToken;
  password: NewPassword;
  preferred_language: FrontendLocale;
}

export function validateAcceptInvitationRequest(
  request: AcceptInvitationRequest,
): string[] {
  const fields: string[] = [];
  if (!isOpaqueToken(request.invitation_token)) {
    fields.push("invitation_token");
  }
  if (!isNewPassword(request.password)) {
    fields.push("password");
  }
  if (!isFrontendLocale(request.preferred_language)) {
    fields.push("preferred_language");
  }
  return fields;
}

export interface AcceptInvitationResponse {
  domain: OrgDomain;
  email_address: EmailAddress;
}
