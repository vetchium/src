import "@typespec/http";

import "../../common/authentication.tsp";
import "../../common/domain.tsp";
import "../../common/idempotency.tsp";
import "../../common/localization.tsp";
import "../../directory/directory.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/profile.tsp";
import "../types.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Profile;

/** A permanent handle or active paid alias, without URL framing. */
@minLength(3)
@maxLength(30)
scalar ProfileAddress extends string;

@format("uuid")
scalar ProfileEntryID extends string;

/** An inclusive UTC calendar month, YYYY-MM. */
@pattern("^[0-9]{4}-(0[1-9]|1[0-2])$")
scalar ProfileMonth extends string;

@minLength(1)
@maxLength(200)
scalar ProfileTitle extends string;

@maxLength(2000)
scalar ProfileLongText extends string;

@maxLength(200)
scalar ProfileLocation extends string;

@maxLength(249)
scalar EducationSupportingText extends string;

/** An absolute HTTPS URL with a host, no credentials and no fragment. */
@maxLength(2048)
scalar CredentialURL extends string;

/** A canonical, language-only BCP 47 tag from the supported living catalog. */
@pattern("^[a-z]{2,3}$")
scalar LanguageTag extends string;

enum LanguageAbility {
  Speaking: "speaking",
  Reading: "reading",
  Writing: "writing",
}

model WorkExperience {
  id: ProfileEntryID;
  employer_domain: Vetchium.ProfessionalDomain;
  job_title: ProfileTitle;
  start_month: ProfileMonth;
  end_month?: ProfileMonth;
  location?: ProfileLocation;
  description?: ProfileLongText;
}

model Certification {
  id: ProfileEntryID;
  title: ProfileTitle;
  credential_url: CredentialURL;
}

model LanguageAbilityEntry {
  ability: LanguageAbility;
  language_tag: LanguageTag;
}

model EducationalQualification {
  id: ProfileEntryID;
  institution_domain: Vetchium.ProfessionalDomain;
  degree: ProfileTitle;
  title?: ProfileTitle;
  supporting_text?: EducationSupportingText;
  start_month?: ProfileMonth;
  end_month?: ProfileMonth;
}

/** Only data visible to another authenticated Hub user crosses the mesh. */
model PublicProfile {
  display_name: Vetchium.DisplayName;
  handle: Vetchium.Hub.HubHandle;
  profile_alias?: Vetchium.Directory.HubAlias;
  resident_country: Vetchium.CountryCode;
  profile_picture_url?: url;
  biography?: ProfileLongText;

  @maxItems(50)
  work_experiences: WorkExperience[];

  @maxItems(50)
  certifications: Certification[];

  @maxItems(75)
  language_abilities: LanguageAbilityEntry[];

  @maxItems(30)
  educational_qualifications: EducationalQualification[];
}

model ReadProfileRequest {
  address: ProfileAddress;
}

model SetPublicFieldsRequest {
  display_name: Vetchium.DisplayName;

  /** Absent, null, or empty after trimming removes the biography. */
  biography?: ProfileLongText | null;
}

model SaveWorkExperienceRequest {
  /** Omit to create; supply an owned id to update. */
  id?: ProfileEntryID;

  employer_domain: Vetchium.ProfessionalDomain;
  job_title: ProfileTitle;
  start_month: ProfileMonth;
  end_month?: ProfileMonth | null;
  location?: ProfileLocation | null;
  description?: ProfileLongText | null;
}

model SaveCertificationRequest {
  id?: ProfileEntryID;
  title: ProfileTitle;
  credential_url: CredentialURL;
}

model SaveEducationalQualificationRequest {
  id?: ProfileEntryID;
  institution_domain: Vetchium.ProfessionalDomain;
  degree: ProfileTitle;
  title?: ProfileTitle | null;
  supporting_text?: EducationSupportingText | null;
  start_month?: ProfileMonth | null;
  end_month?: ProfileMonth | null;
}

model DeleteProfileEntryRequest {
  id: ProfileEntryID;
}

model ChangeLanguageAbilityRequest {
  ability: LanguageAbility;
  language_tag: LanguageTag;
}

alias ProfileWriteResult =
  | {
      @statusCode status_code: 204;
      @header("Cache-Control") cache_control: "no-store";
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

/**
 * A write addressing one existing entry conflicts when that entry is missing
 * or is not the caller's. Whole-profile writes carry no such row reference.
 */
alias ProfileEntryWriteResult =
  | ProfileWriteResult
  | Vetchium.Problem.HubProfileConflictErrorResponse;

@route("/api/hub/profile")
@tag("Hub profiles")
interface PublicProfileOperations {
  @route("/read")
  @post
  @useAuth(BearerAuth)
  read(@body request: ReadProfileRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: PublicProfile;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.HubProfileNotFoundErrorResponse
    | Vetchium.Problem.HubProfileUnavailableErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/set-public-fields")
  @post
  @useAuth(BearerAuth)
  setPublicFields(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: SetPublicFieldsRequest,
  ): ProfileWriteResult;

  @route("/save-work-experience")
  @post
  @useAuth(BearerAuth)
  saveWorkExperience(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: SaveWorkExperienceRequest,
  ): ProfileEntryWriteResult;

  @route("/delete-work-experience")
  @post
  @useAuth(BearerAuth)
  deleteWorkExperience(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: DeleteProfileEntryRequest,
  ): ProfileEntryWriteResult;

  @route("/save-certification")
  @post
  @useAuth(BearerAuth)
  saveCertification(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: SaveCertificationRequest,
  ): ProfileEntryWriteResult;

  @route("/delete-certification")
  @post
  @useAuth(BearerAuth)
  deleteCertification(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: DeleteProfileEntryRequest,
  ): ProfileEntryWriteResult;

  @route("/save-education")
  @post
  @useAuth(BearerAuth)
  saveEducation(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: SaveEducationalQualificationRequest,
  ): ProfileEntryWriteResult;

  @route("/delete-education")
  @post
  @useAuth(BearerAuth)
  deleteEducation(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: DeleteProfileEntryRequest,
  ): ProfileEntryWriteResult;

  @route("/add-language")
  @post
  @useAuth(BearerAuth)
  addLanguage(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ChangeLanguageAbilityRequest,
  ): ProfileEntryWriteResult;

  @route("/delete-language")
  @post
  @useAuth(BearerAuth)
  deleteLanguage(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: ChangeLanguageAbilityRequest,
  ): ProfileEntryWriteResult;
}
