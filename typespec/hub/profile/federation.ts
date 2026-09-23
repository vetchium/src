import {
  type HubHandle,
  type HubUserDID,
  isHubHandle,
  isHubUserDID,
} from "../types.ts";
import { isProfileAddress, type ProfileAddress } from "./public.ts";

export interface RelayReadProfileRequest {
  viewer_hub_user_did: HubUserDID;
  viewer_handle: HubHandle;
  address: ProfileAddress;
}

export interface PeerReadProfileRequest {
  viewer_hub_user_did: HubUserDID;
  viewer_handle: HubHandle;
  target_hub_user_did: HubUserDID;
}

export function normalizeRelayReadProfileRequest(
  request: RelayReadProfileRequest,
): RelayReadProfileRequest {
  return { ...request, address: request.address.trim() };
}

export function validateRelayReadProfileRequest(
  request: RelayReadProfileRequest,
): string[] {
  const fields: string[] = [];
  if (!isHubUserDID(request.viewer_hub_user_did))
    fields.push("viewer_hub_user_did");
  if (!isHubHandle(request.viewer_handle)) fields.push("viewer_handle");
  if (!isProfileAddress(request.address)) fields.push("address");
  return fields;
}

export function validatePeerReadProfileRequest(
  request: PeerReadProfileRequest,
): string[] {
  const fields: string[] = [];
  if (!isHubUserDID(request.viewer_hub_user_did))
    fields.push("viewer_hub_user_did");
  if (!isHubHandle(request.viewer_handle)) fields.push("viewer_handle");
  if (!isHubUserDID(request.target_hub_user_did))
    fields.push("target_hub_user_did");
  return fields;
}
