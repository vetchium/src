import "../../common/authentication.tsp";
import "../../common/localization.tsp";

namespace Vetchium.Admin;

/** An opaque bearer token for an authenticated admin session. */
scalar AdminSessionToken extends Vetchium.Authentication.OpaqueToken;

/** An opaque, short-lived credential for finishing an admin login. */
scalar AdminLoginChallengeToken extends Vetchium.Authentication.OpaqueToken;

/** Session and resolved regional preferences returned after authentication. */
model AuthenticatedSessionResponse {
  session_token: AdminSessionToken;
  session_expires_at: utcDateTime;
  effective_language: LanguageCode;
  effective_timezone: TimeZoneID;
}
