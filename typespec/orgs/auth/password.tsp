import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../types.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs;

scalar OrgPasswordResetToken extends Vetchium.Authentication.OpaqueToken;

/** The same address may belong to users of several Orgs, so the domain
 * selects the Org. */
model RequestPasswordResetRequest {
  domain: OrgDomain;
  email_address: EmailAddress;
}

model CompletePasswordResetRequest {
  reset_token: OrgPasswordResetToken;
  new_password: Vetchium.Authentication.NewPassword;
}

model ChangePasswordRequest {
  new_password: Vetchium.Authentication.NewPassword;
}

@route("/api/orgs")
@tag("Org password management")
interface PasswordOperations {
  /** Answered identically whether or not the Org user exists. */
  @route("/request-password-reset")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  requestPasswordReset(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: RequestPasswordResetRequest,
  ):
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Replaces the password and revokes every session and pending login. */
  @route("/complete-password-reset")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  completePasswordReset(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: CompletePasswordResetRequest,
  ):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidOrgPasswordResetTokenErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Replaces the password and revokes every other session. */
  @route("/change-password")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  changePassword(@body request: ChangePasswordRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
