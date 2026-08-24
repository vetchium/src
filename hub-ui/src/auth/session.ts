import type { AuthenticatedSessionResponse } from "../../../typespec/hub/auth/types.ts";

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
      typeof session.session_expires_at !== "string" ||
      new Date(session.session_expires_at).getTime() <= Date.now()
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
