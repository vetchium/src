import { isCountryCode } from "../../common/countries.ts";
import {
  type CountryCode,
  type DisplayName,
  isDisplayName,
  normalizeDisplayName,
} from "../../common/localization.ts";
import { type FrontendLocale, isFrontendLocale } from "../types.ts";
export interface SetCompanyDetailsRequest {
  display_name: DisplayName;
  country: CountryCode;
  default_language: FrontendLocale;
}
export function normalizeSetCompanyDetailsRequest(
  request: SetCompanyDetailsRequest,
): SetCompanyDetailsRequest {
  return {
    ...request,
    display_name: normalizeDisplayName(request.display_name),
  };
}
export function validateSetCompanyDetailsRequest(
  request: SetCompanyDetailsRequest,
): string[] {
  const normalized = normalizeSetCompanyDetailsRequest(request);
  const fields: string[] = [];
  if (!isDisplayName(normalized.display_name)) fields.push("display_name");
  if (!isCountryCode(normalized.country)) fields.push("country");
  if (!isFrontendLocale(normalized.default_language)) {
    fields.push("default_language");
  }
  return fields;
}
