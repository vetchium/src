import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/billing.tsp";
import "../../problem/orgs/suspension.tsp";
import "../../problem/orgs/sso.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Settings;

model SetGoogleSignInRequest {
  /** Required, including when turning sign-in off. Missing or null is invalid. */
  enabled: boolean;
}

@route("/api/orgs/set-google-sign-in")
@tag("Org settings")
interface GoogleSignInSettingsOperations {
  /**
   * Turn Google sign-in on or off. Turning it on requires
   * `org-gold-tier`. Turning it off is refused while the Org has more seats
   * than the plan's cap, because the cap is lifted only with Google sign-in.
   * Idempotent: setting the current value succeeds.
   */
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:superadmin"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  setGoogleSignIn(@body request: SetGoogleSignInRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSSONotAvailableErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.OrgPlanRequiredErrorResponse
    | Vetchium.Problem.OrgUserLimitExceedsTargetErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
