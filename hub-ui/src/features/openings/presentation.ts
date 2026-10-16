import type {
  OpeningContentFormatters,
  OpeningContentLabels,
} from "@vetchium/portal-ui/openings";
import type { TFunction } from "i18next";

function displayName(names: Intl.DisplayNames, value: string): string {
  try {
    return names.of(value) ?? value;
  } catch {
    return value;
  }
}

export function openingContentPresentation(
  t: TFunction,
  locale: string,
): { labels: OpeningContentLabels; formatters: OpeningContentFormatters } {
  const countries = new Intl.DisplayNames([locale], { type: "region" });
  const languages = new Intl.DisplayNames([locale], { type: "language" });
  const numbers = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return {
    labels: {
      description: t("orgPage.fields.description"),
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
  };
}
