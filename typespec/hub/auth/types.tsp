import "../../common/authentication.tsp";
import "../../common/localization.tsp";
import "../types.tsp";

namespace Vetchium.Hub;

scalar HubSessionToken extends Vetchium.Authentication.OpaqueToken;
scalar HubLoginChallengeToken extends Vetchium.Authentication.OpaqueToken;

model AuthenticatedSessionResponse {
  session_token: HubSessionToken;
  session_expires_at: utcDateTime;
  preferred_language: FrontendLocale;
  resident_country: CountryCode;
  hub_user_did: HubUserDID;
  handle: HubHandle;
}
