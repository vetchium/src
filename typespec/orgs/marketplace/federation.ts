import type { TenantID } from "../../directory/directory.ts";
import { isTenantID } from "../../directory/directory.ts";
import type { CheckType } from "../hiring/vocabulary.ts";
import type { OrgDomain } from "../types.ts";
import { isOrgDomain, normalizeOrgDomain } from "../types.ts";
import type { Capability } from "./capabilities.ts";
import type {
  GetListingRequest,
  ListingSummary,
  SearchListingsRequest,
} from "./listings.ts";
import {
  isStorableText,
  maxSearchPage,
  normalizeGetListingRequest,
  normalizeSearchListingsRequest,
  validateGetListingRequest,
  validateSearchListingsRequest,
} from "./listings.ts";

const maxSortName = 400;

/**
 * Where the next page of a merged search resumes: after this provider name,
 * case-folded by the tenant that holds it, then this domain.
 */
export interface ListingSearchPosition {
  sort_name: string;
  domain: OrgDomain;
}

/**
 * One tenant's share of a Listing search. No caller identity crosses the mesh.
 */
export interface PeerSearchListingsRequest {
  capability: Capability;
  country?: string;
  language?: string;
  check_types?: CheckType[];
  query?: string;
  after?: ListingSearchPosition;
  limit: number;
}

function filters(request: PeerSearchListingsRequest): SearchListingsRequest {
  const search: SearchListingsRequest = { capability: request.capability };
  if (request.country !== undefined) search.country = request.country;
  if (request.language !== undefined) search.language = request.language;
  if (request.check_types !== undefined)
    search.check_types = request.check_types;
  if (request.query !== undefined) search.query = request.query;
  return search;
}

export function normalizePeerSearchListingsRequest(
  request: PeerSearchListingsRequest,
): PeerSearchListingsRequest {
  const normalized: PeerSearchListingsRequest = {
    ...normalizeSearchListingsRequest(filters(request)),
    limit: request.limit,
  };
  if (request.after !== undefined)
    normalized.after = {
      sort_name: request.after.sort_name,
      domain: normalizeOrgDomain(request.after.domain),
    };
  return normalized;
}

export function validatePeerSearchListingsRequest(
  request: PeerSearchListingsRequest,
): string[] {
  const fields = validateSearchListingsRequest(filters(request));
  if (request.after !== undefined) {
    const length = Array.from(request.after.sort_name).length;
    if (
      length < 1 ||
      length > maxSortName ||
      !isStorableText(request.after.sort_name)
    )
      fields.push("after.sort_name");
    if (!isOrgDomain(request.after.domain)) fields.push("after.domain");
  }
  if (
    !Number.isInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > maxSearchPage
  )
    fields.push("limit");
  return fields;
}

/** A Listing with the case-folded provider name the tenant ordered it by. */
export interface PeerListingSummary {
  sort_name: string;
  listing: ListingSummary;
}

export interface PeerSearchListingsResponse {
  listings: PeerListingSummary[];
  /** Whether the tenant holds more matches after the last one returned. */
  has_more: boolean;
}

/** Asks the local relay to search `tenant`, which may be this tenant. */
export interface RelaySearchListingsRequest {
  tenant: TenantID;
  search: PeerSearchListingsRequest;
}

export function normalizeRelaySearchListingsRequest(
  request: RelaySearchListingsRequest,
): RelaySearchListingsRequest {
  return {
    tenant: request.tenant,
    search: normalizePeerSearchListingsRequest(request.search),
  };
}

export function validateRelaySearchListingsRequest(
  request: RelaySearchListingsRequest,
): string[] {
  const fields: string[] = [];
  if (!isTenantID(request.tenant)) fields.push("tenant");
  for (const field of validatePeerSearchListingsRequest(request.search))
    fields.push(`search.${field}`);
  return fields;
}

export interface RelayGetListingRequest {
  tenant: TenantID;
  listing: GetListingRequest;
}

export function normalizeRelayGetListingRequest(
  request: RelayGetListingRequest,
): RelayGetListingRequest {
  return {
    tenant: request.tenant,
    listing: normalizeGetListingRequest(request.listing),
  };
}

export function validateRelayGetListingRequest(
  request: RelayGetListingRequest,
): string[] {
  const fields: string[] = [];
  if (!isTenantID(request.tenant)) fields.push("tenant");
  for (const field of validateGetListingRequest(request.listing))
    fields.push(`listing.${field}`);
  return fields;
}
