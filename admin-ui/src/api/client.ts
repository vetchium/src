import {
  APIError,
  createPortalAPIClient,
  getProblemType,
} from "@vetchium/portal-ui/api";
import type { IdempotencyKey } from "typespec/common/idempotency";
import {
  AdminAuthenticationRequiredError,
  RecentAuthenticationRequiredError,
} from "typespec/problem/admin/authentication";
import { clearSessionToken, getSessionToken } from "../auth/session";

const client = createPortalAPIClient({
  apiPrefix: "/api",
  authenticationProblemType: AdminAuthenticationRequiredError.type,
  recentAuthenticationProblemType: RecentAuthenticationRequiredError.type,
  sessionExpiredEvent: "vetchium:session-expired",
  readToken: getSessionToken,
  clearSession: clearSessionToken,
});

export { APIError as ApiError, getProblemType };
export const isRecentAuthenticationRequired =
  client.isRecentAuthenticationRequired;

export function idempotencyHeaders(key: IdempotencyKey): HeadersInit {
  return { "Idempotency-Key": key };
}

export function requestJson<Response>(
  path: string,
  init: RequestInit,
): Promise<Response> {
  return client.request<Response>(path, {
    body: init.body,
    headers: init.headers,
    method: init.method as "DELETE" | "GET" | "PATCH" | "POST" | "PUT",
  });
}

export function requestVoid(path: string, init: RequestInit): Promise<void> {
  return requestJson<void>(path, init);
}
