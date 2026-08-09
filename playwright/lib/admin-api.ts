import {
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
  AuthenticationStateAuthenticated,
  type LoginResponse,
} from "vetchium-specs/admin/auth/login";
import type { AuthenticatedSessionResponse } from "vetchium-specs/admin/common/types";
import { isIdempotencyKey } from "vetchium-specs/common/idempotency";

export const ADMIN_PATH = "/api/admin";

export function idempotencyKey(): string {
  return `e2e-${randomBytes(30).toString("base64url")}`;
}

export async function responseJSON<T>(response: APIResponse): Promise<T> {
  return (await response.json()) as T;
}

export async function expectProblem(
  response: APIResponse,
  status: number,
  type: string,
  fields?: string[],
): Promise<void> {
  expect(response.status(), await response.text()).toBe(status);
  expect(response.headers()["content-type"]).toContain(
    "application/problem+json",
  );
  const body = await responseJSON<{
    type: string;
    status: number;
    fields?: string[];
  }>(response);
  expect(body.type).toBe(type);
  expect(body.status).toBe(status);
  if (fields !== undefined) expect(body.fields).toEqual(fields);
}

export class AdminAPI {
  constructor(
    readonly request: APIRequestContext,
    private readonly recordIdempotencyKey: (key: string) => void = () => {},
  ) {}

  post(
    path: string,
    data?: unknown,
    options: {
      token?: string;
      idempotencyKey?: string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<APIResponse> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.token !== undefined) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    if (options.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = options.idempotencyKey;
      if (
        options.idempotencyKey.startsWith("e2e-") &&
        isIdempotencyKey(options.idempotencyKey)
      ) {
        this.recordIdempotencyKey(options.idempotencyKey);
      }
    }
    return this.request.post(`${ADMIN_PATH}${path}`, { data, headers });
  }

  get(path: string, token?: string): Promise<APIResponse> {
    return this.request.get(`${ADMIN_PATH}${path}`, {
      headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
    });
  }

  async login(emailAddress: string, password: string): Promise<LoginResponse> {
    const response = await this.post("/login", {
      email_address: emailAddress,
      password,
    });
    if (response.status() !== 200) {
      throw new Error(
        `login failed (${response.status()}): ${await response.text()}`,
      );
    }
    return responseJSON<LoginResponse>(response);
  }

  async passwordSession(
    emailAddress: string,
    password: string,
  ): Promise<AuthenticatedSessionResponse> {
    const result = await this.login(emailAddress, password);
    if (result.authentication_state !== AuthenticationStateAuthenticated) {
      throw new Error(`expected password-only login for ${emailAddress}`);
    }
    return result;
  }
}
