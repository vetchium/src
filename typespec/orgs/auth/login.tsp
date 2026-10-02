import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "./types.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs;

model LoginRequest {
  domain: OrgDomain;
  email_address: EmailAddress;
  password: Password;
}

model ReauthenticateRequest {
  password: Password;
}

model ReauthenticateResponse {
  session_authenticated_at: utcDateTime;
}

enum AuthenticationState {
  Authenticated: "authenticated",
  TOTPRequired: "totp_required",
}

model LoginAuthenticatedResponse {
  authentication_state: AuthenticationState.Authenticated;
  ...AuthenticatedSessionResponse;
}

model LoginTOTPRequiredResponse {
  authentication_state: AuthenticationState.TOTPRequired;
  login_challenge_token: OrgLoginChallengeToken;
  login_challenge_expires_at: utcDateTime;
}

@discriminated(#{
  envelope: "none",
  discriminatorPropertyName: "authentication_state",
})
union LoginResponse {
  authenticated: LoginAuthenticatedResponse,
  totp_required: LoginTOTPRequiredResponse,
}

model VerifyTFARequest {
  login_challenge_token: OrgLoginChallengeToken;
  totp_code: Vetchium.Authentication.TOTPCode;
}

union OptionalOrgBearerAuth {
  bearer: BearerAuth,
  anonymous: NoAuth,
}

@route("/api/orgs")
@tag("Org authentication")
interface LoginOperations {
  /** Authenticate only in the explicitly selected region. */
  @route("/login")
  @post
  login(@body request: LoginRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: LoginResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidOrgCredentialsErrorResponse
    | Vetchium.Problem.OrgUserDisabledErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/reauthenticate")
  @post
  @useAuth(BearerAuth)
  reauthenticate(@body request: ReauthenticateRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ReauthenticateResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.IncorrectOrgPasswordErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/login/tfa")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 300)
  verifyTFA(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: VerifyTFARequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AuthenticatedSessionResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidOrgLoginChallengeErrorResponse
    | Vetchium.Problem.IncorrectOrgTOTPCodeErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/logout")
  @post
  @useAuth(OptionalOrgBearerAuth)
  logout():
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InternalServerErrorResponse;
}
