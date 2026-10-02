import { findRegion } from "./region-selection.ts";
import type { RegionTable } from "./regions.ts";

export function createTokenSessionStorage<Token extends string>(key: string) {
  return {
    read: (): Token | null => {
      try {
        return (
          (globalThis.sessionStorage?.getItem(key) as Token | null) ?? null
        );
      } catch {
        return null;
      }
    },
    store: (token: Token): void => {
      try {
        globalThis.sessionStorage?.setItem(key, token);
      } catch {
        // The authentication context retains the token in memory.
      }
    },
    clear: (): void => {
      try {
        globalThis.sessionStorage?.removeItem(key);
      } catch {
        // The authentication context still clears its in-memory state.
      }
    },
  };
}

export function createRememberedSessionStorage<StoredSession>({
  key,
  parse,
}: {
  key: string;
  parse: (value: string | null) => StoredSession | null;
}) {
  const clear = (): void => {
    try {
      globalThis.localStorage?.removeItem(key);
      globalThis.sessionStorage?.removeItem(key);
    } catch {
      // The authentication context still clears its in-memory state.
    }
  };
  return {
    read: (): StoredSession | null => {
      try {
        return (
          parse(globalThis.sessionStorage?.getItem(key) ?? null) ??
          parse(globalThis.localStorage?.getItem(key) ?? null)
        );
      } catch {
        return null;
      }
    },
    store: (session: StoredSession, remembered: boolean): StoredSession => {
      clear();
      try {
        const storage = remembered
          ? globalThis.localStorage
          : globalThis.sessionStorage;
        storage?.setItem(key, JSON.stringify(session));
      } catch {
        // The authentication context retains the session in memory.
      }
      return session;
    },
    clear,
  };
}

export interface RegionalSession<Session> {
  tenantId: string;
  session: Session;
}

/**
 * Stores a session together with the region that issued it. A stored session
 * naming no region, or one missing from the compiled-in table, reads as no
 * session: its token is only meaningful to the region that issued it.
 */
export function createRegionalSessionStorage<Session>({
  key,
  table,
  parse,
}: {
  key: string;
  table: RegionTable;
  parse: (value: unknown) => Session | null;
}) {
  return createRememberedSessionStorage<RegionalSession<Session>>({
    key,
    parse: (value) => {
      if (!value) return null;
      try {
        const stored: unknown = JSON.parse(value);
        if (typeof stored !== "object" || stored === null) return null;
        const { tenantId, session } = stored as Record<string, unknown>;
        const region = findRegion(table, tenantId);
        const parsed = parse(session);
        if (region === undefined || parsed === null) return null;
        return { tenantId: region.tenantId, session: parsed };
      } catch {
        return null;
      }
    },
  });
}
