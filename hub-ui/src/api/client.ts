import type { IdempotencyKey } from "../../../typespec/common/idempotency.ts";
import type { Details } from "../../../typespec/problem/details.ts";
import {
  AuthenticationRequiredError,
  RecentAuthenticationRequiredError,
} from "../../../typespec/problem/hub/authentication.ts";
import { clearSession, readSession } from "../auth/session";

export class APIError extends Error {
  constructor(
    readonly status: number,
    readonly problem?: Details,
  ) {
    super(problem?.detail ?? `HTTP ${status}`);
  }
}

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: IdempotencyKey;
  method?: "GET" | "POST";
  token?: string | null;
}

export function getProblemType(error: unknown): string | undefined {
  return error instanceof APIError ? error.problem?.type : undefined;
}

export function isRecentAuthenticationRequired(error: unknown): boolean {
  return getProblemType(error) === RecentAuthenticationRequiredError.type;
}

function describesSessionFailure(error: unknown): boolean {
  const type = getProblemType(error);
  return type === undefined || type === AuthenticationRequiredError.type;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  if (options.idempotencyKey !== undefined) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }
  const token =
    options.token === undefined ? readSession()?.session_token : options.token;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    let problem: Details | undefined;
    try {
      if (
        response.headers
          .get("content-type")
          ?.includes("application/problem+json")
      ) {
        problem = (await response.json()) as Details;
      }
    } catch {
      problem = undefined;
    }
    const error = new APIError(response.status, problem);
    if (
      response.status === 401 &&
      token !== null &&
      token !== undefined &&
      readSession()?.session_token === token &&
      !isRecentAuthenticationRequired(error) &&
      describesSessionFailure(error)
    ) {
      clearSession();
      window.dispatchEvent(new Event("vetchium:hub-session-expired"));
    }
    throw error;
  }
  if (response.status === 204 || response.status === 202) return undefined as T;
  return (await response.json()) as T;
}

export function isProblem(error: unknown, type: string): boolean {
  return getProblemType(error) === type;
}
