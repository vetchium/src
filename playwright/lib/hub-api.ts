import { randomBytes } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { SetSubscriptionPlanRequest } from "typespec/hub/subscriptions/subscriptions";

export const HUB_ORIGIN =
  process.env.PLAYWRIGHT_HUB_BASE_URL ?? "http://hub-ui.sgp.localhost";
export const MAILPIT_ORIGIN =
  process.env.PLAYWRIGHT_MAILPIT_BASE_URL ?? "http://127.0.0.1:18025";

export function hubIdempotencyKey(): string {
  return `e2e-${randomBytes(30).toString("base64url")}`;
}

function originFor(tenant?: string): string {
  return tenant === undefined
    ? HUB_ORIGIN
    : `http://hub-ui.${tenant}.localhost`;
}

export class HubAPI {
  readonly idempotencyKeys = new Set<string>();
  readonly origin: string;

  constructor(
    readonly request: APIRequestContext,
    tenant?: string,
  ) {
    this.origin = originFor(tenant);
  }

  post(
    path: string,
    data?: unknown,
    options: {
      token?: string;
      idempotencyKey?: string;
      timeout?: number;
    } = {},
  ): Promise<APIResponse> {
    const headers: Record<string, string> = {};
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
      this.idempotencyKeys.add(options.idempotencyKey);
    }
    return this.request.post(`${this.origin}/api/hub${path}`, {
      data,
      headers,
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    });
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
    return this.request.post(`${this.origin}/api/hub${path}`, {
      data: body,
      headers,
    });
  }

  get(path: string, token: string): Promise<APIResponse> {
    return this.request.get(`${this.origin}/api/hub${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  mySubscription(token: string): Promise<APIResponse> {
    return this.get("/my-subscription", token);
  }

  setSubscriptionPlan(
    body: SetSubscriptionPlanRequest,
    options: { token: string; idempotencyKey: string; timeout?: number },
  ): Promise<APIResponse> {
    return this.post("/set-subscription-plan", body, options);
  }

  setSubscriptionPlanRaw(
    body: Record<string, unknown> | string,
    options: { token?: string; idempotencyKey?: string } = {},
  ): Promise<APIResponse> {
    return typeof body === "string"
      ? this.postRaw("/set-subscription-plan", body, options)
      : this.post("/set-subscription-plan", body, options);
  }
}
