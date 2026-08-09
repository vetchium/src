import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../common/localization.tsp";
import "../../common/security-effects.tsp";
import "../../problem/admin/authentication.tsp";
import "../../problem/admin/authorization.tsp";
import "../../problem/admin/users.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../common/types.tsp";

using TypeSpec.Http;

namespace Vetchium.Admin;

/** Invite a regular admin with no initial permissions. */
model InviteUserRequest {
  /** Lowercased after surrounding whitespace is removed. */
  email_address: EmailAddress;
}

/** Metadata for a newly queued admin invitation. */
model InviteUserResponse {
  admin_invitation_id: AdminInvitationID;
  expires_at: utcDateTime;
}

/** Complete setup for an invited admin user. */
model CompleteSetupRequest {
  invitation_token: AdminInvitationToken;
  password: Vetchium.Authentication.NewPassword;

  /** Must have unique language codes and always encode as an array. */
  @minItems(1)
  @TypeSpec.OpenAPI.extension("x-vetchium-unique-by", "language_code")
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-primary-field",
    "primary_display_name_language"
  )
  display_names: LocalizedDisplayName[];

  /** Must identify one language_code in display_names. */
  primary_display_name_language: RegionalLanguageCode;

  /** When absent, the company default remains effective. */
  preferred_language?: LanguageCode;

  /** When absent, the company default remains effective. */
  preferred_timezone?: TimeZoneID;
}

/** Identity created after an invitation is consumed. */
model CompleteSetupResponse {
  admin_user_id: AdminUserID;
}

@route("/api/admin")
@tag("Admin invitations")
interface InvitationOperations {
  /**
   * Create an invitation and queue its email using company regional defaults.
   * The admin user is not created until setup completes.
   */
  @route("/invite-user")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "admin:manage_users"
  )
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-idempotency-replay-valid-until",
    "minimum-of-replay-window-and-invitation-expiry"
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
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.CreateAdminInvitation,
      Vetchium.SecurityEffect.QueueAdminInvitationEmail
    ]
  )
  inviteUser(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: InviteUserRequest,
  ):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: InviteUserResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.AdminPermissionRequiredErrorResponse
    | Vetchium.Problem.AdminUserAlreadyExistsErrorResponse
    | Vetchium.Problem.AdminInvitationAlreadyPendingErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Consume an invitation and create an active regular admin without a session. */
  @route("/complete-setup")
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
      Vetchium.SecurityEffect.ConsumeAdminInvitation,
      Vetchium.SecurityEffect.CreateAdminUser
    ]
  )
  completeSetup(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: CompleteSetupRequest,
  ):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: CompleteSetupResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidInvitationTokenErrorResponse
    | Vetchium.Problem.AdminUserAlreadyExistsErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
