import "@typespec/http";
import "@typespec/openapi";

import "../../common/pagination.tsp";
import "../../problem/admin/authentication.tsp";
import "../../problem/admin/authorization.tsp";
import "../../problem/admin/hub-signup-domains.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../types.tsp";

using TypeSpec.Http;

namespace Vetchium.Admin.HubSignupDomains;

/**
 * Normalized by trimming, lowercasing ASCII, and removing one terminal dot.
 * Rejects wildcards, email and URL syntax, ports, IP addresses, single-label
 * names, and Unicode; internationalized domains use ASCII Punycode.
 */
@minLength(3)
@maxLength(253)
scalar DomainName extends string;

enum State {
  Active: "active",
  Disabled: "disabled",
}

/** Trimmed before storage; accepts Unicode. */
@minLength(1)
@maxLength(500)
scalar DisableComment extends string;

@minLength(1)
@maxLength(253)
@pattern("^[A-Za-z0-9.-]+$")
scalar DomainFilterText extends string;

model Domain {
  hub_signup_domain_id: Vetchium.Admin.HubSignupDomainID;
  domain: DomainName;
  state: State;

  /** Present exactly when state is disabled. */
  disabled_comment?: DisableComment;

  created_at: utcDateTime;
  updated_at: utcDateTime;
}

model ListRequest {
  limit?: Vetchium.PageSize = 50;
  pagination_key?: Vetchium.PaginationKey;

  /** Case-insensitive substring match. */
  filter_search?: DomainFilterText;

  filter_state?: State;
}

model ListResponse {
  domains: Domain[];
  next_pagination_key?: Vetchium.PaginationKey;
}

model CreateRequest {
  domain: DomainName;
  state?: State = State.Active;

  /** Required for disabled state and forbidden for active state. */
  disabled_comment?: DisableComment;
}

model UpdateRequest {
  hub_signup_domain_id: Vetchium.Admin.HubSignupDomainID;
  domain: DomainName;
  state: State;

  /** Required for disabled state and forbidden for active state. */
  disabled_comment?: DisableComment;
}

@route("/api/admin")
@tag("Admin Hub signup domain allowlist")
interface Operations {
  @route("/list-hub-signup-domains")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "admin:view_hub_signup_domains"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["normalized-filters", "created_at", "hub_signup_domain_id"]
  )
  list(@body request: ListRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.AdminPermissionRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/create-hub-signup-domain")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "admin:manage_hub_signup_domains"
  )
  create(@body request: CreateRequest):
    | {
        @statusCode status_code: 201;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Domain;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.AdminPermissionRequiredErrorResponse
    | Vetchium.Problem.HubSignupDomainAlreadyExistsErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** Disabling requires a comment; reactivation clears it. */
  @route("/update-hub-signup-domain")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "admin:manage_hub_signup_domains"
  )
  update(@body request: UpdateRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Domain;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.AdminPermissionRequiredErrorResponse
    | Vetchium.Problem.HubSignupDomainNotFoundErrorResponse
    | Vetchium.Problem.HubSignupDomainAlreadyExistsErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
