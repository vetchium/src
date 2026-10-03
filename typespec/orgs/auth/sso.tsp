import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/sso.tsp";
import "../types.tsp";
import "./types.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs;

scalar OrgSSOState extends Vetchium.Authentication.OpaqueToken;

model StartGoogleSignInRequest {
  domain: OrgDomain;
}

model StartGoogleSignInResponse {
  /** Where the browser goes next. The answer does not depend on the domain. */
  authorization_url: url;
}

model CompleteGoogleSignInRequest {
  state: OrgSSOState;

  /** The authorization code Google returned to the callback. */
  @minLength(1)
  @maxLength(4096)
  code: string;
}

@route("/api/orgs/sso/google")
@tag("Org authentication")
interface GoogleSignInOperations {
  /**
   * Begin a Google sign-in in the selected region. Authorization code flow
   * with PKCE and a nonce; the domain only selects the `hd` hint.
   */
  @route("/start")
  @post
  start(@body request: StartGoogleSignInRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: StartGoogleSignInResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgSSONotAvailableErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /**
   * Finish a Google sign-in. Skips Vetchium TOTP, since the Workspace
   * administrator's 2-Step Verification is the second factor. Every refusal
   * is the same `org-sso-sign-in-failed`, except a disabled user, which is
   * named as for the password sign-in. A suspended Org signs in as it does
   * with a password.
   */
  @route("/complete")
  @post
  complete(@body request: CompleteGoogleSignInRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AuthenticatedSessionResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgSSOSignInFailedErrorResponse
    | Vetchium.Problem.OrgUserDisabledErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
