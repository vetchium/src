import {
  APIError,
  createPortalAPIClient,
  getProblemType,
} from "@vetchium/portal-ui/api";
import {
  createRegionalAPIOrigin,
  findRegion,
} from "@vetchium/portal-ui/region-selection";
import type { IdempotencyKey } from "typespec/common/idempotency";
import {
  AuthenticationRequiredError,
  RecentAuthenticationRequiredError,
} from "typespec/problem/orgs/authentication";
import { regionStore, regionTable } from "../app/regions";
import {
  clearSessionToken,
  readSessionToken,
  sessionTenant,
} from "../auth/session";

export const sessionExpiredEvent = "vetchium:orgs-session-expired";

const client = createPortalAPIClient({
  origin: createRegionalAPIOrigin({
    table: regionTable,
    sessionTenant,
    selectedTenant: regionStore.read,
  }),
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
  /** A region an emailed link named, overriding the session and picker. */
  tenantId?: string;
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
  let origin: string | undefined;
  if (options.tenantId !== undefined) {
    // Never fall back to another region for a request a link bound to one.
    origin = findRegion(regionTable, options.tenantId)?.apiOrigin;
    if (origin === undefined) {
      return Promise.reject(new Error(`unknown region ${options.tenantId}`));
    }
  }
  return client.request<Response>(path, {
    body: options.body,
    headers,
    method: options.method,
    origin,
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
