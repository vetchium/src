import type { ProfessionalDomain } from "../../common/domain.ts";
import {
  isProfessionalDomain,
  normalizeProfessionalDomain,
} from "../../common/domain.ts";
import type { CountryCode, DisplayName } from "../../common/localization.ts";
import {
  isDisplayName,
  normalizeDisplayName,
} from "../../common/localization.ts";
import { type HubAlias, isProfileSlug } from "../../directory/directory.ts";
import type { HubHandle } from "../types.ts";
import tags from "./language_catalog.json" with { type: "json" };

export type ProfileAddress = string;
export type ProfileEntryID = string;
export type ProfileMonth = string;
export type ProfileTitle = string;
export type ProfileLongText = string;
export type ProfileLocation = string;
export type EducationSupportingText = string;
export type CredentialURL = string;
export type LanguageTag = string;

export const Speaking = "speaking" as const;
export const Reading = "reading" as const;
export const Writing = "writing" as const;
export type LanguageAbility = typeof Speaking | typeof Reading | typeof Writing;

export function isProfileAddress(value: ProfileAddress): boolean {
  return isProfileSlug(value);
}

export function isProfileEntryID(value: ProfileEntryID): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    value,
  );
}

export function isProfileMonth(value: ProfileMonth): boolean {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value) || value < "1900-01") {
    return false;
  }
  return value <= new Date().toISOString().slice(0, 7);
}

export function isProfileTitle(value: ProfileTitle): boolean {
  const length = [...value.trim()].length;
  return length >= 1 && length <= 200;
}

export function isCredentialURL(value: CredentialURL): boolean {
  if (
    value.length === 0 ||
    value.length > 2048 ||
    value.trim() !== value ||
    value.includes("#") ||
    !/^[\x20-\x7e]+$/.test(value)
  ) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname !== "" &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

export function isLanguageAbility(value: string): value is LanguageAbility {
  return value === Speaking || value === Reading || value === Writing;
}

export function isLanguageTag(value: LanguageTag): boolean {
  return languageCatalogSet.has(value);
}

export const languageCatalog: readonly LanguageTag[] = tags;
const languageCatalogSet = new Set<string>(languageCatalog);

export interface WorkExperience {
  id: ProfileEntryID;
  employer_domain: ProfessionalDomain;
  job_title: ProfileTitle;
  start_month: ProfileMonth;
  end_month?: ProfileMonth;
  location?: ProfileLocation;
  description?: ProfileLongText;
}

export interface Certification {
  id: ProfileEntryID;
  title: ProfileTitle;
  credential_url: CredentialURL;
}

export interface LanguageAbilityEntry {
  ability: LanguageAbility;
  language_tag: LanguageTag;
}

export interface EducationalQualification {
  id: ProfileEntryID;
  institution_domain: ProfessionalDomain;
  degree: ProfileTitle;
  title?: ProfileTitle;
  supporting_text?: EducationSupportingText;
  start_month?: ProfileMonth;
  end_month?: ProfileMonth;
}

export interface PublicProfile {
  display_name: DisplayName;
  handle: HubHandle;
  profile_alias?: HubAlias;
  resident_country: CountryCode;
  profile_picture_url?: string;
  biography?: ProfileLongText;
  work_experiences: WorkExperience[];
  certifications: Certification[];
  language_abilities: LanguageAbilityEntry[];
  educational_qualifications: EducationalQualification[];
}

export interface ReadProfileRequest {
  address: ProfileAddress;
}

export function normalizeReadProfileRequest(
  request: ReadProfileRequest,
): ReadProfileRequest {
  return { ...request, address: request.address.trim() };
}

export function validateReadProfileRequest(
  request: ReadProfileRequest,
): string[] {
  return isProfileAddress(request.address) ? [] : ["address"];
}

export interface SetPublicFieldsRequest {
  display_name: DisplayName;
  biography?: ProfileLongText | null;
}

export function normalizeSetPublicFieldsRequest(
  request: SetPublicFieldsRequest,
): SetPublicFieldsRequest {
  const biography = request.biography?.trim();
  return {
    ...request,
    display_name: normalizeDisplayName(request.display_name),
    biography: biography || null,
  };
}

export function validateSetPublicFieldsRequest(
  request: SetPublicFieldsRequest,
): string[] {
  const fields: string[] = [];
  if (!isDisplayName(request.display_name)) fields.push("display_name");
  if (
    request.biography !== undefined &&
    request.biography !== null &&
    [...request.biography].length > 2000
  ) {
    fields.push("biography");
  }
  return fields;
}

export interface SaveWorkExperienceRequest {
  id?: ProfileEntryID;
  employer_domain: ProfessionalDomain;
  job_title: ProfileTitle;
  start_month: ProfileMonth;
  end_month?: ProfileMonth | null;
  location?: ProfileLocation | null;
  description?: ProfileLongText | null;
}

export function normalizeSaveWorkExperienceRequest(
  request: SaveWorkExperienceRequest,
): SaveWorkExperienceRequest {
  return {
    ...request,
    employer_domain: normalizeProfessionalDomain(request.employer_domain),
    job_title: request.job_title.trim(),
    location: request.location?.trim() ?? null,
    description: request.description?.trim() ?? null,
  };
}

export function validateSaveWorkExperienceRequest(
  request: SaveWorkExperienceRequest,
): string[] {
  const fields: string[] = [];
  if (request.id !== undefined && !isProfileEntryID(request.id)) {
    fields.push("id");
  }
  if (!isProfessionalDomain(request.employer_domain)) {
    fields.push("employer_domain");
  }
  if (!isProfileTitle(request.job_title)) fields.push("job_title");
  if (!isProfileMonth(request.start_month)) fields.push("start_month");
  if (
    request.end_month != null &&
    (!isProfileMonth(request.end_month) ||
      request.end_month < request.start_month)
  ) {
    fields.push("end_month");
  }
  if (request.location != null && [...request.location].length > 200) {
    fields.push("location");
  }
  if (request.description != null && [...request.description].length > 2000) {
    fields.push("description");
  }
  return fields;
}

export interface SaveCertificationRequest {
  id?: ProfileEntryID;
  title: ProfileTitle;
  credential_url: CredentialURL;
}

export function normalizeSaveCertificationRequest(
  request: SaveCertificationRequest,
): SaveCertificationRequest {
  return {
    ...request,
    title: request.title.trim(),
    credential_url: request.credential_url.trim(),
  };
}

export function validateSaveCertificationRequest(
  request: SaveCertificationRequest,
): string[] {
  const fields: string[] = [];
  if (request.id !== undefined && !isProfileEntryID(request.id)) {
    fields.push("id");
  }
  if (!isProfileTitle(request.title)) fields.push("title");
  if (!isCredentialURL(request.credential_url)) fields.push("credential_url");
  return fields;
}

export interface SaveEducationalQualificationRequest {
  id?: ProfileEntryID;
  institution_domain: ProfessionalDomain;
  degree: ProfileTitle;
  title?: ProfileTitle | null;
  supporting_text?: EducationSupportingText | null;
  start_month?: ProfileMonth | null;
  end_month?: ProfileMonth | null;
}

export function normalizeSaveEducationalQualificationRequest(
  request: SaveEducationalQualificationRequest,
): SaveEducationalQualificationRequest {
  return {
    ...request,
    institution_domain: normalizeProfessionalDomain(request.institution_domain),
    degree: request.degree.trim(),
    title: request.title?.trim() ?? null,
    supporting_text: request.supporting_text?.trim() ?? null,
  };
}

export function validateSaveEducationalQualificationRequest(
  request: SaveEducationalQualificationRequest,
): string[] {
  const fields: string[] = [];
  if (request.id !== undefined && !isProfileEntryID(request.id)) {
    fields.push("id");
  }
  if (!isProfessionalDomain(request.institution_domain)) {
    fields.push("institution_domain");
  }
  if (!isProfileTitle(request.degree)) fields.push("degree");
  if (request.title != null && !isProfileTitle(request.title)) {
    fields.push("title");
  }
  if (
    request.supporting_text != null &&
    [...request.supporting_text].length > 249
  ) {
    fields.push("supporting_text");
  }
  if (request.start_month != null && !isProfileMonth(request.start_month)) {
    fields.push("start_month");
  }
  if (
    request.end_month != null &&
    (!isProfileMonth(request.end_month) ||
      (request.start_month != null && request.end_month < request.start_month))
  ) {
    fields.push("end_month");
  }
  return fields;
}

export interface DeleteProfileEntryRequest {
  id: ProfileEntryID;
}

export function validateDeleteProfileEntryRequest(
  request: DeleteProfileEntryRequest,
): string[] {
  return isProfileEntryID(request.id) ? [] : ["id"];
}

export interface ChangeLanguageAbilityRequest {
  ability: LanguageAbility;
  language_tag: LanguageTag;
}

export function validateChangeLanguageAbilityRequest(
  request: ChangeLanguageAbilityRequest,
): string[] {
  const fields: string[] = [];
  if (!isLanguageAbility(request.ability)) fields.push("ability");
  if (!isLanguageTag(request.language_tag)) fields.push("language_tag");
  return fields;
}
