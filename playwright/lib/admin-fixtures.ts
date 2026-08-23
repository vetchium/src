import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type APIRequestContext,
  type APIResponse,
  test as base,
  expect,
  type Response,
} from "@playwright/test";
import type { AdminUserID } from "typespec/admin/types";
import type {
  CompleteSetupResponse,
  InviteUserResponse,
} from "typespec/admin/users/invitations";
import { AdminAPI, idempotencyKey, responseJSON } from "./admin-api.ts";
import {
  cleanupAdmin,
  cleanupAdminIdempotency,
  cleanupHubSignupDomain,
  createSeededManagerSession,
  emailCredential,
} from "./admin-db.ts";

export const SEEDED_ADMIN_EMAIL = "admin@sgp.example";
export const SEEDED_ADMIN_PASSWORD = "DevPassword123$";

export interface CreatedAdmin {
  adminUserID: AdminUserID;
  emailAddress: string;
  password: string;
  sessionToken: string;
}

interface AdminFixtures {
  apiCoverage: APIObservation[];
  adminAPI: AdminAPI;
  managerToken: string;
  ownedEmail: () => string;
  ownedDomain: (label?: string) => string;
  createAdmin: (options?: {
    displayName?: string;
    password?: string;
  }) => Promise<CreatedAdmin>;
}

interface APIObservation {
  method: string;
  path: string;
  status: number;
  problemType?: string;
}

function recordPath(url: string): string | undefined {
  const path = new URL(url).pathname;
  return path.startsWith("/api/") ? path : undefined;
}

function problemType(body: unknown): string | undefined {
  if (
    typeof body === "object" &&
    body !== null &&
    "type" in body &&
    typeof body.type === "string" &&
    body.type.startsWith("vetchium-problem-details/")
  ) {
    return body.type;
  }
  return undefined;
}

async function observeAPIResponse(
  observations: APIObservation[],
  method: string,
  response: APIResponse,
): Promise<void> {
  const path = recordPath(response.url());
  if (path === undefined) return;
  const observation: APIObservation = {
    method,
    path,
    status: response.status(),
  };
  if (response.headers()["content-type"]?.includes("json")) {
    try {
      const type = problemType(await response.json());
      if (type !== undefined) observation.problemType = type;
    } catch {
      // Empty and intentionally malformed responses have no problem type.
    }
  }
  observations.push(observation);
}

async function observeBrowserResponse(
  observations: APIObservation[],
  response: Response,
): Promise<void> {
  const path = recordPath(response.url());
  if (path === undefined) return;
  const observation: APIObservation = {
    method: response.request().method(),
    path,
    status: response.status(),
  };
  if (response.headers()["content-type"]?.includes("json")) {
    try {
      const type = problemType(await response.json());
      if (type !== undefined) observation.problemType = type;
    } catch {
      // The page may close before an optional response body is available.
    }
  }
  observations.push(observation);
}

function fetchMethod(options: unknown): string {
  if (
    typeof options === "object" &&
    options !== null &&
    "method" in options &&
    typeof options.method === "string"
  ) {
    return options.method.toUpperCase();
  }
  return "GET";
}

function trackedRequestContext(
  request: APIRequestContext,
  observations: APIObservation[],
): APIRequestContext {
  const methods = new Set([
    "delete",
    "fetch",
    "get",
    "head",
    "patch",
    "post",
    "put",
  ]);
  return new Proxy(request, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (typeof property !== "string" || !methods.has(property)) {
        return value.bind(target);
      }
      return async (...args: unknown[]) => {
        const response = (await Reflect.apply(
          value,
          target,
          args,
        )) as APIResponse;
        const method =
          property === "fetch" ? fetchMethod(args[1]) : property.toUpperCase();
        await observeAPIResponse(observations, method, response);
        return response;
      };
    },
  });
}

export const test = base.extend<AdminFixtures>({
  apiCoverage: [
    async ({ browserName: _browserName }, use, testInfo) => {
      const observations: APIObservation[] = [];
      await use(observations);
      const directory = process.env.API_COVERAGE_DIR;
      if (directory === undefined) return;
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, `${randomUUID()}.json`),
        `${JSON.stringify({
          test: testInfo.titlePath,
          observations,
        })}\n`,
      );
    },
    { auto: true },
  ],
  request: async ({ apiCoverage, request }, use) => {
    await use(trackedRequestContext(request, apiCoverage));
  },
  page: async ({ apiCoverage, page }, use) => {
    const pending = new Set<Promise<void>>();
    const listener = (response: Response) => {
      const observation = observeBrowserResponse(apiCoverage, response);
      pending.add(observation);
      void observation.then(
        () => pending.delete(observation),
        () => pending.delete(observation),
      );
    };
    page.on("response", listener);
    await use(page);
    page.off("response", listener);
    await Promise.all(pending);
  },
  adminAPI: async ({ request }, use) => {
    const keys = new Set<string>();
    await use(new AdminAPI(request, (key) => keys.add(key)));
    cleanupAdminIdempotency(keys);
  },
  managerToken: async ({ adminAPI }, use) => {
    const token = createSeededManagerSession();
    await use(token);
    await adminAPI.post("/logout", undefined, { token });
  },
  ownedEmail: async ({ request: _request }, use) => {
    const emails = new Set<string>();
    await use(() => {
      const email = `e2e+${randomUUID()}@example.test`;
      emails.add(email);
      return email;
    });
    for (const email of emails) cleanupAdmin(email);
  },
  ownedDomain: async ({ request: _request }, use) => {
    const domains = new Set<string>();
    await use((label = "domain") => {
      if (!/^[a-z0-9-]{1,16}$/.test(label)) {
        throw new Error(`invalid test-domain label: ${label}`);
      }
      const domain = `e2e-${label}-${randomUUID()}.example.test`;
      domains.add(domain);
      return domain;
    });
    for (const domain of domains) cleanupHubSignupDomain(domain);
  },
  createAdmin: async ({ adminAPI, managerToken, ownedEmail }, use) => {
    await use(async (options = {}) => {
      const emailAddress = ownedEmail();
      const password = options.password ?? `Vetchium!${randomUUID()}-password`;
      const invitation = await adminAPI.post(
        "/invite-user",
        { email_address: emailAddress, permissions: [] },
        { token: managerToken, idempotencyKey: idempotencyKey() },
      );
      expect(invitation.status(), await invitation.text()).toBe(201);
      const invitationBody = await responseJSON<InviteUserResponse>(invitation);
      expect(invitationBody.admin_invitation_id).toMatch(/^[0-9a-f-]{36}$/);
      const invitationToken = emailCredential(
        emailAddress,
        "invitation",
        "invitation_token",
      );
      const setup = await adminAPI.post(
        "/complete-setup",
        {
          invitation_token: invitationToken,
          password,
          display_name: options.displayName ?? `E2E ${emailAddress}`,
          preferred_language: "en-US",
        },
        { idempotencyKey: idempotencyKey() },
      );
      expect(setup.status(), await setup.text()).toBe(201);
      const { admin_user_id: adminUserID } =
        await responseJSON<CompleteSetupResponse>(setup);
      const session = await adminAPI.passwordSession(emailAddress, password);
      return {
        adminUserID,
        emailAddress,
        password,
        sessionToken: session.session_token,
      };
    });
  },
});

export { expect };
