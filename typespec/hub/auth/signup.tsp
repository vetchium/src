import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../common/localization.tsp";
import "../../common/security-effects.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/signup.tsp";
import "../types.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub;

scalar HubSignupToken extends Vetchium.Authentication.OpaqueToken;

model RequestSignupRequest {
  email_address: EmailAddress;
  display_name: DisplayName;
  preferred_language: FrontendLocale;
  resident_country: CountryCode;
}

model CompleteSignupRequest {
  signup_token: HubSignupToken;
  password: Vetchium.Authentication.NewPassword;
}

model CompleteSignupResponse {
  hub_user_did: HubUserDID;
  handle: HubHandle;
}

@route("/api/hub")
@tag("Hub signup")
interface SignupOperations {
  /** Queue a localized email-address verification link for an allowed domain. */
  @route("/request-signup")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.CreateHubSignup,
      Vetchium.SecurityEffect.QueueHubSignupEmail
    ]
  )
  requestSignup(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: RequestSignupRequest,
  ):
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubSignupDomainNotAllowedErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Consume the emailed token and create a Hub profile and password. */
  @route("/complete-signup")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.ConsumeHubSignup,
      Vetchium.SecurityEffect.CreateHubUser
    ]
  )
  completeSignup(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: CompleteSignupRequest,
  ):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: CompleteSignupResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidHubSignupTokenErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
