import { randomBytes } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";

export const HUB_ORIGIN =
  process.env.PLAYWRIGHT_HUB_BASE_URL ?? "http://hub-ui.sgp.localhost";
export const MAILPIT_ORIGIN =
  process.env.PLAYWRIGHT_MAILPIT_BASE_URL ?? "http://127.0.0.1:18025";

export function hubIdempotencyKey(): string {
  return `e2e-${randomBytes(30).toString("base64url")}`;
}

export class HubAPI {
  readonly idempotencyKeys = new Set<string>();

  constructor(readonly request: APIRequestContext) {}

  post(
    path: string,
    data?: unknown,
    options: { token?: string; idempotencyKey?: string } = {},
  ): Promise<APIResponse> {
    const headers: Record<string, string> = {};
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
      this.idempotencyKeys.add(options.idempotencyKey);
    }
    return this.request.post(`${HUB_ORIGIN}/api/hub${path}`, { data, headers });
  }

  postRaw(
    path: string,
    body: string,
    options: { token?: string; idempotencyKey?: string } = {},
  ): Promise<APIResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
      this.idempotencyKeys.add(options.idempotencyKey);
    }
    return this.request.post(`${HUB_ORIGIN}/api/hub${path}`, {
      data: body,
      headers,
    });
  }

  get(path: string, token: string): Promise<APIResponse> {
    return this.request.get(`${HUB_ORIGIN}/api/hub${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}
