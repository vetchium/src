const sessionTokenKey = "vetchium.hub.session-token";

export function readSessionToken(): string | null {
  try {
    const token = globalThis.sessionStorage?.getItem(sessionTokenKey) ?? null;
    return token === null || token.length === 0 ? null : token;
  } catch {
    return null;
  }
}

export function clearSessionToken(): void {
  try {
    globalThis.sessionStorage?.removeItem(sessionTokenKey);
  } catch {
    // The in-memory session state is still cleared when browser storage is
    // unavailable.
  }
}
