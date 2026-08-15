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
    path: "/grant-permission",
    body: { admin_user_id: randomUUID(), permission: "admin:view_users" },
    authenticated: true,
  },
  {
    path: "/revoke-permission",
    body: { admin_user_id: randomUUID(), permission: "admin:view_users" },
    authenticated: true,
  },
  {
    path: "/promote-to-superadmin",
    body: { admin_user_id: randomUUID() },
    authenticated: true,
  },
  {
    path: "/demote-from-superadmin",
    body: { admin_user_id: randomUUID() },
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
      display_names: [{ language_code: "en-US", display_name: "JSON Test" }],
      primary_display_name_language: "en-US",
      preferred_language: "en-US",
    },
    idempotent: true,
  },
  { path: "/list-users", body: {}, authenticated: true },
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
    path: "/set-display-names",
    body: {
      display_names: [{ language_code: "en-US", display_name: "JSON Test" }],
      primary_display_name_language: "en-US",
    },
    authenticated: true,
  },
];

const protectedPostEndpoints = [
  "/change-password",
  "/start-totp-enrollment",
  "/confirm-totp-enrollment",
  "/disable-totp",
  "/regenerate-totp-recovery-codes",
  "/grant-permission",
  "/revoke-permission",
  "/promote-to-superadmin",
  "/demote-from-superadmin",
  "/invite-user",
  "/list-users",
  "/disable-user",
  "/enable-user",
  "/set-preferred-language",
  "/set-display-names",
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
    superadminToken,
  }) => {
    for (const endpoint of bodyEndpoints) {
      await expectProblem(
        await rawPost(request, endpoint, superadminToken, Buffer.from("{")),
        400,
        "vetchium-problem-details/invalid-json",
      );
      await expectProblem(
        await rawPost(request, endpoint, superadminToken, {
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
          superadminToken,
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
    superadminToken,
  }) => {
    const empty = await adminAPI.post(
      "/list-users",
      { filter_email_address: `absent-${randomUUID()}@example.test` },
      { token: superadminToken },
    );
    expect(empty.status()).toBe(200);
    expect(await responseJSON(empty)).toEqual({ users: [] });

    for (const limit of [1, 100]) {
      expect(
        (
          await adminAPI.post(
            "/list-users",
            { limit },
            { token: superadminToken },
          )
        ).status(),
      ).toBe(200);
    }
    for (const limit of [0, 101]) {
      await expectProblem(
        await adminAPI.post(
          "/list-users",
          { limit },
          { token: superadminToken },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["limit"],
      );
    }
    for (const length of [1, 320]) {
      for (const filter of [
        "filter_display_name",
        "filter_email_address",
      ] as const) {
        expect(
          (
            await adminAPI.post(
              "/list-users",
              { [filter]: "z".repeat(length) },
              { token: superadminToken },
            )
          ).status(),
        ).toBe(200);
      }
    }
    for (const length of [0, 321]) {
      for (const filter of [
        "filter_display_name",
        "filter_email_address",
      ] as const) {
        await expectProblem(
          await adminAPI.post(
            "/list-users",
            { [filter]: "z".repeat(length) },
            { token: superadminToken },
          ),
          400,
          "vetchium-problem-details/validation-failed",
          [filter],
        );
      }
    }
    for (const length of [1, 4096]) {
      await expectProblem(
        await adminAPI.post(
          "/list-users",
          { pagination_key: "x".repeat(length) },
          { token: superadminToken },
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
          { token: superadminToken },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["pagination_key"],
      );
    }
  });

  test("lifecycle and authorization inputs reject invalid UUIDs and enums", async ({
    adminAPI,
    superadminToken,
  }) => {
    for (const path of [
      "/disable-user",
      "/enable-user",
      "/promote-to-superadmin",
      "/demote-from-superadmin",
    ]) {
      await expectProblem(
        await adminAPI.post(
          path,
          { admin_user_id: "not-a-uuid" },
          { token: superadminToken },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["admin_user_id"],
      );
    }

    for (const path of ["/grant-permission", "/revoke-permission"]) {
      await expectProblem(
        await adminAPI.post(
          path,
          { admin_user_id: "not-a-uuid", permission: "admin:view_users" },
          { token: superadminToken },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["admin_user_id"],
      );
      await expectProblem(
        await adminAPI.post(
          path,
          { admin_user_id: randomUUID(), permission: "admin:unknown" },
          { token: superadminToken },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["permission"],
      );
    }

    for (const [field, value] of [
      ["filter_state", "pending"],
      ["filter_permission", "admin:unknown"],
    ] as const) {
      await expectProblem(
        await adminAPI.post(
          "/list-users",
          { [field]: value },
          { token: superadminToken },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        [field],
      );
    }
  });

  test("display names accept exact 1 and 200 character boundaries", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    for (const length of [1, 200]) {
      const response = await adminAPI.post(
        "/set-display-names",
        {
          display_names: [
            { language_code: "en-US", display_name: "x".repeat(length) },
          ],
          primary_display_name_language: "en-US",
        },
        { token: admin.sessionToken },
      );
      expect(response.status()).toBe(204);
      const info = await responseJSON<MyInfoResponse>(
        await adminAPI.get("/my-info", admin.sessionToken),
      );
      expect(info.display_names[0]?.display_name).toHaveLength(length);
    }
    for (const length of [0, 201]) {
      await expectProblem(
        await adminAPI.post(
          "/set-display-names",
          {
            display_names: [
              { language_code: "en-US", display_name: "x".repeat(length) },
            ],
            primary_display_name_language: "en-US",
          },
          { token: admin.sessionToken },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["display_names"],
      );
    }
  });
});
