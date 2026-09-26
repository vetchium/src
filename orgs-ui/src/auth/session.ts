import { createTokenSessionStorage } from "@vetchium/portal-ui/session";
import type { OrgSessionToken } from "typespec/orgs/auth/types";

// Remembered Org sessions are not offered, so the token lives only as long as
// the browser tab.
const storage = createTokenSessionStorage<OrgSessionToken>(
  "vetchium.orgs.session-token",
);

export const readSessionToken = storage.read;
export const storeSessionToken = storage.store;
export const clearSessionToken = storage.clear;
