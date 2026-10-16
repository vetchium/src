import { countryCodeValues } from "typespec/common/countries";

export function countryOptions(locale: string) {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return countryCodeValues.map((value) => ({
    value,
    label: names.of(value) ?? value,
  }));
}
