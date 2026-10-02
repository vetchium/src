import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../authorization/types.tsp";
import "../subscriptions/plans.tsp";
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

enum OrgBillingNoticeKind {
  /** An invoice is unpaid; users may be disabled at `at`. Shown to everyone. */
  PastDue: "past-due",

  /** A scheduled change will lower the plan at `at`. Billing holders only. */
  SubscriptionEnding: "subscription-ending",
}

model OrgBillingNotice {
  kind: OrgBillingNoticeKind;

  /** The deadline for `past-due`; the end of the period for
   * `subscription-ending`. */
  at: utcDateTime;

  /** The plan that takes effect at `at`. Only for `subscription-ending`. */
  scheduled_plan_oid?: OrgPlanOID;

  /** True when the notice is inside its final-week banner window. Always true
   * for `past-due`. */
  banner: boolean;
}

model MyInfoResponse {
  email_address: EmailAddress;
  preferred_language: FrontendLocale;

  /** Effective permissions, including permissions implied by other grants. */
  permissions: OrgPermissionID[];

  totp_enabled: boolean;
  recovery_codes_remaining: Vetchium.Authentication.TOTPRecoveryCodeCount;

  /** When this session last completed full authentication, so the portal can
   * ask for step-up before a credential change rather than after a refusal. */
  session_authenticated_at: utcDateTime;

  org: OrgSummary;
  plan_oid: OrgPlanOID;

  /** Present while the Org is past due, and for a billing holder while a
   * plan-lowering change is scheduled. */
  billing_notice?: OrgBillingNotice;
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
