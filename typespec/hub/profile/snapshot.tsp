import "./public.tsp";

namespace Vetchium.Hub.Profile;

/**
 * The profile view fields an application keeps as they were when the Hub user
 * applied: the public profile without the picture. Professional-email
 * evidence never enters it.
 */
model ApplicantSnapshot {
  display_name: Vetchium.DisplayName;
  handle: Vetchium.Hub.HubHandle;
  profile_alias?: Vetchium.Directory.HubAlias;
  resident_country: Vetchium.CountryCode;
  biography?: ProfileLongText;

  @maxItems(10)
  websites: Website[];

  @maxItems(50)
  work_experiences: WorkExperience[];

  @maxItems(50)
  certifications: Certification[];

  @maxItems(75)
  language_abilities: LanguageAbilityEntry[];

  @maxItems(30)
  educational_qualifications: EducationalQualification[];
}
