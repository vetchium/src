import { isCountryCode } from "../../common/countries.ts";
import { isLanguageTag } from "../../common/language_catalog.ts";
import type { PaginationKey } from "../../common/pagination.ts";
import { isPaginationKey } from "../../common/pagination.ts";
import type { TenantID } from "../../directory/directory.ts";
import type { CheckType } from "../hiring/vocabulary.ts";
import { isCheckType } from "../hiring/vocabulary.ts";
import type { OrgDomain } from "../types.ts";
import { isOrgDomain, normalizeOrgDomain } from "../types.ts";
import type { Capability } from "./capabilities.ts";
import { isCapability } from "./capabilities.ts";

export const maxHeadline = 200;
export const maxDescription = 10000;
export const maxServiceCountries = 250;
export const maxLanguages = 20;
export const maxIndicativePrice = 500;
export const maxConsentDisclosure = 5000;
export const maxCheckTypes = 20;
export const minSearchQuery = 2;
export const maxSearchQuery = 200;
/** Bounds one page of Listing search results. */
export const maxSearchPage = 50;

export type ListingVersion = number;

export const listingStateValues = ["draft", "listed", "unlisted"] as const;
export type ListingState = (typeof listingStateValues)[number];

export const DraftListing: ListingState = "draft";
export const ListedListing: ListingState = "listed";
export const UnlistedListing: ListingState = "unlisted";

const listingStates = new Set<string>(listingStateValues);

export function isListingState(value: unknown): value is ListingState {
  return typeof value === "string" && listingStates.has(value);
}

function validVersion(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 1;
}

function textLength(value: string): number {
  return Array.from(value).length;
}

/** Reports text PostgreSQL can hold: it refuses NUL. */
export function isStorableText(value: string): boolean {
  return !value.includes("\u0000");
}

/** Where a provider serves: worldwide, or a list of countries. */
export interface ServiceArea {
  worldwide: boolean;
  countries: string[];
}

function validUnique(
  values: readonly string[],
  limit: number,
  valid: (value: string) => boolean,
): boolean {
  return (
    values.length <= limit &&
    new Set(values).size === values.length &&
    values.every(valid)
  );
}

function validCheckTypes(values: readonly string[]): boolean {
  return (
    values.length >= 1 &&
    validUnique(values, maxCheckTypes, (value) => isCheckType(value))
  );
}

function validOptionalText(value: string | undefined, limit: number): boolean {
  if (value === undefined) return true;
  const length = textLength(value);
  return length >= 1 && length <= limit && isStorableText(value);
}

function trimOptional(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.trim();
}

/**
 * What a provider declares on a Listing. Only a `background_check` Listing
 * carries check types and a consent disclosure.
 */
export interface ListingContent {
  headline: string;
  description: string;
  service: ServiceArea;
  languages: string[];
  indicative_price?: string;
  check_types?: CheckType[];
  consent_disclosure?: string;
}

/** Returns a normalized copy that shares no storage with the input. */
export function normalizeListingContent(
  content: ListingContent,
): ListingContent {
  const normalized: ListingContent = {
    headline: content.headline.trim(),
    description: content.description.trim(),
    service: {
      worldwide: content.service.worldwide,
      countries: content.service.countries.map((country) =>
        country.trim().toUpperCase(),
      ),
    },
    languages: content.languages.map((language) => language.trim()),
  };
  const price = trimOptional(content.indicative_price);
  if (price !== undefined) normalized.indicative_price = price;
  if (content.check_types !== undefined)
    normalized.check_types = [...content.check_types];
  const disclosure = trimOptional(content.consent_disclosure);
  if (disclosure !== undefined) normalized.consent_disclosure = disclosure;
  return normalized;
}

/** Reports invalid fields of a Listing of the given Capability. */
export function validateListingContent(
  content: ListingContent,
  capability: Capability,
): string[] {
  const fields: string[] = [];
  const headline = textLength(content.headline);
  if (
    headline < 1 ||
    headline > maxHeadline ||
    !isStorableText(content.headline)
  )
    fields.push("headline");
  const description = textLength(content.description);
  if (
    description < 1 ||
    description > maxDescription ||
    !isStorableText(content.description)
  )
    fields.push("description");
  if (content.service.worldwide) {
    if (content.service.countries.length !== 0)
      fields.push("service.countries");
  } else if (
    content.service.countries.length < 1 ||
    !validUnique(content.service.countries, maxServiceCountries, isCountryCode)
  ) {
    fields.push("service.countries");
  }
  if (!validUnique(content.languages, maxLanguages, isLanguageTag))
    fields.push("languages");
  if (!validOptionalText(content.indicative_price, maxIndicativePrice))
    fields.push("indicative_price");
  if (capability === "background_check") {
    if (
      content.check_types === undefined ||
      !validCheckTypes(content.check_types)
    )
      fields.push("check_types");
    if (
      content.consent_disclosure === undefined ||
      !validOptionalText(content.consent_disclosure, maxConsentDisclosure)
    )
      fields.push("consent_disclosure");
    return fields;
  }
  if (content.check_types !== undefined) fields.push("check_types");
  if (content.consent_disclosure !== undefined)
    fields.push("consent_disclosure");
  return fields;
}

/** An Org's own Listing. */
export interface Listing extends ListingContent {
  capability: Capability;
  state: ListingState;
  version: ListingVersion;
  created_at: string;
  updated_at: string;
}

export type ListListingsRequest = Record<string, never>;

export function validateListListingsRequest(
  _request: ListListingsRequest,
): string[] {
  return [];
}

/** At most one Listing per Capability, so the list is never paginated. */
export interface ListListingsResponse {
  listings: Listing[];
}

export interface CreateListingRequest extends ListingContent {
  capability: Capability;
}

export function normalizeCreateListingRequest(
  request: CreateListingRequest,
): CreateListingRequest {
  return {
    ...normalizeListingContent(request),
    capability: request.capability,
  };
}

export function validateCreateListingRequest(
  request: CreateListingRequest,
): string[] {
  if (!isCapability(request.capability)) return ["capability"];
  return validateListingContent(request, request.capability);
}

/** Replaces the whole content of the Listing. */
export interface UpdateListingRequest extends ListingContent {
  capability: Capability;
  version: ListingVersion;
}

export function normalizeUpdateListingRequest(
  request: UpdateListingRequest,
): UpdateListingRequest {
  return {
    ...normalizeListingContent(request),
    capability: request.capability,
    version: request.version,
  };
}

export function validateUpdateListingRequest(
  request: UpdateListingRequest,
): string[] {
  const fields: string[] = [];
  if (!validVersion(request.version)) fields.push("version");
  if (!isCapability(request.capability)) return [...fields, "capability"];
  return [...fields, ...validateListingContent(request, request.capability)];
}

/** Names the Listing an action applies to and the version the caller read. */
export interface ListingTarget {
  capability: Capability;
  version: ListingVersion;
}

export function validateListingTarget(request: ListingTarget): string[] {
  const fields: string[] = [];
  if (!isCapability(request.capability)) fields.push("capability");
  if (!validVersion(request.version)) fields.push("version");
  return fields;
}

/** The provider as search and Listing detail show it. */
export interface ListingProvider {
  domain: OrgDomain;
  display_name: string;
  logo_url?: string;
  country: string;
}

export interface ListingSummary {
  provider: ListingProvider;
  capability: Capability;
  headline: string;
  service: ServiceArea;
  languages: string[];
  indicative_price?: string;
  check_types?: CheckType[];
}

export interface ListingDetail extends ListingSummary {
  description: string;
  consent_disclosure?: string;
}

export interface SearchListingsRequest {
  capability: Capability;
  country?: string;
  language?: string;
  /** Only for `background_check`: Listings that perform all of them. */
  check_types?: CheckType[];
  query?: string;
  pagination_key?: PaginationKey;
  /** Defaults to 50. */
  limit?: number;
}

export function normalizeSearchListingsRequest(
  request: SearchListingsRequest,
): SearchListingsRequest {
  const normalized: SearchListingsRequest = { ...request };
  if (request.country !== undefined)
    normalized.country = request.country.trim().toUpperCase();
  if (request.language !== undefined)
    normalized.language = request.language.trim();
  if (request.query !== undefined) normalized.query = request.query.trim();
  if (request.check_types !== undefined)
    normalized.check_types = [...request.check_types];
  return normalized;
}

export function validateSearchListingsRequest(
  request: SearchListingsRequest,
): string[] {
  const fields: string[] = [];
  if (!isCapability(request.capability)) fields.push("capability");
  if (request.country !== undefined && !isCountryCode(request.country))
    fields.push("country");
  if (request.language !== undefined && !isLanguageTag(request.language))
    fields.push("language");
  if (
    request.check_types !== undefined &&
    (request.capability !== "background_check" ||
      !validCheckTypes(request.check_types))
  )
    fields.push("check_types");
  if (request.query !== undefined) {
    const length = textLength(request.query);
    if (
      length < minSearchQuery ||
      length > maxSearchQuery ||
      !isStorableText(request.query)
    )
      fields.push("query");
  }
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  )
    fields.push("pagination_key");
  if (
    request.limit !== undefined &&
    (!Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > maxSearchPage)
  )
    fields.push("limit");
  return fields;
}

export interface SearchListingsResponse {
  listings: ListingSummary[];
  /** Tenants that did not answer, so the results are incomplete. */
  unavailable_tenants: TenantID[];
  next_pagination_key?: PaginationKey;
}

export interface GetListingRequest {
  domain: OrgDomain;
  capability: Capability;
}

export function normalizeGetListingRequest(
  request: GetListingRequest,
): GetListingRequest {
  return {
    domain: normalizeOrgDomain(request.domain),
    capability: request.capability,
  };
}

export function validateGetListingRequest(
  request: GetListingRequest,
): string[] {
  const fields: string[] = [];
  if (!isOrgDomain(request.domain)) fields.push("domain");
  if (!isCapability(request.capability)) fields.push("capability");
  return fields;
}
