import "../../common/authentication.tsp";
import "../types.tsp";

namespace Vetchium.Orgs;

scalar OrgSessionToken extends Vetchium.Authentication.OpaqueToken;
scalar OrgLoginChallengeToken extends Vetchium.Authentication.OpaqueToken;

model AuthenticatedSessionResponse {
  session_token: OrgSessionToken;
  session_expires_at: utcDateTime;
  preferred_language: FrontendLocale;
}
