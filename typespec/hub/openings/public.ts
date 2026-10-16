import { isCountryCode } from "../../common/countries.ts";
import type { CountryCode } from "../../common/localization.ts";
import type {
  OpeningContent,
  OpeningEmploymentType,
  OpeningWorkArrangement,
} from "../../common/openings.ts";
import {
  isPaginationKey,
  type PaginationKey,
} from "../../common/pagination.ts";
import {
  isOrgDomain,
  normalizeOrgDomain,
  type OrgDomain,
} from "../../orgs/types.ts";

export type OpeningNumber = number;
export type OpeningPageSize = number;
export type OpeningTitleQuery = string;

export interface PublicOrg {
  domain: OrgDomain;
  display_name: string;
  country: CountryCode;
  logo_url?: string;
}

export interface PublicOpeningSummary {
  opening_number: OpeningNumber;
  title: string;
  employing_country: CountryCode;
  work_arrangement: OpeningWorkArrangement;
  employment_type: OpeningEmploymentType;
  first_published_at: string;
}

export type PublicOpening =
  | {
      opening_number: OpeningNumber;
      state: "published";
      content: OpeningContent;
      first_published_at: string;
      last_revised_at?: string;
    }
  | {
      opening_number: OpeningNumber;
      state: "not_accepting";
      title: string;
    };

export interface ListOrgOpeningsRequest {
  domain: OrgDomain;
  employing_country?: CountryCode;
  work_arrangement?: OpeningWorkArrangement;
  employment_type?: OpeningEmploymentType;
  title_query?: OpeningTitleQuery;
  pagination_key?: PaginationKey;
  limit?: OpeningPageSize;
}

export interface ListOrgOpeningsResponse {
  org: PublicOrg;
  openings: PublicOpeningSummary[];
  next_pagination_key?: PaginationKey;
}

export interface GetOrgOpeningRequest {
  domain: OrgDomain;
  opening_number: OpeningNumber;
}

export interface GetOrgOpeningResponse {
  org: PublicOrg;
  opening: PublicOpening;
}

export function normalizeListOrgOpeningsRequest(
  request: ListOrgOpeningsRequest,
): ListOrgOpeningsRequest {
  return {
    ...request,
    domain: normalizeOrgDomain(request.domain),
    ...(request.employing_country !== undefined && {
      employing_country: request.employing_country.trim().toUpperCase(),
    }),
    ...(request.title_query !== undefined && {
      title_query: request.title_query.trim(),
    }),
  };
}

export function validateListOrgOpeningsRequest(
  request: ListOrgOpeningsRequest,
): string[] {
  const fields: string[] = [];
  if (!isOrgDomain(request.domain)) fields.push("domain");
  if (
    request.employing_country !== undefined &&
    !isCountryCode(request.employing_country)
  )
    fields.push("employing_country");
  if (
    request.work_arrangement !== undefined &&
    !["on_site", "hybrid", "remote"].includes(request.work_arrangement)
  )
    fields.push("work_arrangement");
  if (
    request.employment_type !== undefined &&
    !["full_time", "part_time", "contract", "internship"].includes(
      request.employment_type,
    )
  )
    fields.push("employment_type");
  if (
    request.title_query !== undefined &&
    ([...request.title_query].length < 2 ||
      [...request.title_query].length > 200)
  )
    fields.push("title_query");
  if (
    request.pagination_key !== undefined &&
    !isPaginationKey(request.pagination_key)
  )
    fields.push("pagination_key");
  const limit = request.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) fields.push("limit");
  return fields;
}

export function normalizeGetOrgOpeningRequest(
  request: GetOrgOpeningRequest,
): GetOrgOpeningRequest {
  return { ...request, domain: normalizeOrgDomain(request.domain) };
}

export function validateGetOrgOpeningRequest(
  request: GetOrgOpeningRequest,
): string[] {
  const fields: string[] = [];
  if (!isOrgDomain(request.domain)) fields.push("domain");
  if (
    !Number.isInteger(request.opening_number) ||
    request.opening_number < 1 ||
    request.opening_number > 2_147_483_647
  )
    fields.push("opening_number");
  return fields;
}
