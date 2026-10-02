import { createRegionalSessionStorage } from "@vetchium/portal-ui/session";
import { isOpaqueToken } from "typespec/common/authentication";
import { isCountryCode } from "typespec/common/countries";
import type { AuthenticatedSessionResponse } from "typespec/hub/auth/types";
import { isFrontendLocale, isHubHandle } from "typespec/hub/types";
import { regionStore, regionTable } from "../app/regions";

export interface StoredSession extends AuthenticatedSessionResponse {
  remembered: boolean;
}

function parseSession(value: unknown): StoredSession | null {
  if (typeof value !== "object" || value === null) return null;
  const session = value as Partial<StoredSession>;
  if (
    typeof session.session_token !== "string" ||
    !isOpaqueToken(session.session_token) ||
    typeof session.session_expires_at !== "string" ||
    !Number.isFinite(Date.parse(session.session_expires_at)) ||
    Date.parse(session.session_expires_at) <= Date.now() ||
    !isFrontendLocale(session.preferred_language) ||
    !isCountryCode(session.resident_country) ||
    typeof session.handle !== "string" ||
    !isHubHandle(session.handle) ||
    typeof session.remembered !== "boolean"
  ) {
    return null;
  }
  // Rebuilt field by field so that anything an older portal stored beside
  // the session, such as the retired hub_user_did, is not written back.
  return {
    session_token: session.session_token,
    session_expires_at: session.session_expires_at,
    preferred_language: session.preferred_language,
    resident_country: session.resident_country,
    handle: session.handle,
    remembered: session.remembered,
  };
}

const storage = createRegionalSessionStorage<StoredSession>({
  key: "vetchium.hub.session",
  table: regionTable,
  parse: parseSession,
});

export function readSession(): StoredSession | null {
  return storage.read()?.session ?? null;
}

/** The region that issued the stored session's token. */
export function sessionTenant(): string | null {
  return storage.read()?.tenantId ?? null;
}

/**
 * Stores a session for `tenantId`, which defaults to the region a sign-in
 * was just sent to: the one selected on the sign-in page.
 */
export function storeSession(
  session: AuthenticatedSessionResponse,
  remembered: boolean,
  tenantId: string = regionStore.read(),
): StoredSession {
  const stored = { ...session, remembered };
  storage.store({ tenantId, session: stored }, remembered);
  regionStore.remember(tenantId);
  return stored;
}

export function clearSession(): void {
  storage.clear();
}
