import type {
  OpeningPresentation,
  QuestionFieldsLabels,
} from "@vetchium/portal-ui/openings";
import type { TFunction } from "i18next";
import {
  type ApplicationQuestion,
  QuestionMultipleChoice,
  QuestionNumber,
  QuestionSingleChoice,
} from "typespec/common/openings";

function displayName(names: Intl.DisplayNames, value: string): string {
  try {
    return names.of(value) ?? value;
  } catch {
    return value;
  }
}

function bounds(
  t: TFunction,
  locale: string,
  min?: number,
  max?: number,
): string | undefined {
  const format = new Intl.NumberFormat(locale).format;
  return min !== undefined && max !== undefined
    ? t("apply.questions.range", { min: format(min), max: format(max) })
    : min !== undefined
      ? t("apply.questions.atLeast", { min: format(min) })
      : max !== undefined
        ? t("apply.questions.atMost", { max: format(max) })
        : undefined;
}

function describeQuestion(
  t: TFunction,
  locale: string,
  question: ApplicationQuestion,
): string {
  const parts = [
    t(`orgPage.questions.types.${question.type}`, {
      defaultValue: question.type,
    }),
    t(
      question.required
        ? "orgPage.questions.required"
        : "orgPage.questions.optional",
    ),
  ];
  if (question.type === QuestionNumber) {
    const format = new Intl.NumberFormat(locale).format;
    const { min, max } = question;
    if (min !== undefined && max !== undefined)
      parts.push(
        t("orgPage.questions.range", { min: format(min), max: format(max) }),
      );
    else if (min !== undefined)
      parts.push(t("orgPage.questions.atLeast", { min: format(min) }));
    else if (max !== undefined)
      parts.push(t("orgPage.questions.atMost", { max: format(max) }));
  }
  if (
    (question.type === QuestionSingleChoice ||
      question.type === QuestionMultipleChoice) &&
    question.options?.length
  )
    parts.push(
      t("orgPage.questions.choices", { options: question.options.join(", ") }),
    );
  return parts.join(" · ");
}

export function openingPresentation(
  t: TFunction,
  locale: string,
): OpeningPresentation {
  const countries = new Intl.DisplayNames([locale], { type: "region" });
  const languages = new Intl.DisplayNames([locale], { type: "language" });
  const numbers = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return {
    labels: {
      description: t("orgPage.fields.description"),
      details: t("orgPage.fields.details"),
      language: t("orgPage.fields.language"),
      employingCountry: t("orgPage.fields.country"),
      workArrangement: t("orgPage.fields.workArrangement"),
      locationDetails: t("orgPage.fields.locationDetails"),
      remoteEligibility: t("orgPage.fields.remoteEligibility"),
      employmentType: t("orgPage.fields.employmentType"),
      positions: t("orgPage.fields.positions"),
      experienceYears: t("orgPage.fields.experienceYears"),
      minimumEducation: t("orgPage.fields.minimumEducation"),
      salary: t("orgPage.fields.salary"),
    },
    formatters: {
      language: (value) => displayName(languages, value),
      country: (value) => displayName(countries, value),
      workArrangement: (value) =>
        t(`orgPage.workArrangements.${value}`, { defaultValue: value }),
      remoteEligibility: (kind, values) =>
        kind === "worldwide"
          ? t("orgPage.remoteWorldwide")
          : values.map((value) => displayName(countries, value)).join(", "),
      employmentType: (value) =>
        t(`orgPage.employmentTypes.${value}`, { defaultValue: value }),
      experienceYears: (min, max) =>
        min !== undefined && max !== undefined
          ? t("orgPage.experienceRange", { min, max })
          : min !== undefined
            ? t("orgPage.experienceMin", { min })
            : t("orgPage.experienceMax", { max }),
      minimumEducation: (value) =>
        t(`orgPage.education.${value}`, { defaultValue: value }),
      salary: (code, min, max, period) =>
        `${code} ${numbers.format(min)}–${numbers.format(max)} ${t(`orgPage.salaryPeriods.${period}`, { defaultValue: period })}`,
    },
    questions: {
      heading: t("orgPage.questions.heading"),
      summary: (total, required) =>
        t("orgPage.questions.summary", { count: total, required }),
      describe: (question) => describeQuestion(t, locale, question),
    },
  };
}

export function questionFieldLabels(
  t: TFunction,
  locale: string,
  orgName: string,
): QuestionFieldsLabels {
  return {
    required: t("apply.questions.required"),
    yes: t("apply.questions.yes"),
    no: t("apply.questions.no"),
    chooseAny: t("apply.questions.chooseAny"),
    wholeNumber: t("apply.questions.wholeNumber"),
    changed: t("apply.questions.changed", { org: orgName }),
    bounds: (min, max) => bounds(t, locale, min, max),
    outOfRange: (range) => t("apply.questions.outOfRange", { bounds: range }),
  };
}
