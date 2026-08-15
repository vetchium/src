import { useMemo, useRef } from "react";
import type { IdempotencyKey } from "../../../typespec/common/idempotency.ts";

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
    // Browser privacy settings can disable storage. The key still holds for as
    // long as the component does, which covers an ordinary retry.
  }
}

function forgetKey(name: string): void {
  try {
    globalThis.sessionStorage?.removeItem(name);
  } catch {
    // As above.
  }
}

/**
 * Holds one key for one logical mutation and keeps it across retries, so a
 * retry after a lost response replays the committed result instead of starting
 * a second operation. The server rolls its ledger entry back whenever it
 * answers with a problem, so a key needs rotating only once its operation is
 * finished: after a success, or when the caller abandons the operation. Reusing
 * a key for a different payload is answered with an idempotency-key conflict.
 *
 * `persistAs` keeps the key for the tab rather than for the component, so an
 * operation against a one-time token — a password reset, an invitation — can
 * still replay its committed result after browser history has unmounted the
 * page that started it. Name it after the token so a different one gets a
 * different key.
 *
 * The holder keeps a stable identity so callers can depend on it in an effect.
 */
export function useIdempotencyKey(persistAs?: string): IdempotencyKeyHolder {
  // The name is held with the key, because a route that swaps one one-time
  // token for another keeps this ref: the key from the previous token must not
  // be reused for the next, nor written under its name.
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
          if (stored !== null) {
            held.current = { name: persistAs, key: stored };
          }
        }
        if (held.current === null) {
          const minted = crypto.randomUUID();
          held.current = { name: persistAs, key: minted };
          if (persistAs !== undefined) {
            storeKey(persistAs, minted);
          }
        }
        return held.current.key;
      },
      rotate: () => {
        held.current = null;
        if (persistAs !== undefined) {
          forgetKey(persistAs);
        }
      },
    }),
    [persistAs],
  );
}
