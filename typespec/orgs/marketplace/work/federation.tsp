import "@typespec/http";

import "../../../common/authentication.tsp";
import "../../../common/pagination.tsp";
import "../../../directory/directory.tsp";
import "../../../problem/common.tsp";
import "../../../problem/global-coordinator/authentication.tsp";
import "../../../problem/orgs/marketplace.tsp";
import "../attribution.tsp";
import "../statements.tsp";
import "./work.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Marketplace.Work;

/**
 * Where the next page of the merged work queue resumes. Each tenant orders by
 * `bucket` (0: an upcoming interview, 1: the rest), then `sort`, then the
 * work id.
 */
model Position {
  @minValue(0)
  @maxValue(1)
  bucket: int32;

  sort: int64;
  work_id: WorkID;
}

/** One client tenant's share of a provider's work queue. */
model PeerListWorkRequest {
  provider_org_did: Vetchium.Orgs.OrgDID;
  client_domain?: Vetchium.Orgs.OrgDomain;
  capability?: Capability;
  opening_number?: Vetchium.Orgs.Openings.OpeningNumber;
  stage_name?: string;
  status?: WorkStatus;
  after?: Position;
  limit: WorkPageSize;
}

model PeerWorkEntry {
  position: Position;
  item: WorkItem;
}

model PeerListWorkResponse {
  items: PeerWorkEntry[];
  has_more: boolean;
}

model PeerGetWorkRequest {
  provider_org_did: Vetchium.Orgs.OrgDID;
  engagement_id: EngagementID;
  work_id: WorkID;
}

/** Where the next page of the merged jobs resumes. */
model JobPosition {
  assigned_at: utcDateTime;
  assignment_id: WorkID;
}

model PeerListJobsRequest {
  provider_org_did: Vetchium.Orgs.OrgDID;
  client_domain?: Vetchium.Orgs.OrgDomain;
  state: Vetchium.Orgs.Openings.OpeningState;
  after?: JobPosition;
  limit: WorkPageSize;
}

model PeerJobEntry {
  position: JobPosition;
  job: Job;
}

model PeerListJobsResponse {
  jobs: PeerJobEntry[];
  has_more: boolean;
}

model PeerGetJobRequest {
  provider_org_did: Vetchium.Orgs.OrgDID;
  engagement_id: EngagementID;
  opening_number: Vetchium.Orgs.Openings.OpeningNumber;
}

model RelayListWorkRequest {
  tenant: Vetchium.Directory.TenantID;
  request: PeerListWorkRequest;
}

model RelayGetWorkRequest {
  tenant: Vetchium.Directory.TenantID;
  request: PeerGetWorkRequest;
}

model RelayListJobsRequest {
  tenant: Vetchium.Directory.TenantID;
  request: PeerListJobsRequest;
}

model RelayGetJobRequest {
  tenant: Vetchium.Directory.TenantID;
  request: PeerGetJobRequest;
}

alias PeerWorkReadErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

@route("/mesh/provider-work")
@tag("Tenant-local provider work relay")
@useAuth(BearerAuth)
interface ProviderWorkRelayOperations {
  @route("/list")
  @post
  list(@body request: RelayListWorkRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: PeerListWorkResponse;
      }
    | PeerWorkReadErrors
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

  @route("/get")
  @post
  get(@body request: RelayGetWorkRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: WorkDetail;
      }
    | PeerWorkReadErrors
    | Vetchium.Problem.OrgEngagementWorkNotFoundErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;
}

@route("/mesh/provider-jobs")
@tag("Tenant-local provider jobs relay")
@useAuth(BearerAuth)
interface ProviderJobsRelayOperations {
  @route("/list")
  @post
  list(@body request: RelayListJobsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: PeerListJobsResponse;
      }
    | PeerWorkReadErrors
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

  @route("/get")
  @post
  get(@body request: RelayGetJobRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: JobDetail;
      }
    | PeerWorkReadErrors
    | Vetchium.Problem.OrgEngagementWorkNotFoundErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;
}

@route("/api/mesh/provider-work")
@tag("Authenticated peer provider work read")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface ProviderWorkPeerOperations {
  @route("/list")
  @post
  list(@body request: PeerListWorkRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: PeerListWorkResponse;
      }
    | PeerWorkReadErrors
    | Vetchium.Problem.MeshPeerAuthenticationRequiredErrorResponse;

  @route("/get")
  @post
  get(@body request: PeerGetWorkRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: WorkDetail;
      }
    | PeerWorkReadErrors
    | Vetchium.Problem.OrgEngagementWorkNotFoundErrorResponse
    | Vetchium.Problem.MeshPeerAuthenticationRequiredErrorResponse;
}

@route("/api/mesh/provider-jobs")
@tag("Authenticated peer provider jobs read")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface ProviderJobsPeerOperations {
  @route("/list")
  @post
  list(@body request: PeerListJobsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: PeerListJobsResponse;
      }
    | PeerWorkReadErrors
    | Vetchium.Problem.MeshPeerAuthenticationRequiredErrorResponse;

  @route("/get")
  @post
  get(@body request: PeerGetJobRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: JobDetail;
      }
    | PeerWorkReadErrors
    | Vetchium.Problem.OrgEngagementWorkNotFoundErrorResponse
    | Vetchium.Problem.MeshPeerAuthenticationRequiredErrorResponse;
}

model PeerListCreditedApplicationsRequest {
  provider_org_did: Vetchium.Orgs.OrgDID;
  client_domain?: Vetchium.Orgs.OrgDomain;
  opening_number?: Vetchium.Orgs.Openings.OpeningNumber;
  route?: ReferralRoute;
  status?: Vetchium.Hub.Applications.ApplicationStatus;
  limit: WorkPageSize;
}

model PeerListCreditedApplicationsResponse {
  items: CreditedApplicationSummary[];
}

model RelayListCreditedApplicationsRequest {
  tenant: Vetchium.Directory.TenantID;
  request: PeerListCreditedApplicationsRequest;
}

@route("/mesh/provider-attribution")
@tag("Tenant-local provider attribution relay")
@useAuth(BearerAuth)
interface ProviderAttributionRelayOperations {
  @route("/list")
  @post
  list(@body request: RelayListCreditedApplicationsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: PeerListCreditedApplicationsResponse;
      }
    | PeerWorkReadErrors
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;
}

@route("/api/mesh/provider-attribution")
@tag("Authenticated peer provider attribution read")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface ProviderAttributionPeerOperations {
  @route("/list")
  @post
  list(@body request: PeerListCreditedApplicationsRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: PeerListCreditedApplicationsResponse;
      }
    | PeerWorkReadErrors
    | Vetchium.Problem.MeshPeerAuthenticationRequiredErrorResponse;
}

model PeerGetActivityStatementRequest {
  provider_org_did: Vetchium.Orgs.OrgDID;
  engagement_id: Vetchium.Orgs.Marketplace.EngagementID;
  month: Vetchium.Orgs.Marketplace.StatementMonth;
  pagination_key?: Vetchium.PaginationKey;
  @minValue(1)
  @maxValue(100)
  limit: int32;
}

model PeerGetActivityStatementResponse {
  engagement_id: Vetchium.Orgs.Marketplace.EngagementID;
  month: Vetchium.Orgs.Marketplace.StatementMonth;
  items: Vetchium.Orgs.Marketplace.ActivityStatementItem[];
  next_pagination_key?: Vetchium.PaginationKey;
}

model RelayGetActivityStatementRequest {
  tenant: Vetchium.Directory.TenantID;
  request: PeerGetActivityStatementRequest;
}

@route("/mesh/provider-statements")
@tag("Tenant-local provider statement relay")
@useAuth(BearerAuth)
interface ProviderStatementRelayOperations {
  @route("/get")
  @post
  get(@body request: RelayGetActivityStatementRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: PeerGetActivityStatementResponse;
      }
    | PeerWorkReadErrors
    | Vetchium.Problem.OrgEngagementNotFoundErrorResponse
    | Vetchium.Problem.OrgTenantUnavailableErrorResponse
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;
}

@route("/api/mesh/provider-statements")
@tag("Authenticated peer provider statement read")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface ProviderStatementPeerOperations {
  @route("/get")
  @post
  get(@body request: PeerGetActivityStatementRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: PeerGetActivityStatementResponse;
      }
    | PeerWorkReadErrors
    | Vetchium.Problem.OrgEngagementNotFoundErrorResponse
    | Vetchium.Problem.MeshPeerAuthenticationRequiredErrorResponse;
}
