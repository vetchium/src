import type { Details } from "../../../typespec/problem/details.ts";
import { readSession } from "../auth/session";

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
  idempotent?: boolean;
  method?: "GET" | "POST";
  token?: string | null;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  if (options.idempotent) headers.set("Idempotency-Key", crypto.randomUUID());
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
    if (
      response.headers.get("content-type")?.includes("application/problem+json")
    ) {
      problem = (await response.json()) as Details;
    }
    throw new APIError(response.status, problem);
  }
  if (response.status === 204 || response.status === 202) return undefined as T;
  return (await response.json()) as T;
}

export function isProblem(error: unknown, type: string): boolean {
  return error instanceof APIError && error.problem?.type === type;
}
