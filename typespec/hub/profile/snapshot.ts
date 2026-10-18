import { isCountryCode } from "../../common/countries.ts";
import type { CountryCode, DisplayName } from "../../common/localization.ts";
import { isDisplayName } from "../../common/localization.ts";
import { type HubAlias, isHubAlias } from "../../directory/directory.ts";
import type { HubHandle } from "../types.ts";
import { isHubHandle } from "../types.ts";
import type {
  Certification,
  EducationalQualification,
  LanguageAbilityEntry,
  ProfileLongText,
  Website,
  WorkExperience,
} from "./public.ts";
import { MaxWebsites } from "./public.ts";

const maxBiography = 2000;
const maxWorkExperiences = 50;
const maxCertifications = 50;
const maxLanguageAbilities = 75;
const maxEducationalQualifications = 30;

/** The public profile as of the application, without the picture. */
export interface ApplicantSnapshot {
  display_name: DisplayName;
  handle: HubHandle;
  profile_alias?: HubAlias;
  resident_country: CountryCode;
  biography?: ProfileLongText;
  websites: Website[];
  work_experiences: WorkExperience[];
  certifications: Certification[];
  language_abilities: LanguageAbilityEntry[];
  educational_qualifications: EducationalQualification[];
}

/**
 * Reports the invalid top-level fields. Entry contents were validated when
 * the profile stored them; only the bounds a snapshot keeps are checked.
 */
export function validateApplicantSnapshot(
  snapshot: ApplicantSnapshot,
): string[] {
  const fields: string[] = [];
  if (!isDisplayName(snapshot.display_name)) fields.push("display_name");
  if (!isHubHandle(snapshot.handle)) fields.push("handle");
  if (
    snapshot.profile_alias !== undefined &&
    !isHubAlias(snapshot.profile_alias)
  ) {
    fields.push("profile_alias");
  }
  if (!isCountryCode(snapshot.resident_country)) {
    fields.push("resident_country");
  }
  if (
    snapshot.biography !== undefined &&
    Array.from(snapshot.biography).length > maxBiography
  ) {
    fields.push("biography");
  }
  if (snapshot.websites.length > MaxWebsites) fields.push("websites");
  if (snapshot.work_experiences.length > maxWorkExperiences) {
    fields.push("work_experiences");
  }
  if (snapshot.certifications.length > maxCertifications) {
    fields.push("certifications");
  }
  if (snapshot.language_abilities.length > maxLanguageAbilities) {
    fields.push("language_abilities");
  }
  if (
    snapshot.educational_qualifications.length > maxEducationalQualifications
  ) {
    fields.push("educational_qualifications");
  }
  return fields;
}
