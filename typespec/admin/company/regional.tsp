import "@typespec/http";
import "@typespec/openapi";

import "../../common/localization.tsp";
import "../../problem/admin/authentication.tsp";
import "../../problem/admin/authorization.tsp";
import "../../problem/details.tsp";
import "../types.tsp";

using TypeSpec.Http;

namespace Vetchium.Admin;

/** Regional defaults used when an admin has no individual override. */
model CompanyRegionalDefaultsResponse {
  default_language: LanguageCode;
  default_timezone: TimeZoneID;
}

/** Atomically replace the company's language and timezone defaults. */
model SetCompanyRegionalDefaultsRequest {
  default_language: LanguageCode;
  default_timezone: TimeZoneID;
}

@route("/api/admin")
@tag("Admin company settings")
interface CompanyRegionalOperations {
  /**
   * Return the current deployment's company defaults for unauthenticated login
   * and invitation screens.
   */
  @route("/company-regional-defaults")
  @get
  companyRegionalDefaults():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "public, max-age=300";
        @body body: CompanyRegionalDefaultsResponse;
      }
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Replace company defaults without overwriting individual user overrides. */
  @route("/set-company-regional-defaults")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-superadmin-required", true)
  setCompanyRegionalDefaults(@body request: SetCompanyRegionalDefaultsRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.SuperadminRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
