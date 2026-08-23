import type { PageSize, PaginationKey } from "../../common/pagination.ts";
import { isPageSize, isPaginationKey } from "../../common/pagination.ts";
import type { HubSignupDomainID } from "../types.ts";
import { isHubSignupDomainID } from "../types.ts";

export type DomainName = string;
export type State = "active" | "disabled";
export type DomainFilterText = string;
export type DisableComment = string;

export const Active: State = "active";
export const Disabled: State = "disabled";

export interface Domain {
  hub_signup_domain_id: HubSignupDomainID;
  domain: DomainName;
  state: State;
  disabled_comment?: DisableComment;
  created_at: string;
  updated_at: string;
}

export interface ListRequest {
  limit?: PageSize;
  pagination_key?: PaginationKey;
  filter_search?: DomainFilterText;
  filter_state?: State;
}

export function normalizeListRequest(request: ListRequest): ListRequest {
  if (request.filter_search === undefined) return { ...request };
  return {
    ...request,
    filter_search: request.filter_search.trim().toLowerCase(),
  };
}

export function effectiveListLimit(request: ListRequest): PageSize {
  return request.limit ?? 50;
}

export function validateListRequest(request: ListRequest): string[] {
  const fields: string[] = [];
  if (!isPageSize(effectiveListLimit(request))) fields.push("limit");
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  ) {
    fields.push("pagination_key");
  }
  if (
    request.filter_search !== undefined &&
    !isDomainFilterText(request.filter_search)
  ) {
    fields.push("filter_search");
  }
  if (request.filter_state !== undefined && !isState(request.filter_state)) {
    fields.push("filter_state");
  }
  return fields;
}

export interface ListResponse {
  domains: Domain[];
  next_pagination_key?: PaginationKey;
}

export interface CreateRequest {
  domain: DomainName;
  state?: State;
  disabled_comment?: DisableComment;
}

export function normalizeCreateRequest(request: CreateRequest): CreateRequest {
  if (request.disabled_comment === undefined) {
    return { ...request, domain: normalizeDomainName(request.domain) };
  }
  return {
    ...request,
    domain: normalizeDomainName(request.domain),
    disabled_comment: normalizeDisableComment(request.disabled_comment),
  };
}

export function effectiveCreateState(request: CreateRequest): State {
  return request.state ?? Active;
}

export function validateCreateRequest(request: CreateRequest): string[] {
  const fields: string[] = [];
  if (!isDomainName(request.domain)) fields.push("domain");
  if (!isState(effectiveCreateState(request))) fields.push("state");
  if (
    !isDisableCommentForState(
      effectiveCreateState(request),
      request.disabled_comment,
    )
  ) {
    fields.push("disabled_comment");
  }
  return fields;
}

export interface UpdateRequest {
  hub_signup_domain_id: HubSignupDomainID;
  domain: DomainName;
  state: State;
  disabled_comment?: DisableComment;
}

export function normalizeUpdateRequest(request: UpdateRequest): UpdateRequest {
  if (request.disabled_comment === undefined) {
    return { ...request, domain: normalizeDomainName(request.domain) };
  }
  return {
    ...request,
    domain: normalizeDomainName(request.domain),
    disabled_comment: normalizeDisableComment(request.disabled_comment),
  };
}

export function validateUpdateRequest(request: UpdateRequest): string[] {
  const fields: string[] = [];
  if (!isHubSignupDomainID(request.hub_signup_domain_id)) {
    fields.push("hub_signup_domain_id");
  }
  if (!isDomainName(request.domain)) fields.push("domain");
  if (!isState(request.state)) fields.push("state");
  if (!isDisableCommentForState(request.state, request.disabled_comment)) {
    fields.push("disabled_comment");
  }
  return fields;
}

export function normalizeDomainName(value: DomainName): DomainName {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function isDomainName(value: DomainName): boolean {
  const normalized = normalizeDomainName(value);
  if (
    normalized.length < 3 ||
    normalized.length > 253 ||
    !normalized.includes(".") ||
    /^[0-9.]+$/.test(normalized) ||
    !/[a-z]/.test(normalized.split(".").at(-1) ?? "")
  ) {
    return false;
  }
  return normalized
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function isState(value: State): boolean {
  return value === Active || value === Disabled;
}

export function isDisableComment(value: DisableComment): boolean {
  const length = [...value.trim()].length;
  return length >= 1 && length <= 500;
}

function normalizeDisableComment(value: DisableComment): DisableComment {
  return value.trim();
}

function isDisableCommentForState(
  state: State,
  comment: DisableComment | undefined,
): boolean {
  return state === Disabled
    ? comment !== undefined && isDisableComment(comment)
    : comment === undefined;
}

function isDomainFilterText(value: DomainFilterText): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length >= 1 &&
    normalized.length <= 253 &&
    /^[a-z0-9.-]+$/.test(normalized)
  );
}
