import "@typespec/http";
import "@typespec/openapi";
import "../../common/pagination.tsp";
import "../../orgs/types.tsp";
import "../../orgs/ai/types.tsp";
import "../../problem/admin/ai-usage.tsp";
import "../../problem/admin/authentication.tsp";
import "../../problem/admin/authorization.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
using TypeSpec.Http;
namespace Vetchium.Admin.AIUsage;

model ListOrgAIUsageRequest {
  org_domain: Vetchium.Orgs.OrgDomain;
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: Vetchium.PageSize = 50;
}

model ListOrgAIUsageResponse {
  entries: Vetchium.Orgs.AI.AIUsage[];
  next_pagination_key?: Vetchium.PaginationKey;
}

model GetOrgAIUsageTextRequest {
  org_domain: Vetchium.Orgs.OrgDomain;
  usage_id: Vetchium.Orgs.AI.AIUsageID;
}

@route("/api/admin")
@tag("Admin AI usage")
interface Operations {
  /** An Org of this tenant's AI usage, newest first. */
  @route("/list-org-ai-usage")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "admin:view_ai_usage"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-consistency",
    "live-best-effort"
  )
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-pagination-key-binds",
    #["org_domain", "created_at", "usage_id"]
  )
  list(@body request: ListOrgAIUsageRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListOrgAIUsageResponse;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.AdminPermissionRequiredErrorResponse
    | Vetchium.Problem.AdminOrgNotFoundErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  /** One kept prompt and answer. Every successful read writes an audit
   * event. */
  @route("/get-org-ai-usage-text")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "admin:view_ai_usage"
  )
  getText(@body request: GetOrgAIUsageTextRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Orgs.AI.AIUsageText;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.AdminAuthenticationRequiredErrorResponse
    | Vetchium.Problem.AdminPermissionRequiredErrorResponse
    | Vetchium.Problem.AdminAIUsageNotFoundErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
