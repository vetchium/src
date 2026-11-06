import type { OrgDID, OrgDomain } from "../../orgs/types.ts";
import type { GetOrgOpeningRequest, ListOrgOpeningsRequest } from "./public.ts";

export type RelayListOrgOpeningsRequest = ListOrgOpeningsRequest;
export type RelayGetOrgOpeningRequest = GetOrgOpeningRequest;
export type PeerListOrgOpeningsRequest = ListOrgOpeningsRequest;
export type PeerGetOrgOpeningRequest = GetOrgOpeningRequest;
export type MeshListOpeningAgenciesRequest = GetOrgOpeningRequest;

/**
 * An agency with an active `sourcing` engagement assigned to the Opening.
 * Mesh-only: the Hub never returns the DID.
 */
export interface MeshOpeningAgency {
  agency_org_did: OrgDID;
  agency_domain: OrgDomain;
  agency_display_name: string;
}

/** The agencies assigned to a `published` Opening. */
export interface MeshListOpeningAgenciesResponse {
  items: MeshOpeningAgency[];
}
