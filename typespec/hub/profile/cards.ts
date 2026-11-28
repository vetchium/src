import type { DisplayName } from "../../common/localization.ts";
import type { HubAlias } from "../../directory/directory.ts";
import {
  type HubHandle,
  type HubUserDID,
  isHubHandle,
  isHubUserDID,
} from "../types.ts";

export const maxCardHandles = 50;

export interface ProfileCard {
  handle: HubHandle;
  alias?: HubAlias;
  display_name: DisplayName;
  picture_url?: string;
}

function validHandles(handles: HubHandle[]): boolean {
  return (
    handles.length >= 1 &&
    handles.length <= maxCardHandles &&
    handles.every(isHubHandle) &&
    new Set(handles).size === handles.length
  );
}

export interface ReadCardsRequest {
  handles: HubHandle[];
}

export function validateReadCardsRequest(request: ReadCardsRequest): string[] {
  return validHandles(request.handles) ? [] : ["handles"];
}

export interface ReadCardsResponse {
  cards: ProfileCard[];
  unavailable: HubHandle[];
}

export interface RelayReadCardsRequest {
  viewer_hub_user_did: HubUserDID;
  viewer_handle: HubHandle;
  handles: HubHandle[];
}

export interface PeerReadCardsRequest {
  viewer_hub_user_did: HubUserDID;
  viewer_handle: HubHandle;
  handles: HubHandle[];
}

export function validatePeerReadCardsRequest(
  request: RelayReadCardsRequest | PeerReadCardsRequest,
): string[] {
  const fields: string[] = [];
  if (!isHubUserDID(request.viewer_hub_user_did))
    fields.push("viewer_hub_user_did");
  if (!isHubHandle(request.viewer_handle)) fields.push("viewer_handle");
  if (!validHandles(request.handles)) fields.push("handles");
  return fields;
}

export const validateRelayReadCardsRequest = validatePeerReadCardsRequest;
