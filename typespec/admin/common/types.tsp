import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/localization.tsp";

namespace Vetchium.Admin;

/** Languages currently supported throughout the admin portal. */
enum LanguageCode {
  EnglishUnitedStates: "en-US",
  GermanGermany: "de-DE",
  TamilIndia: "ta-IN",
}

/** An immutable admin-user identifier. */
@format("uuid")
scalar AdminUserID extends string;

/** An immutable admin-invitation identifier. */
@format("uuid")
scalar AdminInvitationID extends string;

/** An opaque bearer token for an authenticated admin session. */
scalar AdminSessionToken extends Vetchium.Authentication.OpaqueToken;

/** An opaque, short-lived credential for finishing an admin login. */
scalar AdminLoginChallengeToken extends Vetchium.Authentication.OpaqueToken;

/** An opaque credential delivered in an admin invitation email. */
scalar AdminInvitationToken extends Vetchium.Authentication.OpaqueToken;

/** An opaque credential delivered in an admin password-reset email. */
scalar AdminPasswordResetToken extends Vetchium.Authentication.OpaqueToken;

/** Session and resolved regional preferences returned after authentication. */
model AuthenticatedSessionResponse {
  session_token: AdminSessionToken;
  session_expires_at: utcDateTime;
  effective_language: LanguageCode;
  effective_timezone: TimeZoneID;
}
