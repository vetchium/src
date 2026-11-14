import "@typespec/http";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/localization.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../types.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub;

model MyInfoResponse {
  preferred_job_countries: CountryCode[];
  handle: HubHandle;
  email_address: EmailAddress;
  display_name: DisplayName;
  preferred_language: FrontendLocale;
  resident_country: CountryCode;
  totp_enabled: boolean;
  recovery_codes_remaining: Vetchium.Authentication.TOTPRecoveryCodeCount;
  session_authenticated_at: utcDateTime;
  agencies_may_message: boolean;

  /** Absent when the user has saved no ideal job (PROF-JOB-002). */
  ideal_job?: IdealJob;

  /** Private to the user (PROF-JOB-004). */
  looking_for_job: boolean;

  /** Whether the user dismissed the Home "Your job search" card. */
  job_search_prompt_dismissed: boolean;
}

model SetPreferredLanguageRequest {
  preferred_language: FrontendLocale;
}

model SetResidentCountryRequest {
  resident_country: CountryCode;
}

model SetPreferredJobCountriesRequest {
  /** Empty means no country filter. Values must be distinct ISO countries. */
  @maxItems(10)
  preferred_job_countries: CountryCode[];
}

model SetAgenciesMayMessageRequest {
  /**
   * Whether agencies may send the Hub user chat requests (MKT-REQ-008). Off
   * refuses only new agency requests; accepted conversations continue.
   */
  agencies_may_message: boolean;
}

model SetIdealJobRequest {
  /** Required. At most 2,000 code points after trimming; empty after trimming
   * removes the ideal job (PROF-JOB-001). */
  ideal_job: string;
}

model SetLookingForJobRequest {
  /** Private to the user (PROF-JOB-004). */
  looking_for_job: boolean;
}

model DismissJobSearchPromptRequest {}

@route("/api/hub")
@tag("Hub profile")
interface ProfileOperations {
  @route("/my-info")
  @get
  @useAuth(BearerAuth)
  myInfo():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: MyInfoResponse;
      }
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/set-preferred-language")
  @post
  @useAuth(BearerAuth)
  setPreferredLanguage(@body request: SetPreferredLanguageRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/set-resident-country")
  @post
  @useAuth(BearerAuth)
  setResidentCountry(@body request: SetResidentCountryRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
  @route("/set-preferred-job-countries")
  @post
  @useAuth(BearerAuth)
  setPreferredJobCountries(@body request: SetPreferredJobCountriesRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Sets "Agencies may send me chat requests" (MKT-REQ-008, MKT-DAT-006). */
  @route("/set-agencies-may-message")
  @post
  @useAuth(BearerAuth)
  setAgenciesMayMessage(@body request: SetAgenciesMayMessageRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Sets or, with an empty value, removes the ideal job (PROF-JOB-002). */
  @route("/set-ideal-job")
  @post
  @useAuth(BearerAuth)
  setIdealJob(@body request: SetIdealJobRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/set-looking-for-job")
  @post
  @useAuth(BearerAuth)
  setLookingForJob(@body request: SetLookingForJobRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Hides the Home "Your job search" card; dismissing again keeps the first
   * time (PROF-JOB-002). */
  @route("/dismiss-job-search-prompt")
  @post
  @useAuth(BearerAuth)
  dismissJobSearchPrompt(@body request: DismissJobSearchPromptRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
