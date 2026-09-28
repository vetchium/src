import "@typespec/http";
import "@typespec/openapi";

import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../common/security-effects.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/email.tsp";
import "../operations/operations.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub;

@format("uuid")
scalar HubEmailChangeChallengeID extends string;

model RequestEmailChangeRequest {
  new_email_address: EmailAddress;
}

model EmailChangeChallenge {
  challenge_id: HubEmailChangeChallengeID;
  expires_at: utcDateTime;
}

model ConfirmEmailChangeRequest {
  challenge_id: HubEmailChangeChallengeID;

  @pattern("^[0-9]{6}$")
  code: string;
}

@route("/api/hub")
@tag("Hub account email")
interface EmailChangeOperations {
  /** Send a six-digit code to the proposed address. Any domain is accepted:
   * the signup domain allowlist governs admission only. An address that already
   * belongs to a Hub account gets the same response but no message, so the
   * response cannot be used to test whether an address is registered. */
  @route("/request-email-change")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.CreateEmailChangeChallenge,
      Vetchium.SecurityEffect.QueueEmailChangeEmail
    ]
  )
  requestEmailChange(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: RequestEmailChangeRequest,
  ):
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: EmailChangeChallenge;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.HubEmailChangeInProgressErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Only the session that requested the code may confirm it. A `202` means
   * the change is still being applied at the global directory; poll
   * `/api/hub/operations/status` and replay this request with the same
   * idempotency key for the resolved typed result. */
  @route("/confirm-email-change")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.ChangeAccountEmail,
      Vetchium.SecurityEffect.RevokeOtherSessions,
      Vetchium.SecurityEffect.InvalidateLoginChallenges,
      Vetchium.SecurityEffect.InvalidatePasswordResetTokens,
      Vetchium.SecurityEffect.QueueEmailChangeEmail
    ]
  )
  confirmEmailChange(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: ConfirmEmailChangeRequest,
  ):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Hub.Operations.PendingOperation;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubEmailChangeCodeRejectedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.HubEmailAddressUnavailableErrorResponse
    | Vetchium.Problem.HubEmailChangeInProgressErrorResponse
    | Vetchium.Problem.HubEmailChangeUnavailableErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
