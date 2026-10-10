import { isCountryCode } from "./countries.ts";
import { type CurrencyCode, isCurrencyCode } from "./currency_catalog.ts";
import { isLanguageTag, type LanguageTag } from "./language_catalog.ts";
import type { CountryCode } from "./localization.ts";

export const OpeningOnSite = "on_site" as const;
export const OpeningHybrid = "hybrid" as const;
export const OpeningRemote = "remote" as const;
export type OpeningWorkArrangement =
  | typeof OpeningOnSite
  | typeof OpeningHybrid
  | typeof OpeningRemote
  | (string & {});
export const OpeningFullTime = "full_time" as const;
export const OpeningPartTime = "part_time" as const;
export const OpeningContract = "contract" as const;
export const OpeningInternship = "internship" as const;
export type OpeningEmploymentType =
  | typeof OpeningFullTime
  | typeof OpeningPartTime
  | typeof OpeningContract
  | typeof OpeningInternship
  | (string & {});
export const OpeningSecondary = "secondary" as const;
export const OpeningBachelor = "bachelor" as const;
export const OpeningMaster = "master" as const;
export const OpeningDoctorate = "doctorate" as const;
export type OpeningEducation =
  | typeof OpeningSecondary
  | typeof OpeningBachelor
  | typeof OpeningMaster
  | typeof OpeningDoctorate
  | (string & {});
export const OpeningHour = "hour" as const;
export const OpeningDay = "day" as const;
export const OpeningMonth = "month" as const;
export const OpeningYear = "year" as const;
export type OpeningSalaryPeriod =
  | typeof OpeningHour
  | typeof OpeningDay
  | typeof OpeningMonth
  | typeof OpeningYear
  | (string & {});
export const OpeningWorldwide = "worldwide" as const;
export const OpeningCountries = "countries" as const;
export type OpeningRemoteEligibilityKind =
  | typeof OpeningWorldwide
  | typeof OpeningCountries
  | (string & {});

export interface OpeningRemoteEligibility {
  kind: OpeningRemoteEligibilityKind;
  countries?: CountryCode[];
}
export interface OpeningExperienceYears {
  min?: number;
  max?: number;
}
export interface OpeningSalary {
  currency: CurrencyCode;
  min: number;
  max: number;
  period: OpeningSalaryPeriod;
}
export interface OpeningContent {
  title?: string;
  description?: string;
  language?: LanguageTag;
  employing_country?: CountryCode;
  work_arrangement?: OpeningWorkArrangement;
  location_details?: string;
  remote_eligibility?: OpeningRemoteEligibility;
  employment_type?: OpeningEmploymentType;
  positions?: number;
  experience_years?: OpeningExperienceYears;
  minimum_education?: OpeningEducation;
  salary?: OpeningSalary;
}

export function normalizeOpeningContent(
  content: OpeningContent,
): OpeningContent {
  return {
    ...content,
    ...(content.title !== undefined && { title: content.title.trim() }),
    ...(content.description !== undefined && {
      description: content.description.trim(),
    }),
    ...(content.language !== undefined && {
      language: content.language.trim(),
    }),
    ...(content.employing_country !== undefined && {
      employing_country: content.employing_country.trim().toUpperCase(),
    }),
    ...(content.location_details !== undefined && {
      location_details: content.location_details.trim(),
    }),
    ...(content.remote_eligibility !== undefined && {
      remote_eligibility: {
        ...content.remote_eligibility,
        ...(content.remote_eligibility.countries !== undefined && {
          countries: content.remote_eligibility.countries.map((country) =>
            country.trim().toUpperCase(),
          ),
        }),
      },
    }),
    ...(content.salary !== undefined && {
      salary: {
        ...content.salary,
        currency: content.salary.currency.trim().toUpperCase(),
      },
    }),
  };
}

function validText(value: string, max: number): boolean {
  const length = [...value].length;
  return length >= 1 && length <= max;
}

export function validateOpeningContent(content: OpeningContent): string[] {
  const fields: string[] = [];
  if (content.title !== undefined && !validText(content.title, 200))
    fields.push("title");
  if (
    content.description !== undefined &&
    !validText(content.description, 20000)
  )
    fields.push("description");
  if (content.language !== undefined && !isLanguageTag(content.language))
    fields.push("language");
  if (
    content.employing_country !== undefined &&
    !isCountryCode(content.employing_country)
  )
    fields.push("employing_country");
  if (
    content.work_arrangement !== undefined &&
    ![OpeningOnSite, OpeningHybrid, OpeningRemote].includes(
      content.work_arrangement as typeof OpeningOnSite,
    )
  )
    fields.push("work_arrangement");
  if (
    content.location_details !== undefined &&
    [...content.location_details].length > 2000
  )
    fields.push("location_details");
  if (content.remote_eligibility !== undefined) {
    const eligibility = content.remote_eligibility;
    if (content.work_arrangement !== OpeningRemote)
      fields.push("remote_eligibility");
    if (
      eligibility.kind !== OpeningWorldwide &&
      eligibility.kind !== OpeningCountries
    )
      fields.push("remote_eligibility.kind");
    if (
      eligibility.kind === OpeningWorldwide &&
      eligibility.countries !== undefined
    )
      fields.push("remote_eligibility.countries");
    if (eligibility.kind === OpeningCountries) {
      if (!eligibility.countries?.length)
        fields.push("remote_eligibility.countries");
      const seen = new Set<string>();
      for (const [index, country] of (eligibility.countries ?? []).entries()) {
        if (!isCountryCode(country) || seen.has(country))
          fields.push(`remote_eligibility.countries.${index}`);
        seen.add(country);
      }
      if (
        content.employing_country !== undefined &&
        isCountryCode(content.employing_country) &&
        !seen.has(content.employing_country)
      )
        fields.push("remote_eligibility.countries");
    }
  }
  if (
    content.employment_type !== undefined &&
    ![
      OpeningFullTime,
      OpeningPartTime,
      OpeningContract,
      OpeningInternship,
    ].includes(content.employment_type as typeof OpeningFullTime)
  )
    fields.push("employment_type");
  if (
    content.positions !== undefined &&
    (!Number.isInteger(content.positions) ||
      content.positions < 1 ||
      content.positions > 10)
  )
    fields.push("positions");
  if (content.experience_years !== undefined) {
    const years = content.experience_years;
    if (
      years.min !== undefined &&
      (!Number.isInteger(years.min) || years.min < 0 || years.min > 50)
    )
      fields.push("experience_years.min");
    if (
      years.max !== undefined &&
      (!Number.isInteger(years.max) ||
        years.max < 0 ||
        years.max > 50 ||
        (years.min !== undefined && years.min > years.max))
    )
      fields.push("experience_years.max");
  }
  if (
    content.minimum_education !== undefined &&
    ![
      OpeningSecondary,
      OpeningBachelor,
      OpeningMaster,
      OpeningDoctorate,
    ].includes(content.minimum_education as typeof OpeningSecondary)
  )
    fields.push("minimum_education");
  if (content.salary !== undefined) {
    const salary = content.salary;
    if (!isCurrencyCode(salary.currency)) fields.push("salary.currency");
    if (
      !Number.isInteger(salary.min) ||
      salary.min < 0 ||
      salary.min > salary.max
    )
      fields.push("salary.min");
    if (!Number.isInteger(salary.max) || salary.max < 1)
      fields.push("salary.max");
    if (
      ![OpeningHour, OpeningDay, OpeningMonth, OpeningYear].includes(
        salary.period as typeof OpeningHour,
      )
    )
      fields.push("salary.period");
  }
  return fields;
}

export function missingForPublication(content: OpeningContent): string[] {
  const fields = validateOpeningContent(content);
  for (const field of [
    "title",
    "description",
    "language",
    "employing_country",
    "work_arrangement",
    "employment_type",
    "positions",
  ] as const) {
    if (content[field] === undefined && !fields.includes(field))
      fields.push(field);
  }
  if (
    content.work_arrangement === OpeningRemote &&
    content.remote_eligibility === undefined &&
    !fields.includes("remote_eligibility")
  )
    fields.push("remote_eligibility");
  return fields;
}
