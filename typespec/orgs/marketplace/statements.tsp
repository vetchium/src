import "@typespec/http";
import "@typespec/openapi";
import "../../common/authentication.tsp";
import "../../common/pagination.tsp";
import "../../problem/common.tsp";
import "../../problem/orgs/marketplace.tsp";
import "../openings/types.tsp";
import "../applications/applications.tsp";
import "./engagements.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Marketplace;

enum BillableFactKind {
  joined,
  separated,
  interview_completed,
  interview_no_show,
  assessment_result,
  background_check_outcome,
}

@pattern("^\\d{4}-(0[1-9]|1[0-2])$")
scalar StatementMonth extends string;

model ActivityStatementItem {
  fact_id: string;
  date: plainDate;
  fact: BillableFactKind;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
  opening_title: string;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
  applicant_display_name: string;
  corrected: boolean;
}

model GetActivityStatementRequest {
  engagement_id: EngagementID;
  month: StatementMonth;
  pagination_key?: Vetchium.PaginationKey;
  @minValue(1)
  @maxValue(100)
  limit?: int32 = 50;
}

model GetActivityStatementResponse {
  engagement_id: EngagementID;
  month: StatementMonth;
  items: ActivityStatementItem[];
  next_pagination_key?: Vetchium.PaginationKey;
}

interface StatementsOperations {
  /** Reads one engagement's monthly activity statement as the consumer. */
  @route("/get-engagement-statement")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_providers"
  )
  getEngagementStatement(@body request: GetActivityStatementRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: GetActivityStatementResponse;
      }
    | EngagementBaseErrors
    | Vetchium.Problem.OrgEngagementNotFoundErrorResponse;

  /** Reads one engagement's monthly activity statement as the provider; read live from the consumer tenant. */
  @route("/get-client-engagement-statement")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:manage_listings"
  )
  getClientEngagementStatement(@body request: GetActivityStatementRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: GetActivityStatementResponse;
      }
    | EngagementBaseErrors
    | Vetchium.Problem.OrgEngagementNotFoundErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse;
}
