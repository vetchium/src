import type {
  ProfileAddress,
  PublicProfile,
} from "../../../hub/profile/public.ts";
import { isProfileAddress } from "../../../hub/profile/public.ts";
import type { HubUserDID } from "../../../hub/types.ts";
import { isHubUserDID } from "../../../hub/types.ts";
import type { OrgDID } from "../../types.ts";
import { isOrgDID } from "../../types.ts";
import type { VerifiedDomain } from "./contacts.ts";

/** Sent only by the tenant-local orgs-api after authenticating the agency user. */
export interface RelayReadAgencyProfileRequest {
  agency_org_did: OrgDID;
  address: ProfileAddress;
}

export function validateRelayReadAgencyProfileRequest(
  request: RelayReadAgencyProfileRequest,
): string[] {
  const fields: string[] = [];
  if (!isOrgDID(request.agency_org_did)) fields.push("agency_org_did");
  if (!isProfileAddress(request.address)) fields.push("address");
  return fields;
}

/** Answered only for a caller that homes the agency Org. */
export interface PeerReadAgencyProfileRequest {
  agency_org_did: OrgDID;
  target_hub_user_did: HubUserDID;
}

export function validatePeerReadAgencyProfileRequest(
  request: PeerReadAgencyProfileRequest,
): string[] {
  const fields: string[] = [];
  if (!isOrgDID(request.agency_org_did)) fields.push("agency_org_did");
  if (!isHubUserDID(request.target_hub_user_did))
    fields.push("target_hub_user_did");
  return fields;
}

/** What an agency reads of a Hub user. */
export interface AgencyProfileRead {
  hub_user_did: HubUserDID;
  profile: PublicProfile;
  verified_domains: VerifiedDomain[];
  agencies_may_message: boolean;
}
