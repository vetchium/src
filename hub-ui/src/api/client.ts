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
} from "typespec/problem/hub/authentication";
import { regionTable } from "../app/regions";
import { clearSession, readSession } from "../auth/session";

const client = createPortalAPIClient({
  origin: createSessionAPIOrigin({
    table: regionTable,
    sessionTenant: () => readSession()?.tenantId ?? null,
  }),
  apiPrefix: "",
  authenticationProblemType: AuthenticationRequiredError.type,
  recentAuthenticationProblemType: RecentAuthenticationRequiredError.type,
  sessionExpiredEvent: "vetchium:hub-session-expired",
  readToken: () => readSession()?.session_token ?? null,
  clearSession,
});

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: IdempotencyKey;
  method?: "GET" | "POST";
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
  const headers = { ...options.headers };
  if (options.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  const { tenantId, ...rest } = options;
  let origin: string | undefined;
  if (tenantId !== undefined) {
    // Never fall back to another region for a request bound to one.
    origin = findRegion(regionTable, tenantId)?.apiOrigin;
    if (origin === undefined) {
      return Promise.reject(new Error(`unknown region ${tenantId}`));
    }
  }
  return client.request<Response>(path, { ...rest, headers, origin });
}

export function isProblem(error: unknown, type: string): boolean {
  return getProblemType(error) === type;
}
