import { createRegionalSessionStorage } from "@vetchium/portal-ui/region-selection";
import { isOpaqueToken } from "typespec/common/authentication";
import type { OrgSessionToken } from "typespec/orgs/auth/types";
import { regionStore, regionTable } from "../app/regions";

const storage = createRegionalSessionStorage<OrgSessionToken>({
  key: "vetchium.orgs.session",
  table: regionTable,
  parse: (value) =>
    typeof value === "string" && isOpaqueToken(value)
      ? (value as OrgSessionToken)
      : null,
});

export function readSessionToken(): OrgSessionToken | null {
  return storage.read()?.session ?? null;
}

/** The region that issued the stored session's token. */
export function sessionTenant(): string | null {
  return storage.read()?.tenantId ?? null;
}

/** Stores a token from the region the sign-in was just sent to. Remembered
 * Org sessions are not offered, so the token lives only as long as the
 * browser tab. */
export function storeSessionToken(token: OrgSessionToken): void {
  const tenantId = regionStore.read();
  storage.store({ tenantId, session: token }, false);
  regionStore.remember(tenantId);
}

export function clearSessionToken(): void {
  storage.clear();
}
