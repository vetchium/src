const storageKey = "vetchium.orgs.sso.google";

export interface PendingGoogleSignIn {
  tenantId: string;
  returnTo: string;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): Store | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * Remembers where a Google sign-in began, because the provider sends the
 * browser back to a fixed callback that carries only a code and a state. The
 * entry is per tab, so a sign-in in one tab never completes in another.
 */
export function rememberGoogleSignIn(
  pending: PendingGoogleSignIn,
  store: Store | undefined = defaultStore(),
): boolean {
  try {
    store?.setItem(storageKey, JSON.stringify(pending));
    return store !== undefined;
  } catch {
    return false;
  }
}

/** Reads and removes the entry; a callback can use it once. */
export function takeGoogleSignIn(
  isRegion: (tenantId: string) => boolean,
  store: Store | undefined = defaultStore(),
): PendingGoogleSignIn | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(storageKey) ?? null;
    store?.removeItem(storageKey);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "tenantId" in value &&
      "returnTo" in value &&
      typeof value.tenantId === "string" &&
      typeof value.returnTo === "string" &&
      isRegion(value.tenantId)
    ) {
      return { tenantId: value.tenantId, returnTo: value.returnTo };
    }
  } catch {
    return null;
  }
  return null;
}
