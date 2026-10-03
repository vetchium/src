import "@typespec/http";
import "@typespec/openapi";
import "../../common/authentication.tsp";
import "../../common/localization.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/suspension.tsp";
using TypeSpec.Http;
namespace Vetchium.Orgs.Settings;
model SetCompanyNameRequest { display_name: Vetchium.DisplayName; }
@route("/api/orgs/set-company-name")
@tag("Org settings")
interface CompanySettingsOperations {
 /** Set the display name, trimmed to 1–200 Unicode code points. No-op if unchanged. */
 @post @useAuth(BearerAuth)
 @TypeSpec.OpenAPI.extension("x-vetchium-required-permission", "org:superadmin")
 setCompanyName(@body request:SetCompanyNameRequest):
 | { @statusCode status_code:204; @header("Cache-Control") cache_control:"no-store"; }
 | Vetchium.Problem.InvalidJSONErrorResponse
 | Vetchium.Problem.ValidationFailedErrorResponse
 | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
 | Vetchium.Problem.OrgPermissionRequiredErrorResponse
 | Vetchium.Problem.OrgSuspendedErrorResponse
 | Vetchium.Problem.RateLimitExceededErrorResponse
 | Vetchium.Problem.InternalServerErrorResponse;
}
