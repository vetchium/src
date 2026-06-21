import "@typespec/http";
import "@typespec/rest";
import "../common/common.tsp";
import "../org/openings.tsp";

using TypeSpec.Http;
namespace Vetchium;

model HubOpeningCard {
  org_domain:              string;
  org_name:                string;
  opening_number:          int32;
  title:                   string;
  primary_city?:           string;
  employment_type:         EmploymentType;
  work_location_type:      WorkLocationType;
  first_published_at:      utcDateTime;
  colleague_count_here:    int32;
}

model HubListOpeningsRequest {
  filter_query?:              string;
  filter_employment_type?:    EmploymentType[];
  filter_work_location_type?: WorkLocationType[];
  filter_country?:            string;
  filter_min_yoe?:            int32;
  filter_tag_ids?:            string[];
  filter_only_with_colleagues?: boolean;
  filter_region?:             string;
  pagination_key?:            string;
  limit?:                     int32;
}

model HubListOpeningsResponse {
  openings:             HubOpeningCard[];
  next_pagination_key?: string;
}

model HubGetOpeningRequest {
  org_domain:    string;
  opening_number: int32;
}

model HubRecruitingAgency {
  agency_org_domain: string;
  agency_org_name:   string;
}

model HubOpeningDetail extends Opening {
  recruiting_agencies:     HubRecruitingAgency[];
  colleague_count_here:    int32;
  viewer_can_refer:        boolean;
  viewer_has_applied:      boolean;
}

model ListColleaguesAtEmployerRequest {
  org_domain:    string;
  pagination_key?: string;
  limit?:        int32;
}

model ColleagueAtEmployer {
  handle:                    Handle;
  display_name:              string;
  shared_domain:             string;
  overlap_start_year:        int32;
  overlap_end_year:          int32;
  current_employer_domain:   string;
  current_stint_started_at:  utcDateTime;
}

model ListColleaguesAtEmployerResponse {
  colleagues:           ColleagueAtEmployer[];
  next_pagination_key?: string;
}

model NetworkOpportunity {
  org_domain:                      string;
  org_name:                        string;
  colleague_count:                 int32;
  most_recent_colleague_started_at: utcDateTime;
  openings:                        HubOpeningCard[];
}

model ListNetworkOpportunitiesResponse {
  opportunities: NetworkOpportunity[];
}

@route("/hub/list-openings")
@post
op hubListOpenings(...HubListOpeningsRequest):
  OkResponse<HubListOpeningsResponse>;

@route("/hub/get-opening")
@post
op hubGetOpening(...HubGetOpeningRequest):
  OkResponse<HubOpeningDetail> | NotFoundResponse;

@route("/hub/list-colleagues-at-employer")
@post
op listColleaguesAtEmployer(...ListColleaguesAtEmployerRequest):
  OkResponse<ListColleaguesAtEmployerResponse> | NotFoundResponse;

@route("/hub/list-network-opportunities")
@post
op listNetworkOpportunities():
  OkResponse<ListNetworkOpportunitiesResponse>;
