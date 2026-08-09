import type {
  LocalizedDisplayName,
  RegionalLanguageCode,
} from "../../common/localization.ts";
import {
  isDisplayName,
  isRegionalLanguageCode,
  normalizeDisplayName,
} from "../../common/localization.ts";

export function normalizeDisplayNames(
  values: LocalizedDisplayName[],
): LocalizedDisplayName[] {
  return values.map((value) => ({
    ...value,
    display_name: normalizeDisplayName(value.display_name),
  }));
}

export function validateDisplayNames(
  values: LocalizedDisplayName[],
  primary: RegionalLanguageCode,
): { valid: boolean; primaryPresent: boolean } {
  if (values.length === 0) {
    return { valid: false, primaryPresent: false };
  }
  const seen = new Set<RegionalLanguageCode>();
  let valid = true;
  let primaryPresent = false;
  for (const value of values) {
    if (
      !isRegionalLanguageCode(value.language_code) ||
      !isDisplayName(value.display_name) ||
      seen.has(value.language_code)
    ) {
      valid = false;
    }
    seen.add(value.language_code);
    if (value.language_code === primary) {
      primaryPresent = true;
    }
  }
  return {
    valid,
    primaryPresent: isRegionalLanguageCode(primary) && primaryPresent,
  };
}
