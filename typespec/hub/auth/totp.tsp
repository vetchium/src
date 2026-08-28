import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/idempotency.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/totp.tsp";
import "./types.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub;

model StartTOTPEnrollmentResponse {
  totp_enrollment_token: Vetchium.Authentication.TOTPEnrollmentToken;
  provisioning_uri: url;
  manual_entry_key: Vetchium.Authentication.TOTPManualEntryKey;
  configuration: Vetchium.Authentication.TOTPConfiguration;
  expires_at: utcDateTime;
}

model ConfirmTOTPEnrollmentRequest {
  totp_enrollment_token: Vetchium.Authentication.TOTPEnrollmentToken;
  totp_code: Vetchium.Authentication.TOTPCode;
}

model ConfirmTOTPEnrollmentResponse {
  @minItems(10)
  @maxItems(10)
  recovery_codes: Vetchium.Authentication.TOTPRecoveryCode[];
}

model VerifyRecoveryCodeRequest {
  login_challenge_token: HubLoginChallengeToken;
  recovery_code: Vetchium.Authentication.TOTPRecoveryCode;
}

model VerifyRecoveryCodeResponse {
  ...AuthenticatedSessionResponse;
  remaining_recovery_codes: Vetchium.Authentication.TOTPRecoveryCodeCount;
}

model RegenerateTOTPRecoveryCodesResponse {
  @minItems(10)
  @maxItems(10)
  recovery_codes: Vetchium.Authentication.TOTPRecoveryCode[];
}

@route("/api/hub")
@tag("Hub TOTP")
interface TOTPOperations {
  @route("/start-totp-enrollment")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 600)
  startTOTPEnrollment(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: StartTOTPEnrollmentResponse;
      }
    | Vetchium.Problem.HubAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.HubTOTPAlreadyEnabledErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/confirm-totp-enrollment")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 600)
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
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InvalidHubTOTPEnrollmentErrorResponse
    | Vetchium.Problem.IncorrectHubTOTPCodeErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/login/recovery-code")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 300)
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
    | Vetchium.Problem.InvalidHubLoginChallengeErrorResponse
    | Vetchium.Problem.IncorrectHubRecoveryCodeErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/disable-totp")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  disableTOTP():
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.HubAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/regenerate-totp-recovery-codes")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension("x-vetchium-max-auth-age-seconds", 300)
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 300)
  regenerateTOTPRecoveryCodes(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
  ):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: RegenerateTOTPRecoveryCodesResponse;
      }
    | Vetchium.Problem.HubAuthenticationOrRecentRequiredErrorResponse
    | Vetchium.Problem.HubTOTPNotEnabledErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
