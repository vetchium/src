import "@typespec/http";

import "../../common/authentication.tsp";
import "../../common/openings.tsp";
import "../../common/pagination.tsp";
import "../../orgs/types.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/openings.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Openings;

@minValue(1)
scalar OpeningNumber extends int32;

@minValue(1)
@maxValue(50)
scalar OpeningPageSize extends int32;

@minLength(2)
@maxLength(200)
scalar OpeningTitleQuery extends string;

model PublicOrg {
  domain: Vetchium.Orgs.OrgDomain;
  display_name: Vetchium.DisplayName;

  /** Where the Org is based. */
  country: Vetchium.CountryCode;

  logo_url?: url;
}

model PublicOpeningSummary {
  opening_number: OpeningNumber;
  title: string;
  employing_country: Vetchium.CountryCode;
  work_arrangement: Vetchium.OpeningWorkArrangement;
  employment_type: Vetchium.OpeningEmploymentType;
  first_published_at: utcDateTime;
}

model PublishedOpening {
  opening_number: OpeningNumber;
  state: "published";
  content: Vetchium.OpeningContent;
  first_published_at: utcDateTime;
  last_revised_at?: utcDateTime;
}

model NotAcceptingOpening {
  opening_number: OpeningNumber;
  state: "not_accepting";
  title: string;
}

alias PublicOpening = PublishedOpening | NotAcceptingOpening;

model ListOrgOpeningsRequest {
  domain: Vetchium.Orgs.OrgDomain;
  employing_country?: Vetchium.CountryCode;
  work_arrangement?: Vetchium.OpeningWorkArrangement;
  employment_type?: Vetchium.OpeningEmploymentType;
  title_query?: OpeningTitleQuery;
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 50. */
  limit?: OpeningPageSize = 50;
}

model ListOrgOpeningsResponse {
  org: PublicOrg;
  openings: PublicOpeningSummary[];
  next_pagination_key?: Vetchium.PaginationKey;
}

model GetOrgOpeningRequest {
  domain: Vetchium.Orgs.OrgDomain;
  opening_number: OpeningNumber;
}

model GetOrgOpeningResponse {
  org: PublicOrg;
  opening: PublicOpening;
}

alias PublicOrgReadErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.HubOrgNotFoundErrorResponse
  | Vetchium.Problem.HubOrgUnavailableErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias ListOrgOpeningsResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: ListOrgOpeningsResponse;
    }
  | PublicOrgReadErrors
  | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

alias GetOrgOpeningResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: GetOrgOpeningResponse;
    }
  | PublicOrgReadErrors
  | Vetchium.Problem.HubOpeningNotFoundErrorResponse;

@route("/api/hub")
@tag("Hub Org Openings")
interface OrgOpeningOperations {
  @route("/list-org-openings")
  @post
  @useAuth(BearerAuth)
  list(@body request: ListOrgOpeningsRequest):
    | ListOrgOpeningsResult
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse;

  @route("/get-org-opening")
  @post
  @useAuth(BearerAuth)
  get(@body request: GetOrgOpeningRequest):
    | GetOrgOpeningResult
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse;
}
