import type { AdminSessionToken } from "../../../typespec/admin/auth/types.ts";
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

async function request(path: string, init: RequestInit): Promise<Response> {
  const token = getSessionToken();
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: headersWithAuthentication(init, token),
  });

  if (response.status === 401 && token !== null) {
    clearSessionToken();
    window.dispatchEvent(new Event("vetchium:session-expired"));
  }

  return response;
}

export async function requestJson<Response>(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const response = await request(path, init);

  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, payload);
  }

  return payload as Response;
}

export async function requestVoid(
  path: string,
  init: RequestInit,
): Promise<void> {
  const response = await request(path, init);
  if (response.ok) {
    return;
  }
  const payload: unknown = await response.json();
  throw new ApiError(response.status, payload);
}
