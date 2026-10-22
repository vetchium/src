import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/common.tsp";
import "../../common/pagination.tsp";
import "../../directory/directory.tsp";
import "../../hub/applications/applications.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../applications/applications.tsp";
import "../openings/types.tsp";
import "../types.tsp";
import "./contacts/contacts.tsp";
import "./engagements.tsp";
import "./work/work.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Marketplace;

@TypeSpec.OpenAPI.extension(
  "x-vetchium-known-values",
  #["suggested", "declared"]
)
scalar ReferralRoute extends string;

model CreditedAgency {
  engagement_id: EngagementID;
  domain: Vetchium.Orgs.OrgDomain;
  display_name: Vetchium.DisplayName;
}

model CreditedApplicationSummary {
  engagement_id: EngagementID;
  client: EngagementCounterparty;
  opening: Work.WorkOpening;
  application_number: Vetchium.Orgs.Applications.ApplicationNumber;
  route: ReferralRoute;
  status: Vetchium.Hub.Applications.ApplicationStatus;
  contact_id?: Contacts.ContactID;
  applicant_did?: Vetchium.Directory.PrincipalDID;
  applied_at: utcDateTime;
}

model ListCreditedApplicationsRequest {
  client_domain?: Vetchium.Orgs.OrgDomain;
  opening_number?: Vetchium.Orgs.Openings.OpeningNumber;
  route?: ReferralRoute;
  status?: Vetchium.Hub.Applications.ApplicationStatus;
  contact_id?: Contacts.ContactID;
  pagination_key?: Vetchium.PaginationKey;
  limit?: Work.WorkPageSize = 50;
}

model ListCreditedApplicationsResponse {
  items: CreditedApplicationSummary[];
  unavailable_tenants: Vetchium.Directory.TenantID[];
  next_pagination_key?: Vetchium.PaginationKey;
}

@route("/api/orgs")
@tag("Org agency attribution")
interface AttributionOperations {
  /** Lists the agency's credited applications across clients. */
  @route("/list-credited-applications")
  @post
  @useAuth(BearerAuth)
  @TypeSpec.OpenAPI.extension(
    "x-vetchium-required-permission",
    "org:fulfil_engagements"
  )
  listCreditedApplications(@body request: ListCreditedApplicationsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: ListCreditedApplicationsResponse;
      }
    | Work.WorkReadErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;
}
