import { problemTranslationKey as sharedProblemTranslationKey } from "@vetchium/portal-ui/errors";
import { IdempotencyKeyConflictError } from "typespec/problem/common";

const sharedProblems: Readonly<Record<string, string>> = {
  [IdempotencyKeyConflictError.type]: "common.idempotencyConflict",
};

export function problemTranslationKey(
  error: unknown,
  keys: Readonly<Record<string, string>>,
  fallback = "common.requestError",
): string {
  return sharedProblemTranslationKey(
    error,
    { ...sharedProblems, ...keys },
    fallback,
  );
}
