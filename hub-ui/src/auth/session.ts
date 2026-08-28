import { isOpaqueToken } from "../../../typespec/common/authentication.ts";
import {
  isCountryCode,
  isFrontendLocale,
} from "../../../typespec/common/localization.ts";
import type { AuthenticatedSessionResponse } from "../../../typespec/hub/auth/types.ts";
import { isHubHandle, isHubUserDID } from "../../../typespec/hub/types.ts";

const sessionKey = "vetchium.hub.session";

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

export function readSession(): StoredSession | null {
  try {
    return (
      parseSession(globalThis.sessionStorage?.getItem(sessionKey) ?? null) ??
      parseSession(globalThis.localStorage?.getItem(sessionKey) ?? null)
    );
  } catch {
    return null;
  }
}

export function storeSession(
  session: AuthenticatedSessionResponse,
  remembered: boolean,
): StoredSession {
  const stored = { ...session, remembered };
  clearSession();
  try {
    const storage = remembered
      ? globalThis.localStorage
      : globalThis.sessionStorage;
    storage?.setItem(sessionKey, JSON.stringify(stored));
  } catch {
    // The Auth context retains the session when browser storage is unavailable.
  }
  return stored;
}

export function clearSession(): void {
  try {
    globalThis.localStorage?.removeItem(sessionKey);
    globalThis.sessionStorage?.removeItem(sessionKey);
  } catch {
    // The Auth context still clears its in-memory state.
  }
}
