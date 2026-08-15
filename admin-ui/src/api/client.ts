import type { AdminSessionToken } from "../../../typespec/admin/auth/types.ts";
import type { IdempotencyKey } from "../../../typespec/common/idempotency.ts";
import {
  AdminAuthenticationRequiredError,
  RecentAuthenticationRequiredError,
} from "../../../typespec/problem/admin/authentication.ts";
import type { Details } from "../../../typespec/problem/details.ts";
import { clearSessionToken, getSessionToken } from "../auth/session";

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function isProblemDetails(payload: unknown): payload is Details {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.status === "number"
  );
}

export function getProblemType(error: unknown): string | undefined {
  return error instanceof ApiError && isProblemDetails(error.payload)
    ? error.payload.type
    : undefined;
}

/**
 * Step-up endpoints answer 401 when the session is valid but the sign in is
 * older than the accepted age. The session must survive that answer so the
 * portal can ask for a fresh sign in instead of discarding the session.
 */
export function isRecentAuthenticationRequired(error: unknown): boolean {
  return getProblemType(error) === RecentAuthenticationRequiredError.type;
}

/**
 * The bearer token rides along on public endpoints too, so not every 401 is
 * about the session: an expired invitation or password-reset token answers 401
 * of its own, and signing the administrator out over one would be wrong. Only a
 * problem that describes the bearer session, or a 401 too opaque to attribute,
 * tears the session down.
 */
function describesSessionFailure(error: unknown): boolean {
  const type = getProblemType(error);
  return type === undefined || type === AdminAuthenticationRequiredError.type;
}

export function idempotencyHeaders(key: IdempotencyKey): HeadersInit {
  return { "Idempotency-Key": key };
}

function headersWithAuthentication(
  init: RequestInit,
  token: AdminSessionToken | null,
): Headers {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (token !== null) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

/**
 * A failure can come from an intermediary rather than the API, so the body is
 * not guaranteed to be problem details, or even JSON. Session teardown must
 * still run for those responses.
 */
async function errorPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const token = getSessionToken();
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: headersWithAuthentication(init, token),
  });

  if (response.ok) {
    return response;
  }

  const error = new ApiError(response.status, await errorPayload(response));

  // Only the session this request was made with may be torn down: a late 401
  // for a signed-out session must not evict whoever has signed in since.
  if (
    response.status === 401 &&
    token !== null &&
    getSessionToken() === token &&
    !isRecentAuthenticationRequired(error) &&
    describesSessionFailure(error)
  ) {
    clearSessionToken();
    window.dispatchEvent(new Event("vetchium:session-expired"));
  }

  throw error;
}

export async function requestJson<Response>(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const response = await request(path, init);
  const payload: unknown = await response.json();
  return payload as Response;
}

export async function requestVoid(
  path: string,
  init: RequestInit,
): Promise<void> {
  await request(path, init);
}
