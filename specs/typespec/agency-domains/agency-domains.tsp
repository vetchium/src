import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

// Agency Domain Verification Token - secret expected in DNS TXT record
scalar AgencyDomainVerificationToken extends string;

// Agency domain verification status enum
enum AgencyDomainVerificationStatus {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  FAILING: "FAILING",
}

// Constants for agency domain verification
// AGENCY_VERIFICATION_COOLDOWN_MINUTES = 60  (1 hour rate limit between verification requests)

// ============================================
// Agency Domain Verification Flow
// ============================================

model AgencyClaimDomainRequest {
  @doc("Root domain to claim (e.g., example.com)")
  domain: DomainName;
}

model AgencyClaimDomainResponse {
  @doc("The claimed domain")
  domain: string;

  @doc("Verification token to add as DNS TXT record")
  verification_token: AgencyDomainVerificationToken;

  @doc("When the verification token expires")
  expires_at: utcDateTime;

  @doc("Instructions for DNS setup")
  instructions: string;
}

model AgencyVerifyDomainRequest {
  @doc("Domain to verify")
  domain: DomainName;
}

model AgencyVerifyDomainResponse {
  @doc("Current verification status")
  status: AgencyDomainVerificationStatus;

  @doc("When the domain was verified (if VERIFIED)")
  verified_at?: utcDateTime;

  @doc("Human-readable message about verification result")
  message?: string;
}

model AgencyGetDomainStatusRequest {
  @doc("Domain to get status for")
  domain: DomainName;
}

model AgencyGetDomainStatusResponse {
  @doc("The domain")
  domain: string;

  @doc("Current verification status")
  status: AgencyDomainVerificationStatus;

  @doc("Verification token (visible only if PENDING or FAILING)")
  verification_token?: AgencyDomainVerificationToken;

  @doc("When the verification token expires (if PENDING)")
  expires_at?: utcDateTime;

  @doc("When the domain was last verified (if VERIFIED)")
  last_verified_at?: utcDateTime;

  @doc("Whether the user can request a verification now (server-controlled rate limit)")
  can_request_verification: boolean;

  @doc("When verification was last requested (present if a request was ever made)")
  last_attempted_at?: utcDateTime;

  @doc("Earliest time the next verification request is allowed (present only when !can_request_verification)")
  next_verification_allowed_at?: utcDateTime;
}

model AgencyListDomainStatusRequest {
  @doc("Pagination cursor (domain name of the last item from previous page)")
  pagination_key?: string;
}

model AgencyListDomainStatusItem {
  @doc("The domain name")
  domain: string;

  @doc("Current verification status")
  status: AgencyDomainVerificationStatus;

  @doc("Verification token (visible only if PENDING or FAILING)")
  verification_token?: AgencyDomainVerificationToken;

  @doc("When the verification token expires (if PENDING)")
  expires_at?: utcDateTime;

  @doc("When the domain was last verified (if VERIFIED)")
  last_verified_at?: utcDateTime;

  @doc("Whether the user can request a verification now (server-controlled rate limit)")
  can_request_verification: boolean;

  @doc("When verification was last requested (present if a request was ever made)")
  last_attempted_at?: utcDateTime;

  @doc("Earliest time the next verification request is allowed (present only when !can_request_verification)")
  next_verification_allowed_at?: utcDateTime;
}

model AgencyListDomainStatusResponse {
  @doc("List of domains with their verification status")
  items: AgencyListDomainStatusItem[];

  @doc("Pagination cursor for the next page (absent if no more pages)")
  next_pagination_key?: string;
}

// ============================================
// API Interfaces
// ============================================

@route("/agency/claim-domain")
interface AgencyClaimDomain {
  @tag("AgencyDomains")
  @post
  @doc("Claim a domain for verification. Requires authenticated agency session.")
  claimDomain(@body request: AgencyClaimDomainRequest):
    | {
        @statusCode statusCode: 201;
        @body response: AgencyClaimDomainResponse;
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
        @doc("Domain already claimed by another agency")
        @statusCode
        statusCode: 409;
      };
}

@route("/agency/verify-domain")
interface AgencyVerifyDomain {
  @tag("AgencyDomains")
  @post
  @doc("Trigger manual DNS verification for a claimed agency domain.")
  verifyDomain(@body request: AgencyVerifyDomainRequest):
    | {
        @statusCode statusCode: 200;
        @body response: AgencyVerifyDomainResponse;
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
        @doc("Domain not found or not owned by this agency")
        @statusCode
        statusCode: 404;
      }
    | {
        @doc("Verification was recently requested; rate limit in effect")
        @statusCode
        statusCode: 429;
      };
}

@route("/agency/get-domain-status")
interface AgencyGetDomainStatus {
  @tag("AgencyDomains")
  @post
  @doc("Get current verification status of a claimed agency domain.")
  getDomainStatus(@body request: AgencyGetDomainStatusRequest):
    | {
        @statusCode statusCode: 200;
        @body response: AgencyGetDomainStatusResponse;
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
        @doc("Domain not found or not owned by this agency")
        @statusCode
        statusCode: 404;
      };
}

@route("/agency/list-domains")
interface AgencyListDomains {
  @tag("AgencyDomains")
  @post
  @doc("List all domains claimed by this agency with their verification status.")
  listDomains(@body request: AgencyListDomainStatusRequest):
    | {
        @statusCode statusCode: 200;
        @body response: AgencyListDomainStatusResponse;
      }
    | {
        @doc("Invalid or expired session token")
        @statusCode
        statusCode: 401;
      };
}
