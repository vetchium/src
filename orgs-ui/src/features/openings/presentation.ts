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
  const currency = new Intl.NumberFormat(locale, {
    style: "decimal",
    maximumFractionDigits: 0,
  });
  return {
    labels: {
      description: t("openings.fields.description"),
      language: t("openings.fields.language"),
      employingCountry: t("openings.fields.country"),
      workArrangement: t("openings.fields.workArrangement"),
      locationDetails: t("openings.fields.locationDetails"),
      remoteEligibility: t("openings.fields.remoteEligibility"),
      employmentType: t("openings.fields.employmentType"),
      positions: t("openings.fields.positions"),
      experienceYears: t("openings.fields.experienceYears"),
      minimumEducation: t("openings.fields.minimumEducation"),
      salary: t("openings.fields.salary"),
    },
    formatters: {
      language: (value) => displayName(languages, value),
      country: (value) => displayName(countries, value),
      workArrangement: (value) =>
        t(`openings.workArrangements.${value}`, { defaultValue: value }),
      remoteEligibility: (kind, values) =>
        kind === "worldwide"
          ? t("openings.remote.worldwide")
          : values.map((value) => displayName(countries, value)).join(", "),
      employmentType: (value) =>
        t(`openings.employmentTypes.${value}`, { defaultValue: value }),
      experienceYears: (min, max) =>
        min !== undefined && max !== undefined
          ? t("openings.experienceRange", { min, max })
          : min !== undefined
            ? t("openings.experienceMin", { min })
            : t("openings.experienceMax", { max }),
      minimumEducation: (value) =>
        t(`openings.education.${value}`, { defaultValue: value }),
      salary: (code, min, max, period) =>
        `${code} ${currency.format(min)}–${currency.format(max)} ${t(`openings.salaryPeriods.${period}`, { defaultValue: period })}`,
    },
  };
}
