import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// Domain Verification Token - secret expected in DNS TXT record
scalar DomainVerificationToken extends string;

// Domain verification status enum
enum DomainVerificationStatus {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  FAILING: "FAILING",
}

// Constants for domain verification
// TOKEN_EXPIRY_DAYS = 7
// VERIFICATION_INTERVAL_DAYS = 60
// GRACE_PERIOD_DAYS = 14
// MAX_CONSECUTIVE_FAILURES = 3

// ============================================
// Domain Verification Flow
// ============================================

model ClaimDomainRequest {
  @doc("Root domain to claim (e.g., example.com)")
  domain: DomainName;
}

model ClaimDomainResponse {
  @doc("The claimed domain")
  domain: string;

  @doc("Verification token to add as DNS TXT record")
  verification_token: DomainVerificationToken;

  @doc("When the verification token expires")
  expires_at: utcDateTime;

  @doc("Instructions for DNS setup")
  instructions: string;
}

model VerifyDomainRequest {
  @doc("Domain to verify")
  domain: DomainName;
}

model VerifyDomainResponse {
  @doc("Current verification status")
  status: DomainVerificationStatus;

  @doc("When the domain was verified (if VERIFIED)")
  verified_at?: utcDateTime;

  @doc("Human-readable message about verification result")
  message?: string;
}

model GetDomainStatusRequest {
  @doc("Domain to get status for")
  domain: DomainName;
}

model GetDomainStatusResponse {
  @doc("The domain")
  domain: string;

  @doc("Current verification status")
  status: DomainVerificationStatus;

  @doc("Verification token (visible only if PENDING or FAILING)")
  verification_token?: DomainVerificationToken;

  @doc("When the verification token expires (if PENDING)")
  expires_at?: utcDateTime;

  @doc("When the domain was last verified (if VERIFIED)")
  last_verified_at?: utcDateTime;
}

// ============================================
// API Interfaces
// ============================================

@route("/org/claim-domain")
interface OrgClaimDomain {
  @tag("OrgDomains")
  @post
  @doc("Claim a domain for verification. Requires authenticated session.")
  claimDomain(@body request: ClaimDomainRequest):
    | {
        @statusCode statusCode: 201;
        @body response: ClaimDomainResponse;
      }
    | {
        @doc("Invalid domain format or validation errors")
        @statusCode
        statusCode: 400;
      }
    | {
        @doc("Invalid or expired session token")
        @statusCode
        statusCode: 401;
      }
    | {
        @doc("Domain already claimed by another employer")
        @statusCode
        statusCode: 409;
      };
}

@route("/org/verify-domain")
interface OrgVerifyDomain {
  @tag("OrgDomains")
  @post
  @doc("Trigger manual DNS verification for a claimed domain.")
  verifyDomain(@body request: VerifyDomainRequest):
    | {
        @statusCode statusCode: 200;
        @body response: VerifyDomainResponse;
      }
    | {
        @doc("Invalid domain format or validation errors")
        @statusCode
        statusCode: 400;
      }
    | {
        @doc("Invalid or expired session token")
        @statusCode
        statusCode: 401;
      }
    | {
        @doc("Domain not found or not owned by this employer")
        @statusCode
        statusCode: 404;
      };
}

@route("/org/get-domain-status")
interface OrgGetDomainStatus {
  @tag("OrgDomains")
  @post
  @doc("Get current verification status of a claimed domain.")
  getDomainStatus(@body request: GetDomainStatusRequest):
    | {
        @statusCode statusCode: 200;
        @body response: GetDomainStatusResponse;
      }
    | {
        @doc("Invalid domain format or validation errors")
        @statusCode
        statusCode: 400;
      }
    | {
        @doc("Invalid or expired session token")
        @statusCode
        statusCode: 401;
      }
    | {
        @doc("Domain not found or not owned by this employer")
        @statusCode
        statusCode: 404;
      };
}
