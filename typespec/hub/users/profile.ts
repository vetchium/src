import type { TOTPRecoveryCodeCount } from "../../common/authentication.ts";
import type { EmailAddress } from "../../common/common.ts";
import { isCountryCode } from "../../common/countries.ts";
import type { CountryCode, DisplayName } from "../../common/localization.ts";
import {
  type FrontendLocale,
  type HubHandle,
  type IdealJob,
  isFrontendLocale,
  maxIdealJobCodePoints,
} from "../types.ts";

export interface MyInfoResponse {
  preferred_job_countries: CountryCode[];
  handle: HubHandle;
  email_address: EmailAddress;
  display_name: DisplayName;
  preferred_language: FrontendLocale;
  resident_country: CountryCode;
  totp_enabled: boolean;
  recovery_codes_remaining: TOTPRecoveryCodeCount;
  session_authenticated_at: string;
  agencies_may_message: boolean;
  /** Absent when the user has saved no ideal job (PROF-JOB-002). */
  ideal_job?: IdealJob;
  /** Private to the user (PROF-JOB-004). */
  looking_for_job: boolean;
  job_search_prompt_dismissed: boolean;
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

export interface SetAgenciesMayMessageRequest {
  /**
   * "Agencies may send me chat requests" (MKT-REQ-008): off refuses only new
   * agency requests, and accepted conversations continue.
   */
  agencies_may_message: boolean;
}

export function validateSetAgenciesMayMessageRequest(
  request: SetAgenciesMayMessageRequest,
): string[] {
  return typeof request.agencies_may_message === "boolean"
    ? []
    : ["agencies_may_message"];
}

/** Empty after trimming removes the ideal job (PROF-JOB-001); a missing value
 * is refused. */
export interface SetIdealJobRequest {
  ideal_job: string;
}

export function normalizeSetIdealJobRequest(
  request: SetIdealJobRequest,
): SetIdealJobRequest {
  return { ...request, ideal_job: request.ideal_job.trim() };
}

export function validateSetIdealJobRequest(
  request: SetIdealJobRequest,
): string[] {
  return typeof request.ideal_job === "string" &&
    [...request.ideal_job].length <= maxIdealJobCodePoints
    ? []
    : ["ideal_job"];
}

export interface SetLookingForJobRequest {
  looking_for_job: boolean;
}

export function validateSetLookingForJobRequest(
  request: SetLookingForJobRequest,
): string[] {
  return typeof request.looking_for_job === "boolean"
    ? []
    : ["looking_for_job"];
}

export type DismissJobSearchPromptRequest = Record<string, never>;
