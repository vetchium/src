import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../common/security-effects.tsp";
import "../../problem/admin/authentication.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../common/types.tsp";

using TypeSpec.Http;

namespace Vetchium.Admin;

/** A non-enumerating request to queue an admin password-reset email. */
model RequestPasswordResetRequest {
  /** Lowercased after surrounding whitespace is removed. */
  email_address: EmailAddress;
}

/** A one-time reset credential and replacement password. */
model CompletePasswordResetRequest {
  reset_token: AdminPasswordResetToken;
  new_password: Vetchium.Authentication.NewPassword;
}

/** A replacement password authorized by a recently authenticated session. */
model ChangePasswordRequest {
  new_password: Vetchium.Authentication.NewPassword;
}

@route("/api/admin")
@tag("Admin password management")
interface PasswordOperations {
  /**
   * Queue a password-reset email when the normalized email belongs to an
   * eligible user. Every structurally valid request returns the same response.
   */
  @route("/request-password-reset")
  @post
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.InvalidatePasswordResetTokens,
      Vetchium.SecurityEffect.CreatePasswordResetToken,
      Vetchium.SecurityEffect.QueuePasswordResetEmail
    ]
  )
  requestPasswordReset(@body request: RequestPasswordResetRequest):
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Consume a reset token, replace the password, and revoke sessions. */
  @route("/complete-password-reset")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "one-time-credential-identity",
      "canonical-request-digest",
      "idempotency-key"
    ]
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.RotatePassword,
      Vetchium.SecurityEffect.RevokeAllSessions,
      Vetchium.SecurityEffect.InvalidateLoginChallenges,
      Vetchium.SecurityEffect.InvalidatePasswordResetTokens
    ]
  )
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
    | Vetchium.Problem.InvalidPasswordResetTokenErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * Replace the password using a session whose full authentication completed
   * within the preceding five minutes. Other sessions are revoked.
   */
  @route("/change-password")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.RotatePassword,
      Vetchium.SecurityEffect.RevokeOtherSessions,
      Vetchium.SecurityEffect.InvalidateLoginChallenges,
      Vetchium.SecurityEffect.InvalidatePasswordResetTokens
    ]
  )
  changePassword(@body request: ChangePasswordRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
