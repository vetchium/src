import type {
  OpeningEducation,
  OpeningEmploymentType,
  OpeningWorkArrangement,
} from "typespec/common/openings";
import {
  normalizeSearchOpeningsRequest,
  type OpeningSearchPostedWithinDays,
  type SearchOpeningsRequest,
  validateSearchOpeningsRequest,
} from "typespec/hub/openings/search";

export type OpeningSearchFilters = Omit<
  SearchOpeningsRequest,
  "region" | "pagination_key" | "limit"
>;

export interface OpeningSearchState {
  /** Absent when the URL names no region the portal knows. */
  region?: string;
  filters: OpeningSearchFilters;
}

function keepValid<T>(
  field: string,
  items: T[] | undefined,
  refused: readonly string[],
): T[] | undefined {
  if (items === undefined) return undefined;
  const kept = items.filter(
    (_, index) => !refused.includes(`${field}.${index}`),
  );
  return kept.length > 0 ? kept : undefined;
}

function compact(filters: OpeningSearchFilters): OpeningSearchFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined),
  ) as OpeningSearchFilters;
}

/**
 * Drops what the API would refuse: a bad or repeated list item alone, then
 * any field still refused, such as a list over its limit.
 */
function withoutRefused(filters: OpeningSearchFilters): OpeningSearchFilters {
  const refused = validateSearchOpeningsRequest(filters);
  const next = compact({
    ...filters,
    tag_oids: keepValid("tag_oids", filters.tag_oids, refused),
    work_countries: keepValid(
      "work_countries",
      filters.work_countries,
      refused,
    ),
    work_arrangements: keepValid(
      "work_arrangements",
      filters.work_arrangements,
      refused,
    ),
    employment_types: keepValid(
      "employment_types",
      filters.employment_types,
      refused,
    ),
  });
  for (const field of validateSearchOpeningsRequest(next))
    delete next[field as keyof OpeningSearchFilters];
  return next;
}

function list<T extends string>(
  params: URLSearchParams,
  name: string,
): T[] | undefined {
  const values = params.getAll(name).filter((value) => value !== "");
  return values.length > 0 ? (values as T[]) : undefined;
}

function number(params: URLSearchParams, name: string): number | undefined {
  const value = params.get(name);
  return value === null || value.trim() === "" ? undefined : Number(value);
}

/** Reads a search from the URL; a hand-edited value the API would refuse is
 * dropped instead of sent. */
export function searchStateFromParams(
  params: URLSearchParams,
  isRegion: (tenantId: string) => boolean,
): OpeningSearchState {
  const regions = params.getAll("region");
  const region =
    regions.length === 1 && regions[0] !== undefined && isRegion(regions[0])
      ? regions[0]
      : undefined;
  const filters = normalizeSearchOpeningsRequest(
    compact({
      keyword: params.get("q") ?? undefined,
      org_domain: params.get("org") || undefined,
      tag_oids: list(params, "tag"),
      work_countries: list(params, "country"),
      work_arrangements: list<OpeningWorkArrangement>(params, "arrangement"),
      employment_types: list<OpeningEmploymentType>(params, "employment"),
      posted_within_days: number(params, "posted") as
        | OpeningSearchPostedWithinDays
        | undefined,
      experience_years: number(params, "experience"),
      education_level: (params.get("education") || undefined) as
        | OpeningEducation
        | undefined,
      salary_disclosed: params.get("salary") === "1" ? true : undefined,
    }),
  );
  return {
    ...(region !== undefined && { region }),
    filters: withoutRefused(filters),
  };
}

/** The URL of a search, in the order OPN-SRCH-009 lists its parameters. */
export function paramsFromSearchState({
  region,
  filters,
}: OpeningSearchState): URLSearchParams {
  const params = new URLSearchParams();
  const add = (name: string, value: string | number | undefined) => {
    if (value !== undefined) params.append(name, String(value));
  };
  add("q", filters.keyword);
  add("region", region);
  add("org", filters.org_domain);
  for (const value of filters.tag_oids ?? []) add("tag", value);
  for (const value of filters.work_countries ?? []) add("country", value);
  for (const value of filters.work_arrangements ?? [])
    add("arrangement", value);
  for (const value of filters.employment_types ?? []) add("employment", value);
  add("posted", filters.posted_within_days);
  add("experience", filters.experience_years);
  add("education", filters.education_level);
  if (filters.salary_disclosed) add("salary", 1);
  return params;
}
