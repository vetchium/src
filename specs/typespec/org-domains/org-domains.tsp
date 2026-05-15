import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

import "../common/common.tsp";

using TypeSpec.Http;

namespace Vetchium;

model ClaimDomainRequest {
  domain: DomainName;
}

model ClaimDomainResponse {
  domain: string;
  verification_token: string;
  expires_at: string;
  instructions: string;
}

model VerifyDomainRequest {
  domain: DomainName;
}

model VerifyDomainResponse {
  status: string;
  verified_at?: string;
  message?: string;
}

model GetDomainStatusRequest {
  domain: DomainName;
}

model GetDomainStatusResponse {
  domain: string;
  status: string;
  verification_token?: string;
  expires_at?: string;
  last_verified_at?: string;
  can_request_verification: boolean;
  last_attempted_at?: string;
  next_verification_allowed_at?: string;
}

model ListDomainStatusRequest {
  pagination_key?: string;
}

model ListDomainStatusItem {
  domain: string;
  status: string;
  verification_token?: string;
  expires_at?: string;
  last_verified_at?: string;
  can_request_verification: boolean;
  last_attempted_at?: string;
  next_verification_allowed_at?: string;
}

model ListDomainStatusResponse {
  domain_statuses: ListDomainStatusItem[];
  next_pagination_key?: string;
}

@route("/org")
interface OrgDomains {
  @route("/claim-domain") @post claimDomain(@body body: ClaimDomainRequest): ClaimDomainResponse | BadRequestResponse;
  @route("/verify-domain") @post verifyDomain(@body body: VerifyDomainRequest): VerifyDomainResponse | BadRequestResponse;
  @route("/get-domain-status") @post getDomainStatus(@body body: GetDomainStatusRequest): GetDomainStatusResponse | BadRequestResponse;
  @route("/list-domains") @post listDomains(@body body: ListDomainStatusRequest): ListDomainStatusResponse | BadRequestResponse;
}
