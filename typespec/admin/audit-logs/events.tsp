import "@typespec/http";
import "@typespec/openapi";
import "../../common/common.tsp";
import "../../common/pagination.tsp";
import "../../hub/types.tsp";
import "../hub-signup-domains/domains.tsp";
import "../../problem/admin/authentication.tsp";
import "../../problem/admin/authorization.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
using TypeSpec.Http;
namespace Vetchium.Admin.AuditLogs;

/** UTC Z timestamps, inclusive bounds, at most 31 elapsed days. At least one
 * identity is mandatory. Exact normalized filters combine with AND and match
 * both actors and affected identities in the current tenant. Operational
 * email delivery and housekeeping events are excluded. */
model ListRequest {
  start_at: utcDateTime;
  end_at: utcDateTime;
  hub_handle?: Vetchium.Hub.HubHandle;
  hub_email?: Vetchium.EmailAddress;
  org_domain?: Vetchium.Admin.HubSignupDomains.DomainName;
  org_user_email?: Vetchium.EmailAddress;
  limit?: Vetchium.PageSize = 50;
  pagination_key?: Vetchium.PaginationKey;
}
/** Explicitly allowed non-sensitive details, never arbitrary audit JSON. */
model Detail {
  field: string;
  value: string;
}
model Event {
  audit_event_id: string;
  created_at: utcDateTime;
  action: string;
  entity_type: string;
  actor_type: string;
  actor_name?: string;
  source: string;
  details: Detail[];
}
model ListResponse {
  events: Event[];
  next_pagination_key?: Vetchium.PaginationKey;
}
@route("/api/admin")
@tag("Admin audit logs")
interface Operations {
  @route("/list-audit-events")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "admin:view_audit_logs"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["normalized-filters", "created_at", "audit_event_id"]
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
}
