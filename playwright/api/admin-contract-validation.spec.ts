import { randomBytes, randomUUID } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { MyInfoResponse } from "typespec/admin/users/profile";
import {
  ADMIN_PATH,
  expectProblem,
  idempotencyKey,
  responseJSON,
} from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";

interface BodyEndpoint {
  path: string;
  body: Record<string, unknown>;
  idempotent?: boolean;
  authenticated?: boolean;
}

const bodyEndpoints: BodyEndpoint[] = [
  {
    path: "/reauthenticate",
    body: { password: "current-password" },
    authenticated: true,
  },
  {
    path: "/login/tfa",
    body: { login_challenge_token: "x".repeat(32), totp_code: "000000" },
    idempotent: true,
  },
  {
    path: "/login/recovery-code",
    body: {
      login_challenge_token: "x".repeat(32),
      recovery_code: "RECOVERY",
    },
    idempotent: true,
  },
  {
    path: "/request-password-reset",
    body: { email_address: "e2e+json@example.test" },
  },
  {
    path: "/complete-password-reset",
    body: {
      reset_token: "x".repeat(32),
      new_password: "Unique!password-value",
    },
    idempotent: true,
  },
  {
    path: "/change-password",
    body: { new_password: "Unique!password-value" },
    authenticated: true,
  },
  {
    path: "/confirm-totp-enrollment",
    body: { totp_enrollment_token: "x".repeat(32), totp_code: "000000" },
    idempotent: true,
    authenticated: true,
  },
  {
    path: "/set-user-permissions",
    body: { admin_user_id: randomUUID(), permissions: ["admin:view_users"] },
    authenticated: true,
  },
  {
    path: "/invite-user",
    body: { email_address: "e2e+json@example.test" },
    idempotent: true,
    authenticated: true,
  },
  {
    path: "/complete-setup",
    body: {
      invitation_token: "x".repeat(32),
      password: "Unique!password-value",
      display_name: "JSON Test",
      preferred_language: "en-US",
    },
    idempotent: true,
  },
  { path: "/list-users", body: {}, authenticated: true },
  { path: "/list-hub-signup-domains", body: {}, authenticated: true },
  {
    path: "/create-hub-signup-domain",
    body: { domain: "e2e-json.example.test" },
    authenticated: true,
  },
  {
    path: "/update-hub-signup-domain",
    body: {
      hub_signup_domain_id: randomUUID(),
      domain: "e2e-json.example.test",
      state: "active",
    },
    authenticated: true,
  },
  {
    path: "/disable-user",
    body: { admin_user_id: randomUUID() },
    authenticated: true,
  },
  {
    path: "/enable-user",
    body: { admin_user_id: randomUUID() },
    authenticated: true,
  },
  {
    path: "/set-preferred-language",
    body: { preferred_language: "en-US" },
    authenticated: true,
  },
  {
    path: "/set-display-name",
    body: { display_name: "JSON Test" },
    authenticated: true,
  },
];

const protectedPostEndpoints = [
  "/reauthenticate",
  "/change-password",
  "/start-totp-enrollment",
  "/confirm-totp-enrollment",
  "/disable-totp",
  "/regenerate-totp-recovery-codes",
  "/set-user-permissions",
  "/invite-user",
  "/list-users",
  "/list-hub-signup-domains",
  "/create-hub-signup-domain",
  "/update-hub-signup-domain",
  "/disable-user",
  "/enable-user",
  "/set-preferred-language",
  "/set-display-name",
] as const;

function rawPost(
  request: APIRequestContext,
  endpoint: BodyEndpoint,
  token: string,
  data: Buffer | Record<string, unknown>,
): Promise<APIResponse> {
  const headers: Record<string, string> = {};
  if (endpoint.authenticated === true)
    headers.Authorization = `Bearer ${token}`;
  if (endpoint.idempotent === true)
    headers["Idempotency-Key"] = idempotencyKey();
  if (Buffer.isBuffer(data)) headers["Content-Type"] = "application/json";
  return request.post(`${ADMIN_PATH}${endpoint.path}`, { data, headers });
}

test.describe("Admin contract validation", () => {
  test("every protected endpoint rejects a missing bearer session", async ({
    adminAPI,
  }) => {
    await expectProblem(
      await adminAPI.get("/my-info"),
      401,
      "vetchium-problem-details/admin-authentication-required",
    );

    for (const path of protectedPostEndpoints) {
      await expectProblem(
        await adminAPI.post(path, {}, { idempotencyKey: idempotencyKey() }),
        401,
        "vetchium-problem-details/admin-authentication-required",
      );
    }
  });

  test("every JSON-body endpoint rejects malformed, unknown, and trailing JSON", async ({
    request,
    managerToken,
  }) => {
    for (const endpoint of bodyEndpoints) {
      await expectProblem(
        await rawPost(request, endpoint, managerToken, Buffer.from("{")),
        400,
        "vetchium-problem-details/invalid-json",
      );
      await expectProblem(
        await rawPost(request, endpoint, managerToken, {
          ...endpoint.body,
          unknown_contract_member: true,
        }),
        400,
        "vetchium-problem-details/invalid-json",
      );
      await expectProblem(
        await rawPost(
          request,
          endpoint,
          managerToken,
          Buffer.from(`${JSON.stringify(endpoint.body)} {}`),
        ),
        400,
        "vetchium-problem-details/invalid-json",
      );
    }
  });

  test("idempotency keys enforce exact 22 and 128 character boundaries", async ({
    adminAPI,
  }) => {
    const body = {
      reset_token: randomBytes(32).toString("base64url"),
      new_password: `Boundary!${randomUUID()}`,
    };
    for (const length of [22, 128]) {
      await expectProblem(
        await adminAPI.post("/complete-password-reset", body, {
          idempotencyKey: `a${"b".repeat(length - 1)}`,
        }),
        401,
        "vetchium-problem-details/invalid-password-reset-token",
      );
    }
    for (const length of [21, 129]) {
      await expectProblem(
        await adminAPI.post("/complete-password-reset", body, {
          idempotencyKey: `a${"b".repeat(length - 1)}`,
        }),
        400,
        "vetchium-problem-details/validation-failed",
        ["Idempotency-Key"],
      );
    }
  });

  test("opaque tokens and new passwords enforce their exact length boundaries", async ({
    adminAPI,
  }) => {
    const validPassword = `Boundary!${randomUUID()}`;
    for (const length of [32, 4096]) {
      await expectProblem(
        await adminAPI.post(
          "/complete-password-reset",
          { reset_token: "x".repeat(length), new_password: validPassword },
          { idempotencyKey: idempotencyKey() },
        ),
        401,
        "vetchium-problem-details/invalid-password-reset-token",
      );
    }
    for (const length of [31, 4097]) {
      await expectProblem(
        await adminAPI.post(
          "/complete-password-reset",
          { reset_token: "x".repeat(length), new_password: validPassword },
          { idempotencyKey: idempotencyKey() },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["reset_token"],
      );
    }

    const invalidToken = randomBytes(32).toString("base64url");
    for (const new_password of [
      "A1!".padEnd(15, "x"),
      "A1!".padEnd(128, "x"),
    ]) {
      await expectProblem(
        await adminAPI.post(
          "/complete-password-reset",
          { reset_token: invalidToken, new_password },
          { idempotencyKey: idempotencyKey() },
        ),
        401,
        "vetchium-problem-details/invalid-password-reset-token",
      );
    }
    for (const new_password of [
      "A1!".padEnd(14, "x"),
      "A1!".padEnd(129, "x"),
    ]) {
      await expectProblem(
        await adminAPI.post(
          "/complete-password-reset",
          { reset_token: invalidToken, new_password },
          { idempotencyKey: idempotencyKey() },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["new_password"],
      );
    }
  });

  test("email and recovery-code scalars enforce their exact boundaries", async ({
    adminAPI,
  }) => {
    const maximumEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
    expect(maximumEmail).toHaveLength(254);
    expect(
      (
        await adminAPI.post("/request-password-reset", {
          email_address: maximumEmail,
        })
      ).status(),
    ).toBe(202);
    for (const email_address of [
      `${"a".repeat(65)}@example.test`,
      `${maximumEmail}x`,
    ]) {
      await expectProblem(
        await adminAPI.post("/request-password-reset", { email_address }),
        400,
        "vetchium-problem-details/validation-failed",
        ["email_address"],
      );
    }

    const challenge = randomBytes(32).toString("base64url");
    for (const length of [8, 128]) {
      await expectProblem(
        await adminAPI.post(
          "/login/recovery-code",
          {
            login_challenge_token: challenge,
            recovery_code: "A".repeat(length),
          },
          { idempotencyKey: idempotencyKey() },
        ),
        401,
        "vetchium-problem-details/invalid-login-challenge",
      );
    }
    for (const length of [7, 129]) {
      await expectProblem(
        await adminAPI.post(
          "/login/recovery-code",
          {
            login_challenge_token: challenge,
            recovery_code: "A".repeat(length),
          },
          { idempotencyKey: idempotencyKey() },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["recovery_code"],
      );
    }
  });

  test("list-users returns an empty array and enforces scalar boundaries", async ({
    adminAPI,
    managerToken,
  }) => {
    const empty = await adminAPI.post(
      "/list-users",
      { filter_search: `absent-${randomUUID()}@example.test` },
      { token: managerToken },
    );
    expect(empty.status()).toBe(200);
    expect(await responseJSON(empty)).toEqual({ users: [] });

    for (const limit of [1, 100]) {
      expect(
        (
          await adminAPI.post("/list-users", { limit }, { token: managerToken })
        ).status(),
      ).toBe(200);
    }
    for (const limit of [0, 101]) {
      await expectProblem(
        await adminAPI.post("/list-users", { limit }, { token: managerToken }),
        400,
        "vetchium-problem-details/validation-failed",
        ["limit"],
      );
    }
    for (const length of [1, 320]) {
      expect(
        (
          await adminAPI.post(
            "/list-users",
            { filter_search: "z".repeat(length) },
            { token: managerToken },
          )
        ).status(),
      ).toBe(200);
    }
    for (const length of [0, 321]) {
      await expectProblem(
        await adminAPI.post(
          "/list-users",
          { filter_search: "z".repeat(length) },
          { token: managerToken },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["filter_search"],
      );
    }
    for (const length of [1, 4096]) {
      await expectProblem(
        await adminAPI.post(
          "/list-users",
          { pagination_key: "x".repeat(length) },
          { token: managerToken },
        ),
        400,
        "vetchium-problem-details/invalid-pagination-key",
      );
    }
    for (const length of [0, 4097]) {
      await expectProblem(
        await adminAPI.post(
          "/list-users",
          { pagination_key: "x".repeat(length) },
          { token: managerToken },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["pagination_key"],
      );
    }
  });

  test("lifecycle and authorization inputs reject invalid UUIDs and enums", async ({
    adminAPI,
    managerToken,
  }) => {
    for (const path of ["/disable-user", "/enable-user"]) {
      await expectProblem(
        await adminAPI.post(
          path,
          { admin_user_id: "not-a-uuid" },
          { token: managerToken },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["admin_user_id"],
      );
    }

    await expectProblem(
      await adminAPI.post(
        "/set-user-permissions",
        { admin_user_id: "not-a-uuid", permissions: ["admin:view_users"] },
        { token: managerToken },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["admin_user_id"],
    );
    await expectProblem(
      await adminAPI.post(
        "/set-user-permissions",
        { admin_user_id: randomUUID(), permissions: ["admin:unknown"] },
        { token: managerToken },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["permissions"],
    );

    for (const [field, value] of [
      ["filter_state", "pending"],
      ["filter_permissions", ["admin:manage_domains"]],
      ["filter_last_login", "recent"],
    ] as const) {
      await expectProblem(
        await adminAPI.post(
          "/list-users",
          { [field]: value },
          { token: managerToken },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        [field],
      );
    }
  });

  test("display name accepts exact 1 and 200 character boundaries", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    for (const length of [1, 200]) {
      const response = await adminAPI.post(
        "/set-display-name",
        { display_name: "x".repeat(length) },
        { token: admin.sessionToken },
      );
      expect(response.status()).toBe(204);
      const info = await responseJSON<MyInfoResponse>(
        await adminAPI.get("/my-info", admin.sessionToken),
      );
      expect(info.display_name).toHaveLength(length);
    }
    for (const length of [0, 201]) {
      await expectProblem(
        await adminAPI.post(
          "/set-display-name",
          { display_name: "x".repeat(length) },
          { token: admin.sessionToken },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["display_name"],
      );
    }
  });
});
