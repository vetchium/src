import "@typespec/http";
import "@typespec/openapi";

import "../../common/common.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../authorization/types.tsp";
import "../types.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs;

/** A suspended Org lost its only domain and may only restore it. */
enum OrgState {
  Active: "active",
  Suspended: "suspended",
}

/** verified and failing Orgs own the domain; a released domain is no longer
 * owned and may be claimed again by any Org that proves it. */
enum DomainVerificationState {
  Verified: "verified",
  Failing: "failing",
  Released: "released",
}

model DomainStatus {
  domain: OrgDomain;
  state: DomainVerificationState;
  dns_record_name: string;
  dns_record_value: string;
  last_verified_at: utcDateTime;

  /** Set while failing. */
  failing_since: utcDateTime | null;

  /** When a failing domain will be released unless the record returns. */
  release_after: utcDateTime | null;
}

model OrgSummary {
  display_name: DisplayName;
  org_state: OrgState;
  domain: DomainStatus;
}

model MyInfoResponse {
  email_address: EmailAddress;
  preferred_language: FrontendLocale;

  /** Effective permissions, including permissions implied by other grants. */
  permissions: OrgPermissionID[];

  org: OrgSummary;
}

/** The outcome of this lookup. inconclusive means the DNS query failed and
 * nothing changed. */
enum DomainCheckResult {
  Present: "present",
  Absent: "absent",
  Inconclusive: "inconclusive",
}

model CheckDomainResponse {
  check_result: DomainCheckResult;
  org: OrgSummary;
}

@route("/api/orgs")
@tag("Org account")
interface AccountOperations {
  @route("/my-info")
  @get
  @useAuth(BearerAuth)
  myInfo():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: MyInfoResponse;
      }
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Look up the domain's TXT record now instead of waiting for the next
   * scheduled check. A present record restores a failing domain, and re-claims
   * a released one for a suspended Org if no other Org has claimed it. */
  @route("/check-domain")
  @post
  @useAuth(BearerAuth)
  checkDomain():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: CheckDomainResponse;
      }
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgPermissionRequiredErrorResponse
    | Vetchium.Problem.RateLimitExceededErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
