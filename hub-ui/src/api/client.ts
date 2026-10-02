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
} from "typespec/problem/hub/authentication";
import { regionStore, regionTable } from "../app/regions";
import { clearSession, readSession, sessionTenant } from "../auth/session";

const client = createPortalAPIClient({
  origin: createRegionalAPIOrigin({
    table: regionTable,
    sessionTenant,
    selectedTenant: regionStore.read,
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
  const headers = { ...options.headers };
  if (options.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  const { tenantId, ...rest } = options;
  let origin: string | undefined;
  if (tenantId !== undefined) {
    // Never fall back to another region for a request a link bound to one.
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
