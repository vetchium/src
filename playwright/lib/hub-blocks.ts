import type { APIResponse } from "@playwright/test";
import type {
  BlockUserRequest,
  ListBlockedUsersRequest,
  ListMutedUsersRequest,
} from "typespec/hub/blocks/blocks";
import type { HubAPI } from "./hub-api.ts";

export type BlockOperation =
  | "/blocks/block"
  | "/blocks/unblock"
  | "/blocks/list"
  | "/blocks/state"
  | "/mutes/mute"
  | "/mutes/unmute"
  | "/mutes/list";

/** Typed clients for the seven block and mute operations. Malformed input
 * goes through `raw` and `rawJSON`. */
export class HubBlocksAPI {
  constructor(readonly hub: HubAPI) {}

  block(body: BlockUserRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/blocks/block", body, { token });
  }

  unblock(body: BlockUserRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/blocks/unblock", body, { token });
  }

  listBlocks(
    body: ListBlockedUsersRequest,
    token: string,
  ): Promise<APIResponse> {
    return this.hub.post("/blocks/list", body, { token });
  }

  state(body: BlockUserRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/blocks/state", body, { token });
  }

  mute(body: BlockUserRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/mutes/mute", body, { token });
  }

  unmute(body: BlockUserRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/mutes/unmute", body, { token });
  }

  listMutes(body: ListMutedUsersRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/mutes/list", body, { token });
  }

  /** A body of any shape, for validation cases. */
  raw(
    operation: BlockOperation,
    body: unknown,
    token?: string,
  ): Promise<APIResponse> {
    return this.hub.post(operation, body, token ? { token } : {});
  }

  /** A body that is not JSON. */
  rawJSON(
    operation: BlockOperation,
    body: string,
    token?: string,
  ): Promise<APIResponse> {
    return this.hub.postRaw(operation, body, token ? { token } : {});
  }
}
