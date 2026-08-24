import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../common/security-effects.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub;

scalar HubPasswordResetToken extends Vetchium.Authentication.OpaqueToken;

model RequestPasswordResetRequest {
  email_address: EmailAddress;
}

model CompletePasswordResetRequest {
  reset_token: HubPasswordResetToken;
  new_password: Vetchium.Authentication.NewPassword;
}

model ChangePasswordRequest {
  new_password: Vetchium.Authentication.NewPassword;
}

@route("/api/hub")
@tag("Hub password management")
interface PasswordOperations {
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
    | Vetchium.Problem.InvalidHubPasswordResetTokenErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

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
    | Vetchium.Problem.HubAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
