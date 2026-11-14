import "@typespec/http";

import "../../common/authentication.tsp";
import "../../common/localization.tsp";
import "../../common/opening_tags.tsp";
import "../../common/openings.tsp";
import "../../common/pagination.tsp";
import "../../directory/directory.tsp";
import "../../orgs/types.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/global-coordinator/authentication.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/openings.tsp";
import "../types.tsp";
import "./public.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Openings;

/** Counted in code points after trimming. */
@minLength(2)
@maxLength(200)
scalar OpeningSearchKeyword extends string;

/** Counted in code points after trimming. */
@minLength(2)
@maxLength(100)
scalar OrgSuggestionQuery extends string;

@minValue(1)
@maxValue(50)
scalar OpeningSearchPageSize extends int32;

@minValue(0)
@maxValue(50)
scalar OpeningSearchExperienceYears extends int32;

/**
 * The filters of one Opening search (OPN-SRCH-004), each optional and
 * combined with AND. List items are unique.
 */
model OpeningSearchFilters {
  /** A case-insensitive substring of the live title or the Org display name. */
  keyword?: OpeningSearchKeyword;

  org_domain?: Vetchium.Orgs.OrgDomain;

  /** Match any; an OID missing from the catalog matches nothing. */
  @minItems(1)
  @maxItems(5)
  tag_oids?: Vetchium.OpeningTagOID[];

  /** Where the caller may work. */
  @minItems(1)
  @maxItems(10)
  work_countries?: Vetchium.CountryCode[];

  @minItems(1)
  @maxItems(3)
  work_arrangements?: Vetchium.OpeningWorkArrangement[];

  @minItems(1)
  @maxItems(4)
  employment_types?: Vetchium.OpeningEmploymentType[];

  /** First published within this many days. */
  posted_within_days?: 1 | 7 | 30;

  experience_years?: OpeningSearchExperienceYears;

  /** The caller's highest education level. */
  education_level?: Vetchium.OpeningEducation;

  /** `true` limits to Openings with a salary; `false` does not filter. */
  salary_disclosed?: boolean;

  /**
   * Binds every filter, the sort, a digest of any ideal-job text, and the
   * answering tenant (OPN-SRCH-005).
   */
  pagination_key?: Vetchium.PaginationKey;

  /** Defaults to 20. */
  limit?: OpeningSearchPageSize = 20;
}

/** `ideal_job_match` ranks by the caller's saved ideal job (OPN-SRCH-013). */
union OpeningSearchSort {
  "newest",
  "ideal_job_match",
}

/** The browser never sends ideal-job text; hub-api reads it (OPN-SRCH-013). */
model SearchOpeningsRequest {
  ...OpeningSearchFilters;
  sort?: OpeningSearchSort = "newest";

  /** Defaults to the caller's home region (OPN-SRCH-001). */
  region?: Vetchium.Directory.TenantID;
}

/**
 * One search as the answering tenant runs it: the relay and peer body and the
 * reader input. It names no viewer (OPN-SRCH-002).
 */
model OpeningSearchQuery {
  ...OpeningSearchFilters;
  sort?: OpeningSearchSort = "newest";

  /**
   * The caller's saved ideal job, present exactly when `sort` is
   * `ideal_job_match`. Used only to match and rank; never logged, stored, or
   * audited (OPN-SRCH-014).
   */
  ideal_job_text?: Vetchium.Hub.IdealJob;
}

model OpeningSearchResult {
  org: PublicOrg;
  opening: PublicOpeningSummary;
}

model SearchOpeningsResponse {
  openings: OpeningSearchResult[];
  next_pagination_key?: Vetchium.PaginationKey;
}

model SuggestOpeningOrgsQuery {
  query: OrgSuggestionQuery;
}

model SuggestOpeningOrgsRequest {
  ...SuggestOpeningOrgsQuery;

  /** Defaults to the caller's home region. */
  region?: Vetchium.Directory.TenantID;
}

model SuggestOpeningOrgsResponse {
  @maxItems(10)
  orgs: PublicOrg[];
}

alias OpeningSearchErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.HubRegionUnavailableErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias SearchOpeningsResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: SearchOpeningsResponse;
    }
  | OpeningSearchErrors
  | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

alias SuggestOpeningOrgsResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: SuggestOpeningOrgsResponse;
    }
  | OpeningSearchErrors;

@route("/api/hub")
@tag("Hub Opening Search")
interface OpeningSearchOperations {
  /** Searches one region's published Openings (OPN-SRCH-001). */
  @route("/search-openings")
  @post
  @useAuth(BearerAuth)
  search(@body request: SearchOpeningsRequest):
    | SearchOpeningsResult
    | Vetchium.Problem.HubIdealJobMissingErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse;

  /** Suggests Orgs for the search's Org filter (OPN-SRCH-007). */
  @route("/suggest-opening-orgs")
  @post
  @useAuth(BearerAuth)
  suggestOrgs(@body request: SuggestOpeningOrgsRequest):
    | SuggestOpeningOrgsResult
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse;
}

/**
 * Asks the local relay to search `tenant_id`. No viewer identity crosses the
 * mesh (OPN-SRCH-002).
 */
model RelaySearchOpeningsRequest {
  tenant_id: Vetchium.Directory.TenantID;
  query: OpeningSearchQuery;
}

/**
 * Asks the local relay for `tenant_id`'s Org suggestions. No viewer identity
 * crosses the mesh (OPN-SRCH-002).
 */
model RelaySuggestOpeningOrgsRequest {
  tenant_id: Vetchium.Directory.TenantID;
  query: SuggestOpeningOrgsQuery;
}

/** The answering tenant's own search; no viewer identity (OPN-SRCH-002). */
alias PeerSearchOpeningsRequest = OpeningSearchQuery;

/** The answering tenant's own suggestions; no viewer identity (OPN-SRCH-002). */
alias PeerSuggestOpeningOrgsRequest = SuggestOpeningOrgsQuery;

alias PeerOpeningSearchErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.MeshPeerAuthenticationRequiredErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

@route("/mesh/opening-search")
@tag("Tenant-local Opening search relay")
@useAuth(BearerAuth)
interface OpeningSearchRelayOperations {
  @route("/search")
  @post
  search(@body request: RelaySearchOpeningsRequest):
    | SearchOpeningsResult
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

  @route("/suggest-orgs")
  @post
  suggestOrgs(@body request: RelaySuggestOpeningOrgsRequest):
    | SuggestOpeningOrgsResult
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;
}

@route("/api/mesh/opening-search")
@tag("Authenticated peer Opening search")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface OpeningSearchPeerOperations {
  @route("/search")
  @post
  search(@body request: PeerSearchOpeningsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: SearchOpeningsResponse;
      }
    | PeerOpeningSearchErrors
    | Vetchium.Problem.InvalidPaginationKeyErrorResponse;

  @route("/suggest-orgs")
  @post
  suggestOrgs(@body request: PeerSuggestOpeningOrgsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: SuggestOpeningOrgsResponse;
      }
    | PeerOpeningSearchErrors;
}
