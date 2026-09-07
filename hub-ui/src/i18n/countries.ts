import deData from "cldr-localenames-full/main/de/territories.json";
import enData from "cldr-localenames-full/main/en/territories.json";
import taData from "cldr-localenames-full/main/ta/territories.json";
import { countryCodeValues } from "typespec/common/countries";
import type { CountryCode } from "typespec/common/localization";
import type { FrontendLocale } from "typespec/hub/types";

type TerritoryNames = Record<string, string>;

const names: Record<FrontendLocale, TerritoryNames> = {
  "en-US": enData.main.en.localeDisplayNames.territories,
  "de-DE": deData.main.de.localeDisplayNames.territories,
  ta: taData.main.ta.localeDisplayNames.territories,
};

export function countryName(
  country: CountryCode,
  locale: FrontendLocale,
): string {
  return names[locale][country] ?? country;
}

export function countryOptions(locale: FrontendLocale) {
  const collator = new Intl.Collator(locale);
  return countryCodeValues
    .map((value) => ({ value, label: countryName(value, locale) }))
    .sort((left, right) => collator.compare(left.label, right.label));
}
