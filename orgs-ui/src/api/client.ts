import {
  APIError,
  createPortalAPIClient,
  getProblemType,
} from "@vetchium/portal-ui/api";
import {
  createSessionAPIOrigin,
  findRegion,
} from "@vetchium/portal-ui/region-selection";
import type { IdempotencyKey } from "typespec/common/idempotency";
import {
  AuthenticationRequiredError,
  RecentAuthenticationRequiredError,
} from "typespec/problem/orgs/authentication";
import { regionTable } from "../app/regions";
import { clearSession, readSession } from "../auth/session";

export const sessionExpiredEvent = "vetchium:orgs-session-expired";

const client = createPortalAPIClient({
  origin: createSessionAPIOrigin({
    table: regionTable,
    sessionTenant: () => readSession()?.tenantId ?? null,
  }),
  apiPrefix: "/api/orgs",
  authenticationProblemType: AuthenticationRequiredError.type,
  recentAuthenticationProblemType: RecentAuthenticationRequiredError.type,
  sessionExpiredEvent,
  readToken: () => readSession()?.token ?? null,
  clearSession,
});

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: IdempotencyKey;
  method?: "GET" | "POST";
  /** The media type of a binary body the caller already encoded. */
  contentType?: string;
  /** The region a signed-out flow talks to: the page's picker or an emailed
   * link. Such a request carries no session token unless `token` is given. */
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
  if (options.contentType !== undefined) {
    headers["Content-Type"] = options.contentType;
  }
  let origin: string | undefined;
  if (options.tenantId !== undefined) {
    // Never fall back to another region for a request bound to one.
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
