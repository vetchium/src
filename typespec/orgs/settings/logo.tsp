import "@typespec/http";

import "../../common/authentication.tsp";
import "../../common/idempotency.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/billing.tsp";
import "../../problem/orgs/logo.tsp";
import "../../problem/orgs/suspension.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Settings;

alias LogoContentType = "image/jpeg" | "image/png";

@route("/api/orgs/logo")
@tag("Org logo")
interface LogoOperations {
  /**
   * Add or replace the Org logo. Requires `org-silver-tier` or higher. Only a
   * still JPEG or PNG is accepted, with each side between 128 and 4,096
   * pixels; the image is re-encoded to strip metadata.
   */
  @route("/upload")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:superadmin"
  )
  upload(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @header("Content-Type") content_type: LogoContentType,

    /** Reject before decoding when the request exceeds 2,097,152 bytes. */
    @body body: bytes,
  ):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.OrgPlanRequiredErrorResponse
    | Vetchium.Problem.OrgLogoTooLargeErrorResponse
    | Vetchium.Problem.OrgLogoInvalidErrorResponse
    | Vetchium.Problem.OrgLogoConflictErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Remove the logo. Open to every plan. */
  @route("/remove")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:superadmin"
  )
  remove(@header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
