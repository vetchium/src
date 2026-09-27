import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/idempotency.tsp";
import "../../common/security-effects.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/signup.tsp";
import "../types.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs;

scalar OrgSignupToken extends Vetchium.Authentication.OpaqueToken;

/** The claimed domain is exactly the email address's domain. */
model RequestSignupRequest {
  email_address: EmailAddress;
  preferred_language: FrontendLocale;
}

model GetSignupDetailsRequest {
  signup_token: OrgSignupToken;
}

/** The TXT record the Org must publish, repeated from the emailed
 * instructions. */
model SignupDetailsResponse {
  domain: OrgDomain;
  dns_record_name: string;
  dns_record_value: string;
  expires_at: utcDateTime;
}

model CompleteSignupRequest {
  signup_token: OrgSignupToken;
  org_display_name: DisplayName;
  password: Vetchium.Authentication.NewPassword;
}

model CompleteSignupResponse {
  domain: OrgDomain;
}

model SignupCompletionPendingResponse {
  @format("uuid")
  operation_id: string;
}

@route("/api/orgs")
@tag("Org signup")
interface SignupOperations {
  /** Send the DNS instructions and the private signup link. The response
   * reveals neither token, and is the same whether or not the address already
   * has a pending signup. */
  @route("/request-signup")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 86400)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.CreateOrgSignup,
      Vetchium.SecurityEffect.QueueOrgSignupEmail
    ]
  )
  requestSignup(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: RequestSignupRequest,
  ):
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgSignupUnavailableErrorResponse
    | Vetchium.Problem.OrgSignupDomainBlockedErrorResponse
    | Vetchium.Problem.OrgDomainAlreadyOwnedErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse
    | Vetchium.Problem.OrgDirectoryUnavailableErrorResponse;

  @route("/get-signup-details")
  @post
  getSignupDetails(@body request: GetSignupDetailsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: SignupDetailsResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidOrgSignupTokenErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Look up the TXT record live, then create the Org, its verified domain,
   * and its first superadmin. A missing record leaves the signup usable. */
  @route("/complete-signup")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 604800)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-security-effects",
    #[
      Vetchium.SecurityEffect.ConsumeOrgSignup,
      Vetchium.SecurityEffect.CreateOrgUser
    ]
  )
  completeSignup(
    @header("Idempotency-Key") idempotency_key: IdempotencyKey,
    @body request: CompleteSignupRequest,
  ):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: CompleteSignupResponse;
      }
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: SignupCompletionPendingResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidOrgSignupTokenErrorResponse
    | Vetchium.Problem.OrgSignupUnavailableErrorResponse
    | Vetchium.Problem.OrgSignupDomainBlockedErrorResponse
    | Vetchium.Problem.OrgDomainAlreadyOwnedErrorResponse
    | Vetchium.Problem.OrgDNSRecordNotFoundErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse
    | Vetchium.Problem.OrgDirectoryUnavailableErrorResponse;
}
