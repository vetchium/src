import { IdempotencyKeyConflictError } from "../../../typespec/problem/common.ts";
import { getProblemType } from "./client";

/**
 * Problems any keyed mutation can answer with, whatever its endpoint. A caller
 * that has something more specific to say still wins.
 */
const sharedProblems: Readonly<Record<string, string>> = {
  [IdempotencyKeyConflictError.type]: "common.idempotencyConflict",
};

/**
 * Resolves the translation key for a failed request. Callers map the problem
 * types their endpoint can answer with and fall back to a generic message for
 * transport failures and unmapped problems.
 */
export function problemTranslationKey(
  error: unknown,
  keys: Readonly<Record<string, string>>,
  fallback = "common.requestError",
): string {
  const type = getProblemType(error);
  if (type === undefined) {
    return fallback;
  }
  return keys[type] ?? sharedProblems[type] ?? fallback;
}
