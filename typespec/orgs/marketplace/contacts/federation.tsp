import "@typespec/http";

import "../../../common/authentication.tsp";
import "../../../common/pagination.tsp";
import "../../../federation/marketplace.tsp";
import "../../../hub/profile/public.tsp";
import "../../../hub/types.tsp";
import "../../../problem/common.tsp";
import "../../../problem/global-coordinator/authentication.tsp";
import "../../../problem/orgs/marketplace.tsp";
import "../../types.tsp";
import "./contacts.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Marketplace.Contacts;

/**
 * Sent only by the local orgs-api after authenticating the agency user.
 * The profile's home tenant answers a peer that homes `agency_org_did`.
 */
model RelayReadAgencyProfileRequest {
  agency_org_did: Vetchium.Orgs.OrgDID;
  address: Vetchium.Hub.Profile.ProfileAddress;
}

model PeerReadAgencyProfileRequest {
  agency_org_did: Vetchium.Orgs.OrgDID;
  target_hub_user_did: Vetchium.Hub.HubUserDID;
}

/**
 * What an agency reads of a Hub user: the DID the agency's Contact keeps,
 * the public profile, and each verified professional-email domain with
 * months only.
 */
model AgencyProfileRead {
  hub_user_did: Vetchium.Hub.HubUserDID;
  profile: Vetchium.Hub.Profile.PublicProfile;
  verified_domains: VerifiedDomain[];
  agencies_may_message: boolean;
}

alias AgencyProfileReadResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: AgencyProfileRead;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.OrgHubUserNotFoundErrorResponse
  | Vetchium.Problem.OrgTenantUnavailableErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

@route("/mesh/agency-profile")
@tag("Tenant-local agency profile relay")
@useAuth(BearerAuth)
interface AgencyProfileRelayOperations {
  @route("/read")
  @post
  read(@body request: RelayReadAgencyProfileRequest):
    | AgencyProfileReadResult
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;
}

@route("/api/mesh/agency-profile")
@tag("Authenticated peer agency profile read")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface AgencyProfilePeerOperations {
  @route("/read")
  @post
  read(@body request: PeerReadAgencyProfileRequest):
    | AgencyProfileReadResult
    | Vetchium.Problem.MeshPeerAuthenticationRequiredErrorResponse;
}

alias ConversationReadResult =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: Vetchium.Federation.Marketplace.MeshReadConversationResponse;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.InvalidPaginationKeyErrorResponse
  | Vetchium.Problem.OrgConversationNotFoundErrorResponse
  | Vetchium.Problem.OrgTenantUnavailableErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

/**
 * Sent only by the local hub-api after authenticating the Hub user, which
 * reads the conversation live from the agency's tenant (MKT-DAT-005).
 */
@route("/mesh/conversations")
@tag("Tenant-local agency conversation relay")
@useAuth(BearerAuth)
interface ConversationRelayOperations {
  @route("/read")
  @post
  read(
    @body request: Vetchium.Federation.Marketplace.MeshReadConversationRequest,
  ):
    | ConversationReadResult
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;
}

/** The agency's tenant answers only a peer that homes `hub_user_did`. */
@route("/api/mesh/conversations")
@tag("Authenticated peer agency conversation read")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface ConversationPeerOperations {
  @route("/read")
  @post
  read(
    @body request: Vetchium.Federation.Marketplace.MeshReadConversationRequest,
  ):
    | ConversationReadResult
    | Vetchium.Problem.MeshPeerAuthenticationRequiredErrorResponse;
}
