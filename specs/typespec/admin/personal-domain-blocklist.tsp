import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

model BlockedPersonalDomain {
  domain:     string;
  created_at: utcDateTime;
}

model AdminAddBlockedDomainRequest    { domain: string; }
model AdminRemoveBlockedDomainRequest { domain: string; }

model AdminListBlockedDomainsRequest {
  filter_domain_prefix?: string;
  pagination_key?:       string;
  limit?:                int32;
}

model AdminListBlockedDomainsResponse {
  domains:              BlockedPersonalDomain[];
  next_pagination_key?: string;
}

@route("/admin/list-blocked-personal-domains")
@post
op listBlockedDomains(...AdminListBlockedDomainsRequest): {
  @statusCode statusCode: 200;
  @body body: AdminListBlockedDomainsResponse;
} | BadRequestResponse;

@route("/admin/add-blocked-personal-domain")
@post
op addBlockedDomain(...AdminAddBlockedDomainRequest): {
  @statusCode statusCode: 201;
  @body body: BlockedPersonalDomain;
} | BadRequestResponse | ConflictResponse;

@route("/admin/remove-blocked-personal-domain")
@post
op removeBlockedDomain(...AdminRemoveBlockedDomainRequest): NoContentResponse | NotFoundResponse;
