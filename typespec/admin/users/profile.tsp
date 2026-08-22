import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/localization.tsp";
import "../../problem/admin/authentication.tsp";
import "../../problem/details.tsp";
import "../authorization/types.tsp";
import "../types.tsp";
import "../user/user.tsp";

using TypeSpec.Http;

namespace Vetchium.Admin;

/** Set the current admin's preferred user-interface locale. */
model SetPreferredLanguageRequest {
  preferred_language: FrontendLocale;
}

/** Set the current admin's professional display name. */
model SetDisplayNameRequest {
  display_name: DisplayName;
}

/** The authenticated admin, authorization, preferences, and current session. */
model MyInfoResponse {
  admin_user_id: AdminUserID;
  email_address: EmailAddress;
  display_name: DisplayName;
  state: Vetchium.Admin.User.State;
  ...AdminAuthorization;
  totp_enabled: boolean;

  /** Zero when TOTP is disabled. */
  recovery_codes_remaining: Vetchium.Authentication.TOTPRecoveryCodeCount;

  preferred_language: FrontendLocale;
  created_at: utcDateTime;

  /** When full authentication for the current session completed. */
  session_authenticated_at: utcDateTime;

  session_expires_at: utcDateTime;
  tenant_id: string;
}

@route("/api/admin")
@tag("Admin profile")
interface ProfileOperations {
  /** Return the current admin and session metadata. */
  @route("/my-info")
  @get
  @useAuth(BearerAuth)
  myInfo():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: MyInfoResponse;
      }
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Set the current admin's preferred user-interface locale. */
  @route("/set-preferred-language")
  @post
  @useAuth(BearerAuth)
  setPreferredLanguage(@body request: SetPreferredLanguageRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Set the current admin's professional display name. */
  @route("/set-display-name")
  @post
  @useAuth(BearerAuth)
  setDisplayName(@body request: SetDisplayNameRequest):
    | {
        @statusCode status_code: 204;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
