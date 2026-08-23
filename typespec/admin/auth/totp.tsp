import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/idempotency.tsp";
import "../../common/security-effects.tsp";
import "../../problem/admin/authentication.tsp";
import "../../problem/admin/totp.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "./types.tsp";

using TypeSpec.Http;

namespace Vetchium.Admin;

/** Sensitive material for provisioning a pending TOTP authenticator. */
model StartTOTPEnrollmentResponse {
  totp_enrollment_token: Vetchium.Authentication.TOTPEnrollmentToken;
  provisioning_uri: url;
  manual_entry_key: Vetchium.Authentication.TOTPManualEntryKey;
  configuration: Vetchium.Authentication.TOTPConfiguration;
  expires_at: utcDateTime;
}

/** Confirm a pending enrollment by proving the authenticator was configured. */
model ConfirmTOTPEnrollmentRequest {
  totp_enrollment_token: Vetchium.Authentication.TOTPEnrollmentToken;
  totp_code: Vetchium.Authentication.TOTPCode;
}

/** Recovery credentials returned exactly once when TOTP becomes active. */
model ConfirmTOTPEnrollmentResponse {
  @minItems(10)
  @maxItems(10)
  recovery_codes: Vetchium.Authentication.TOTPRecoveryCode[];
}

/** Finish a TOTP-required login when the authenticator is unavailable. */
model VerifyRecoveryCodeRequest {
  login_challenge_token: AdminLoginChallengeToken;
  recovery_code: Vetchium.Authentication.TOTPRecoveryCode;
}

/** An authenticated session plus the recovery-code inventory after use. */
model VerifyRecoveryCodeResponse {
  ...AuthenticatedSessionResponse;
  remaining_recovery_codes: Vetchium.Authentication.TOTPRecoveryCodeCount;
}

/** Newly generated recovery credentials returned exactly once. */
model RegenerateTOTPRecoveryCodesResponse {
  @minItems(10)
  @maxItems(10)
  recovery_codes: Vetchium.Authentication.TOTPRecoveryCode[];
}

@route("/api/admin")
@tag("Admin TOTP")
interface TOTPOperations {
  /**
   * Begin a ten-minute TOTP enrollment using a recently authenticated session.
   * The empty request makes every same-binding idempotency retry an exact replay.
   */
  @route("/start-totp-enrollment")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 600)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-replay-valid-until",
    "minimum-of-replay-window-and-enrollment-expiry"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "authenticated-principal",
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
      Vetchium.SecurityEffect.InvalidateTOTPEnrollments,
      Vetchium.SecurityEffect.CreateTOTPEnrollment
    ]
  )
  startTOTPEnrollment(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: StartTOTPEnrollmentResponse;
      }
    | Vetchium.Problem.AdminAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.TOTPAlreadyEnabledErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * Confirm enrollment, enable TOTP, and return ten recovery codes. Success
   * consumes the enrollment, so later confirmation attempts are invalid.
   */
  @route("/confirm-totp-enrollment")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 600)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "authenticated-principal",
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
      Vetchium.SecurityEffect.EnableTOTP,
      Vetchium.SecurityEffect.ConsumeTOTPEnrollment,
      Vetchium.SecurityEffect.InvalidateLoginChallenges,
      Vetchium.SecurityEffect.RevokeOtherSessions,
      Vetchium.SecurityEffect.GenerateRecoveryCodes
    ]
  )
  confirmTOTPEnrollment(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: ConfirmTOTPEnrollmentRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ConfirmTOTPEnrollmentResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InvalidTOTPEnrollmentErrorResponse
    | Vetchium.Problem.IncorrectTOTPCodeErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Consume one recovery code to finish a TOTP-required login. */
  @route("/login/recovery-code")
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
      Vetchium.SecurityEffect.ConsumeRecoveryCode
    ]
  )
  verifyRecoveryCode(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: VerifyRecoveryCodeRequest,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: VerifyRecoveryCodeResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidLoginChallengeErrorResponse
    | Vetchium.Problem.IncorrectRecoveryCodeErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Disable TOTP using a recently fully authenticated session. */
  @route("/disable-totp")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.DisableTOTP,
      Vetchium.SecurityEffect.InvalidateRecoveryCodes,
      Vetchium.SecurityEffect.InvalidateTOTPEnrollments,
      Vetchium.SecurityEffect.InvalidateLoginChallenges,
      Vetchium.SecurityEffect.RevokeOtherSessions
    ]
  )
  disableTOTP():
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.AdminAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * Replace every recovery code using a recently authenticated session. The
   * empty request makes every same-binding idempotency retry an exact replay.
   */
  @route("/regenerate-totp-recovery-codes")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 300)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-binding",
    #[
      "operation",
      "authenticated-principal",
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
      Vetchium.SecurityEffect.InvalidateRecoveryCodes,
      Vetchium.SecurityEffect.InvalidateLoginChallenges,
      Vetchium.SecurityEffect.RevokeOtherSessions
    ]
  )
  regenerateTOTPRecoveryCodes(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: RegenerateTOTPRecoveryCodesResponse;
      }
    | Vetchium.Problem.AdminAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.TOTPNotEnabledErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
