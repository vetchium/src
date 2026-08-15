import { IdempotencyKeyConflictError } from "../../../typespec/problem/common.ts";
import { getProblemType } from "./client";

const sharedProblems: Readonly<Record<string, string>> = {
  [IdempotencyKeyConflictError.type]: "common.idempotencyConflict",
};

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
