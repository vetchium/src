import {
  APIError,
  createPortalAPIClient,
  getProblemType,
} from "@vetchium/portal-ui/api";
import type { IdempotencyKey } from "typespec/common/idempotency";
import {
  AuthenticationRequiredError,
  RecentAuthenticationRequiredError,
} from "typespec/problem/hub/authentication";
import { clearSession, readSession } from "../auth/session";

const client = createPortalAPIClient({
  apiPrefix: "",
  authenticationProblemType: AuthenticationRequiredError.type,
  recentAuthenticationProblemType: RecentAuthenticationRequiredError.type,
  sessionExpiredEvent: "vetchium:hub-session-expired",
  readToken: () => readSession()?.session_token ?? null,
  clearSession,
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
  const headers =
    options.idempotencyKey === undefined
      ? undefined
      : { "Idempotency-Key": options.idempotencyKey };
  return client.request<Response>(path, { ...options, headers });
}

export function isProblem(error: unknown, type: string): boolean {
  return getProblemType(error) === type;
}
