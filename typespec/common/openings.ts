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
/** Keeps every salary exact as a JavaScript number. */
export const MaxOpeningSalary = 1_000_000_000_000;
export interface OpeningSalary {
  currency: CurrencyCode;
  min: number;
  max: number;
  period: OpeningSalaryPeriod;
}
export const QuestionShortText = "short_text" as const;
export const QuestionLongText = "long_text" as const;
export const QuestionNumber = "number" as const;
export const QuestionYesNo = "yes_no" as const;
export const QuestionSingleChoice = "single_choice" as const;
export const QuestionMultipleChoice = "multiple_choice" as const;
export type ApplicationQuestionType =
  | typeof QuestionShortText
  | typeof QuestionLongText
  | typeof QuestionNumber
  | typeof QuestionYesNo
  | typeof QuestionSingleChoice
  | typeof QuestionMultipleChoice
  | (string & {});
export const applicationQuestionTypes = [
  QuestionShortText,
  QuestionLongText,
  QuestionNumber,
  QuestionYesNo,
  QuestionSingleChoice,
  QuestionMultipleChoice,
] as const;

export const maxApplicationQuestions = 10;
export const maxQuestionOptions = 8;
export const maxQuestionNumber = 1_000_000_000;
export const maxQuestionText = 500;
export const maxQuestionOption = 200;

export type ApplicationQuestionID = string;

const questionIDPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Accepts the lowercase form the API returns. */
export function isApplicationQuestionID(value: string): boolean {
  return questionIDPattern.test(value);
}

export function isApplicationQuestionType(value: string): boolean {
  return (applicationQuestionTypes as readonly string[]).includes(value);
}

/** The types whose answers come from options. */
export function isChoiceQuestion(value: ApplicationQuestionType): boolean {
  return value === QuestionSingleChoice || value === QuestionMultipleChoice;
}

export interface ApplicationQuestion {
  /** Absent on a new question; responses always carry it. */
  id?: ApplicationQuestionID;
  text: string;
  type: ApplicationQuestionType;
  required: boolean;
  /** `number` only. */
  min?: number;
  /** `number` only; at least `min`. */
  max?: number;
  /** `single_choice` and `multiple_choice` only; unique ignoring case. */
  options?: string[];
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
  /** In display order. */
  questions?: ApplicationQuestion[];
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
    ...(content.questions !== undefined && {
      questions: content.questions.map((question) => ({
        ...question,
        text: question.text.trim(),
        ...(question.options !== undefined && {
          options: question.options.map((option) => option.trim()),
        }),
      })),
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
    if (
      !Number.isInteger(salary.max) ||
      salary.max < 1 ||
      salary.max > MaxOpeningSalary
    )
      fields.push("salary.max");
    if (
      ![OpeningHour, OpeningDay, OpeningMonth, OpeningYear].includes(
        salary.period as typeof OpeningHour,
      )
    )
      fields.push("salary.period");
  }
  if (content.questions !== undefined)
    fields.push(...validateQuestions(content.questions));
  return fields;
}

function validateQuestions(questions: ApplicationQuestion[]): string[] {
  const fields: string[] = [];
  if (questions.length > maxApplicationQuestions) fields.push("questions");
  const ids = new Set<string>();
  const numberValid = (value: number) =>
    Number.isInteger(value) && value >= 0 && value <= maxQuestionNumber;
  for (const [index, question] of questions.entries()) {
    const path = `questions.${index}`;
    if (question.id !== undefined) {
      if (!isApplicationQuestionID(question.id) || ids.has(question.id))
        fields.push(`${path}.id`);
      ids.add(question.id);
    }
    if (!validText(question.text, maxQuestionText)) fields.push(`${path}.text`);
    if (!isApplicationQuestionType(question.type)) fields.push(`${path}.type`);
    const number = question.type === QuestionNumber;
    if (question.min !== undefined && (!number || !numberValid(question.min)))
      fields.push(`${path}.min`);
    if (
      question.max !== undefined &&
      (!number ||
        !numberValid(question.max) ||
        (question.min !== undefined && question.min > question.max))
    )
      fields.push(`${path}.max`);
    const choice = isChoiceQuestion(question.type);
    const count = question.options?.length ?? 0;
    if (
      (choice && (count < 2 || count > maxQuestionOptions)) ||
      (!choice && question.options !== undefined)
    )
      fields.push(`${path}.options`);
    if (choice) {
      const seen = new Set<string>();
      for (const [option, label] of (question.options ?? []).entries()) {
        const key = label.toLowerCase();
        if (!validText(label, maxQuestionOption) || seen.has(key))
          fields.push(`${path}.options.${option}`);
        seen.add(key);
      }
    }
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
