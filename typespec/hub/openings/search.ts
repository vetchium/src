import { isCountryCode } from "../../common/countries.ts";
import type { CountryCode } from "../../common/localization.ts";
import {
  isOpeningTagOID,
  type OpeningTagOID,
} from "../../common/opening_tags.ts";
import type {
  OpeningEducation,
  OpeningEmploymentType,
  OpeningWorkArrangement,
} from "../../common/openings.ts";
import {
  isPaginationKey,
  type PaginationKey,
} from "../../common/pagination.ts";
import { isTenantID, type TenantID } from "../../directory/directory.ts";
import {
  isOrgDomain,
  normalizeOrgDomain,
  type OrgDomain,
} from "../../orgs/types.ts";
import { type IdealJob, maxIdealJobCodePoints } from "../types.ts";
import type { PublicOpeningSummary, PublicOrg } from "./public.ts";

export type OpeningSearchKeyword = string;
export type OrgSuggestionQuery = string;
export type OpeningSearchPageSize = number;
export type OpeningSearchExperienceYears = number;
export type OpeningSearchPostedWithinDays = 1 | 7 | 30;

export const DefaultOpeningSearchLimit = 20;
export const MaxOpeningSearchLimit = 50;
export const MaxOpeningOrgSuggestions = 10;
export const OpeningSearchPostedWithinDaysValues: readonly OpeningSearchPostedWithinDays[] =
  [1, 7, 30];

/** `ideal_job_match` ranks by the caller's saved ideal job (OPN-SRCH-013). */
export type OpeningSearchSort = "newest" | "ideal_job_match";

export const SortNewest: OpeningSearchSort = "newest";
export const SortIdealJobMatch: OpeningSearchSort = "ideal_job_match";
export const OpeningSearchSorts: readonly OpeningSearchSort[] = [
  SortNewest,
  SortIdealJobMatch,
];

/** The filters of one search (OPN-SRCH-004). */
export interface OpeningSearchFilters {
  keyword?: OpeningSearchKeyword;
  org_domain?: OrgDomain;
  tag_oids?: OpeningTagOID[];
  work_countries?: CountryCode[];
  work_arrangements?: OpeningWorkArrangement[];
  employment_types?: OpeningEmploymentType[];
  posted_within_days?: OpeningSearchPostedWithinDays;
  experience_years?: OpeningSearchExperienceYears;
  education_level?: OpeningEducation;
  salary_disclosed?: boolean;
  pagination_key?: PaginationKey;
  limit?: OpeningSearchPageSize;
}

/**
 * One search as the answering tenant runs it: the relay and peer body. It
 * names no viewer (OPN-SRCH-002).
 */
export interface OpeningSearchQuery extends OpeningSearchFilters {
  sort?: OpeningSearchSort;
  /**
   * Present exactly under `ideal_job_match`; used only to match and rank,
   * never logged, stored, or audited (OPN-SRCH-014).
   */
  ideal_job_text?: IdealJob;
}

/** The browser never sends ideal-job text; hub-api reads it (OPN-SRCH-013). */
export interface SearchOpeningsRequest extends OpeningSearchFilters {
  sort?: OpeningSearchSort;
  region?: TenantID;
}

export interface OpeningSearchResult {
  org: PublicOrg;
  opening: PublicOpeningSummary;
}

export interface SearchOpeningsResponse {
  openings: OpeningSearchResult[];
  next_pagination_key?: PaginationKey;
}

export interface SuggestOpeningOrgsQuery {
  query: OrgSuggestionQuery;
}

export interface SuggestOpeningOrgsRequest extends SuggestOpeningOrgsQuery {
  region?: TenantID;
}

export interface SuggestOpeningOrgsResponse {
  orgs: PublicOrg[];
}

/** No viewer identity crosses the mesh. */
export interface RelaySearchOpeningsRequest {
  tenant_id: TenantID;
  query: OpeningSearchQuery;
}

/** No viewer identity crosses the mesh. */
export interface RelaySuggestOpeningOrgsRequest {
  tenant_id: TenantID;
  query: SuggestOpeningOrgsQuery;
}

export type PeerSearchOpeningsRequest = OpeningSearchQuery;
export type PeerSuggestOpeningOrgsRequest = SuggestOpeningOrgsQuery;

const workArrangements: readonly string[] = ["on_site", "hybrid", "remote"];
const employmentTypes: readonly string[] = [
  "full_time",
  "part_time",
  "contract",
  "internship",
];
const educationLevels: readonly string[] = [
  "secondary",
  "bachelor",
  "master",
  "doctorate",
];

function codePoints(value: string): number {
  return [...value].length;
}

/**
 * A present list outside 1..max is `field`; a malformed or repeated item is
 * `field.<index>`.
 */
function validateList<T>(
  field: string,
  items: readonly T[] | undefined,
  max: number,
  valid: (item: T) => boolean,
): string[] {
  if (items === undefined) return [];
  const fields: string[] = [];
  if (items.length < 1 || items.length > max) fields.push(field);
  const seen = new Set<T>();
  items.forEach((item, index) => {
    if (!valid(item) || seen.has(item)) fields.push(`${field}.${index}`);
    seen.add(item);
  });
  return fields;
}

function normalizeOpeningSearchFilters<T extends OpeningSearchFilters>(
  request: T,
): T {
  return {
    ...request,
    ...(request.keyword !== undefined && { keyword: request.keyword.trim() }),
    ...(request.org_domain !== undefined && {
      org_domain: normalizeOrgDomain(request.org_domain),
    }),
    ...(request.work_countries !== undefined && {
      work_countries: request.work_countries.map((country) =>
        country.trim().toUpperCase(),
      ),
    }),
  };
}

function validateOpeningSearchFilters(request: OpeningSearchFilters): string[] {
  const fields: string[] = [];
  if (
    request.keyword !== undefined &&
    (codePoints(request.keyword) < 2 || codePoints(request.keyword) > 200)
  )
    fields.push("keyword");
  if (request.org_domain !== undefined && !isOrgDomain(request.org_domain))
    fields.push("org_domain");
  fields.push(
    ...validateList("tag_oids", request.tag_oids, 5, isOpeningTagOID),
    ...validateList("work_countries", request.work_countries, 10, (country) =>
      isCountryCode(country),
    ),
    ...validateList(
      "work_arrangements",
      request.work_arrangements,
      3,
      (value) => workArrangements.includes(value),
    ),
    ...validateList("employment_types", request.employment_types, 4, (value) =>
      employmentTypes.includes(value),
    ),
  );
  if (
    request.posted_within_days !== undefined &&
    !OpeningSearchPostedWithinDaysValues.includes(request.posted_within_days)
  )
    fields.push("posted_within_days");
  if (
    request.experience_years !== undefined &&
    (!Number.isInteger(request.experience_years) ||
      request.experience_years < 0 ||
      request.experience_years > 50)
  )
    fields.push("experience_years");
  if (
    request.education_level !== undefined &&
    !educationLevels.includes(request.education_level)
  )
    fields.push("education_level");
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  )
    fields.push("pagination_key");
  const limit = request.limit ?? DefaultOpeningSearchLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MaxOpeningSearchLimit)
    fields.push("limit");
  return fields;
}

function isOpeningSearchSort(value: string): value is OpeningSearchSort {
  return (OpeningSearchSorts as readonly string[]).includes(value);
}

export function normalizeOpeningSearchQuery(
  query: OpeningSearchQuery,
): OpeningSearchQuery {
  return {
    ...normalizeOpeningSearchFilters(query),
    ...(query.ideal_job_text !== undefined && {
      ideal_job_text: query.ideal_job_text.trim(),
    }),
  };
}

export function validateOpeningSearchQuery(
  query: OpeningSearchQuery,
): string[] {
  const fields = validateOpeningSearchFilters(query);
  if (query.sort !== undefined && !isOpeningSearchSort(query.sort))
    fields.push("sort");
  const text = query.ideal_job_text;
  if ((query.sort ?? SortNewest) === SortIdealJobMatch) {
    if (
      text === undefined ||
      text === "" ||
      codePoints(text) > maxIdealJobCodePoints
    )
      fields.push("ideal_job_text");
  } else if (text !== undefined) fields.push("ideal_job_text");
  return fields;
}

export function normalizeSearchOpeningsRequest(
  request: SearchOpeningsRequest,
): SearchOpeningsRequest {
  return normalizeOpeningSearchFilters(request);
}

export function validateSearchOpeningsRequest(
  request: SearchOpeningsRequest,
): string[] {
  const fields = validateOpeningSearchFilters(request);
  if (request.sort !== undefined && !isOpeningSearchSort(request.sort))
    fields.push("sort");
  if (request.region !== undefined && !isTenantID(request.region))
    fields.push("region");
  return fields;
}

export function normalizeSuggestOpeningOrgsRequest(
  request: SuggestOpeningOrgsRequest,
): SuggestOpeningOrgsRequest {
  return { ...request, query: request.query.trim() };
}

export function validateSuggestOpeningOrgsRequest(
  request: SuggestOpeningOrgsRequest,
): string[] {
  const fields: string[] = [];
  const size = codePoints(request.query);
  if (size < 2 || size > 100) fields.push("query");
  if (request.region !== undefined && !isTenantID(request.region))
    fields.push("region");
  return fields;
}
