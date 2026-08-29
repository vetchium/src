import { useMemo, useRef } from "react";
import type { IdempotencyKey } from "typespec/common/idempotency";

export interface IdempotencyKeyHolder {
  current: () => IdempotencyKey;
  rotate: () => void;
}

function readStoredKey(name: string): IdempotencyKey | null {
  try {
    return globalThis.sessionStorage?.getItem(name) ?? null;
  } catch {
    return null;
  }
}

function storeKey(name: string, key: IdempotencyKey): void {
  try {
    globalThis.sessionStorage?.setItem(name, key);
  } catch {
    // The in-memory key still covers ordinary retries in this component.
  }
}

function forgetKey(name: string): void {
  try {
    globalThis.sessionStorage?.removeItem(name);
  } catch {
    // Storage can be disabled by browser privacy settings.
  }
}

/** Holds one key for one logical mutation and preserves it across retries. */
export function useIdempotencyKey(persistAs?: string): IdempotencyKeyHolder {
  const held = useRef<{ name: string | undefined; key: IdempotencyKey } | null>(
    null,
  );
  return useMemo(
    () => ({
      current: () => {
        if (held.current !== null && held.current.name !== persistAs) {
          held.current = null;
        }
        if (held.current === null && persistAs !== undefined) {
          const stored = readStoredKey(persistAs);
          if (stored !== null) held.current = { name: persistAs, key: stored };
        }
        if (held.current === null) {
          const key = crypto.randomUUID();
          held.current = { name: persistAs, key };
          if (persistAs !== undefined) storeKey(persistAs, key);
        }
        return held.current.key;
      },
      rotate: () => {
        held.current = null;
        if (persistAs !== undefined) forgetKey(persistAs);
      },
    }),
    [persistAs],
  );
}
