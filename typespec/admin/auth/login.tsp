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

/** Credentials submitted to begin an admin login. */
model LoginRequest {
  /** Lowercased after surrounding whitespace is removed. */
  email_address: EmailAddress;

  /** Must be non-empty and is otherwise verified exactly as supplied. */
  password: Password;
}

/** A completed password-only login for an admin without TOTP. */
model LoginAuthenticatedResponse {
  authentication_state: "authenticated";
  ...AuthenticatedSessionResponse;
}

/** A password-authenticated login that still requires TOTP or recovery. */
model LoginTOTPRequiredResponse {
  authentication_state: "totp_required";
  login_challenge_token: AdminLoginChallengeToken;
  login_challenge_expires_at: utcDateTime;
  effective_language: LanguageCode;
  effective_timezone: TimeZoneID;
}

/** The next state after successful password authentication. */
@discriminated(#{
  envelope: "none",
  discriminatorPropertyName: "authentication_state",
})
union LoginResponse {
  authenticated: LoginAuthenticatedResponse,
  totp_required: LoginTOTPRequiredResponse,
}

/** Six-digit TOTP verification for a password-authenticated login challenge. */
model VerifyTFARequest {
  login_challenge_token: AdminLoginChallengeToken;
  totp_code: Vetchium.Authentication.TOTPCode;
}

/** Either a bearer session or no credentials may be supplied to logout. */
union OptionalAdminBearerAuth {
  bearer: BearerAuth,
  anonymous: NoAuth,
}

@route("/api/admin")
@tag("Admin authentication")
interface LoginOperations {
  /**
   * Authenticate an email address and password. Admins with confirmed TOTP
   * receive a five-minute login challenge instead of a session.
   */
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
    | Vetchium.Problem.InvalidCredentialsErrorResponse
    | Vetchium.Problem.AdminUserDisabledErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Finish a TOTP-required login with the current authenticator code. */
  @route("/login/tfa")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 300)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-replay-valid-until",
    "minimum-of-replay-window-and-returned-session-expiry"
  )
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
    "x-vetchium-idempotency-sensitive-replay",
    "encrypted-at-rest-and-never-retrievable-by-key-alone"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.ConsumeLoginChallenge,
      Vetchium.SecurityEffect.RejectTOTPReplay
    ]
  )
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
    | Vetchium.Problem.InvalidLoginChallengeErrorResponse
    | Vetchium.Problem.IncorrectTOTPCodeErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * Invalidate a supplied admin session. Missing, invalid, expired, or already
   * revoked credentials still produce the same idempotent success response.
   */
  @route("/logout")
  @post
  @useAuth(OptionalAdminBearerAuth)
  logout():
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InternalServerErrorResponse;
}
