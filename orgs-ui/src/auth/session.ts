import { createRegionalSessionStorage } from "@vetchium/portal-ui/region-selection";
import { isOpaqueToken } from "typespec/common/authentication";
import type { OrgSessionToken } from "typespec/orgs/auth/types";
import { regionStore, regionTable } from "../app/regions";

/** A session token and the region that issued it. Every request made with
 * the token goes to that region. */
export interface OrgSession {
  token: OrgSessionToken;
  tenantId: string;
}

const storage = createRegionalSessionStorage<OrgSessionToken>({
  key: "vetchium.orgs.session",
  table: regionTable,
  parse: (value) =>
    typeof value === "string" && isOpaqueToken(value)
      ? (value as OrgSessionToken)
      : null,
});

export function readSession(): OrgSession | null {
  const stored = storage.read();
  return stored === null
    ? null
    : { token: stored.session, tenantId: stored.tenantId };
}

/** Stores a token issued by `tenantId` and remembers that region for the next
 * sign-in page. Remembered Org sessions are not offered, so the token lives
 * only as long as the browser tab. */
export function storeSession(
  token: OrgSessionToken,
  tenantId: string,
): OrgSession {
  storage.store({ tenantId, session: token }, false);
  regionStore.remember(tenantId);
  return { token, tenantId };
}

export function clearSession(): void {
  storage.clear();
}
