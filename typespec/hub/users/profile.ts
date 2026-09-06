import type { TOTPRecoveryCodeCount } from "../../common/authentication.ts";
import type { EmailAddress } from "../../common/common.ts";
import type {
  CountryCode,
  DisplayName,
  FrontendLocale,
} from "../../common/localization.ts";
import { isCountryCode, isFrontendLocale } from "../../common/localization.ts";
import type { HubHandle, HubUserDID } from "../types.ts";

export interface MyInfoResponse {
  preferred_job_countries: CountryCode[];
  hub_user_did: HubUserDID;
  handle: HubHandle;
  email_address: EmailAddress;
  display_name: DisplayName;
  preferred_language: FrontendLocale;
  resident_country: CountryCode;
  totp_enabled: boolean;
  recovery_codes_remaining: TOTPRecoveryCodeCount;
  session_authenticated_at: string;
}

export interface SetPreferredLanguageRequest {
  preferred_language: FrontendLocale;
}

export function validateSetPreferredLanguageRequest(
  request: SetPreferredLanguageRequest,
): string[] {
  return isFrontendLocale(request.preferred_language)
    ? []
    : ["preferred_language"];
}

export interface SetResidentCountryRequest {
  resident_country: CountryCode;
}

export function validateSetResidentCountryRequest(
  request: SetResidentCountryRequest,
): string[] {
  return isCountryCode(request.resident_country) ? [] : ["resident_country"];
}

export interface SetPreferredJobCountriesRequest {
  preferred_job_countries: CountryCode[];
}
export function validateSetPreferredJobCountriesRequest(
  request: SetPreferredJobCountriesRequest,
): string[] {
  const countries = request.preferred_job_countries;
  return !Array.isArray(countries) ||
    countries.length > 10 ||
    new Set(countries).size !== countries.length ||
    countries.some((country) => !isCountryCode(country))
    ? ["preferred_job_countries"]
    : [];
}
