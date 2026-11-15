import "./public.tsp";

namespace Vetchium.Hub.Profile;

/**
 * What an application keeps of the Hub user as it was when they applied: the
 * public profile without the picture, and their saved ideal job.
 * Professional-email evidence and whether they are looking for a job never
 * enter it.
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

  /** The applicant's saved ideal job at apply time (PROF-JOB-005). */
  ideal_job?: Vetchium.Hub.IdealJob;
}
