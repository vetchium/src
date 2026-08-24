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
  hub_user_did: HubUserDID;
  handle: HubHandle;
  email_address: EmailAddress;
  display_name: DisplayName;
  preferred_language: FrontendLocale;
  resident_country: CountryCode;
  totp_enabled: boolean;
  recovery_codes_remaining: Vetchium.Authentication.TOTPRecoveryCodeCount;
  session_authenticated_at: utcDateTime;
}

model SetPreferredLanguageRequest {
  preferred_language: FrontendLocale;
}

model SetResidentCountryRequest {
  resident_country: CountryCode;
}

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
}
