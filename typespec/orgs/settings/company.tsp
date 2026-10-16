import "@typespec/http";
import "@typespec/openapi";
import "../../common/authentication.tsp";
import "../../common/localization.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/suspension.tsp";
import "../types.tsp";
using TypeSpec.Http;
namespace Vetchium.Orgs.Settings;
/** Replaces every field; send the current value of a field that stays. */
model SetCompanyDetailsRequest {
  display_name: Vetchium.DisplayName;
  country: Vetchium.CountryCode;
  default_language: Vetchium.Orgs.FrontendLocale;
}
@route("/api/orgs/set-company-details")
@tag("Org settings")
interface CompanySettingsOperations {
  /** Set the display name (trimmed to 1–200 Unicode code points), country,
   * and default language. No-op if nothing changed. */
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:superadmin"
  )
  setCompanyDetails(@body request: SetCompanyDetailsRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
