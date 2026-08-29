import { createRememberedSessionStorage } from "@vetchium/portal-ui/session";
import { isOpaqueToken } from "typespec/common/authentication";
import { isCountryCode, isFrontendLocale } from "typespec/common/localization";
import type { AuthenticatedSessionResponse } from "typespec/hub/auth/types";
import { isHubHandle, isHubUserDID } from "typespec/hub/types";

export interface StoredSession extends AuthenticatedSessionResponse {
  remembered: boolean;
}

function parseSession(value: string | null): StoredSession | null {
  if (!value) return null;
  try {
    const session = JSON.parse(value) as Partial<StoredSession>;
    if (
      typeof session.session_token !== "string" ||
      !isOpaqueToken(session.session_token) ||
      typeof session.session_expires_at !== "string" ||
      !Number.isFinite(Date.parse(session.session_expires_at)) ||
      Date.parse(session.session_expires_at) <= Date.now() ||
      !isFrontendLocale(session.preferred_language) ||
      typeof session.resident_country !== "string" ||
      !isCountryCode(session.resident_country) ||
      typeof session.hub_user_did !== "string" ||
      !isHubUserDID(session.hub_user_did) ||
      typeof session.handle !== "string" ||
      !isHubHandle(session.handle) ||
      typeof session.remembered !== "boolean"
    ) {
      return null;
    }
    return session as StoredSession;
  } catch {
    return null;
  }
}

const storage = createRememberedSessionStorage<StoredSession>({
  key: "vetchium.hub.session",
  parse: parseSession,
});

export function readSession(): StoredSession | null {
  return storage.read();
}

export function storeSession(
  session: AuthenticatedSessionResponse,
  remembered: boolean,
): StoredSession {
  const stored = { ...session, remembered };
  return storage.store(stored, remembered);
}

export function clearSession(): void {
  storage.clear();
}
