import {
  APIError,
  createPortalAPIClient,
  getProblemType,
} from "@vetchium/portal-ui/api";
import type { IdempotencyKey } from "typespec/common/idempotency";
import {
  AuthenticationRequiredError,
  RecentAuthenticationRequiredError,
} from "typespec/problem/orgs/authentication";
import { clearSessionToken, readSessionToken } from "../auth/session";

export const sessionExpiredEvent = "vetchium:orgs-session-expired";

const client = createPortalAPIClient({
  apiPrefix: "/api/orgs",
  authenticationProblemType: AuthenticationRequiredError.type,
  recentAuthenticationProblemType: RecentAuthenticationRequiredError.type,
  sessionExpiredEvent,
  readToken: readSessionToken,
  clearSession: clearSessionToken,
});

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: IdempotencyKey;
  method?: "GET" | "POST";
  token?: string | null;
}

export { APIError, getProblemType };
export const isRecentAuthenticationRequired =
  client.isRecentAuthenticationRequired;

export function apiRequest<Response>(
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  return client.request<Response>(path, {
    body: options.body,
    headers,
    method: options.method,
    token: options.token,
  });
}

/** The server decided the request, so replaying the same idempotency key would
 * only return the same refusal. A rate-limited request was never processed and
 * may still belong to an earlier accepted attempt, so it keeps its key. */
export function isDefiniteRefusal(error: unknown): boolean {
  return (
    error instanceof APIError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}
