import "../../common/localization.tsp";
import "../details.tsp";

namespace Vetchium.Problem;

const HubSignupDomainNotAllowedError = #{
  type: "vetchium-problem-details/hub-signup-domain-not-allowed",
  title: "Hub signup domain not allowed",
  status: 403,
  detail: "This tenant does not allow Hub signup with that email domain",
};
alias HubSignupDomainNotAllowedErrorResponse = Response<
  403,
  typeof HubSignupDomainNotAllowedError
>;

const InvalidHubSignupTokenError = #{
  type: "vetchium-problem-details/hub-invalid-signup-token",
  title: "Invalid Hub signup token",
  status: 401,
  detail: "Signup token is invalid, expired, consumed, or no longer eligible",
};
alias InvalidHubSignupTokenErrorResponse = AuthenticationResponse<
  "VetchiumSignup realm=\"hub\"",
  typeof InvalidHubSignupTokenError
>;

const HubSignupUnavailableError = #{
  type: "vetchium-problem-details/hub-signup-unavailable",
  title: "Hub signup unavailable",
  status: 403,
  detail: "This region is not accepting signup for your resident country. Choose another region.",
};
alias HubSignupUnavailableErrorResponse = Response<
  403,
  typeof HubSignupUnavailableError
>;

/** The account email is already registered at another tenant. Revealed only
 * at completion, once the caller has proven mailbox control: the request-time
 * response never distinguishes this from an unregistered address (GU-SIG-005).
 */
model HubAccountHomedElsewhereDetails {
  type: "vetchium-problem-details/hub-account-homed-elsewhere";
  title: "Hub account homed in another region";
  status: 409;
  detail: "This Hub account signs in at another region";

  /** The home region, which the portal selects for sign-in. */
  tenant_id: string;

  /** Where the home region is hosted, so a portal can name it in the
   * viewer's language. */
  hosting_country: Vetchium.CountryCode;

  instance?: string;
}
alias HubAccountHomedElsewhereErrorResponse = Response<
  409,
  HubAccountHomedElsewhereDetails
>;
