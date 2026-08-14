import { randomBytes, randomUUID } from "node:crypto";
import type {
  CompleteSetupResponse,
  InviteUserResponse,
} from "typespec/admin/users/invitations";
import type { ListUsersResponse } from "typespec/admin/users/management";
import {
  expectProblem,
  idempotencyKey,
  responseJSON,
} from "../lib/admin-api.ts";
import {
  activeSuperadminCount,
  ageAdminInvitation,
  ageSession,
  createIsolatedSuperadmin,
  emailCredential,
  restoreIsolatedSuperadminTest,
  tenantBootstrapAdminID,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";

test.describe("Admin invitations", () => {
  test("invitation creation normalizes email and supports exact idempotent replay", async ({
    adminAPI,
    superadminToken,
    ownedEmail,
  }) => {
    const email = ownedEmail();
    const key = idempotencyKey();
    const first = await adminAPI.post(
      "/invite-user",
      { email_address: `  ${email.toUpperCase()}  ` },
      { token: superadminToken, idempotencyKey: key },
    );
    expect(first.status()).toBe(201);
    expect(first.headers()["cache-control"]).toBe("no-store");
    const firstBody = await responseJSON<InviteUserResponse>(first);

    const replay = await adminAPI.post(
      "/invite-user",
      { email_address: `  ${email.toUpperCase()}  ` },
      { token: superadminToken, idempotencyKey: key },
    );
    expect(replay.status()).toBe(201);
    expect(await responseJSON<InviteUserResponse>(replay)).toEqual(firstBody);
    expect(emailCredential(email, "invitation", "invitation_token")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
  });

  test("an idempotency key cannot be rebound to a different invitation", async ({
    adminAPI,
    superadminToken,
    ownedEmail,
  }) => {
    const firstEmail = ownedEmail();
    const secondEmail = ownedEmail();
    const key = idempotencyKey();
    expect(
      (
        await adminAPI.post(
          "/invite-user",
          { email_address: firstEmail },
          { token: superadminToken, idempotencyKey: key },
        )
      ).status(),
    ).toBe(201);
    await expectProblem(
      await adminAPI.post(
        "/invite-user",
        { email_address: secondEmail },
        { token: superadminToken, idempotencyKey: key },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );
  });

  test("an expired invitation is atomically replaced and its new token completes setup", async ({
    adminAPI,
    superadminToken,
    ownedEmail,
  }) => {
    const emailAddress = ownedEmail();
    expect(
      (
        await adminAPI.post(
          "/invite-user",
          { email_address: emailAddress },
          { token: superadminToken, idempotencyKey: idempotencyKey() },
        )
      ).status(),
    ).toBe(201);
    const expiredToken = emailCredential(
      emailAddress,
      "invitation",
      "invitation_token",
    );
    ageAdminInvitation(emailAddress);

    expect(
      (
        await adminAPI.post(
          "/invite-user",
          { email_address: emailAddress },
          { token: superadminToken, idempotencyKey: idempotencyKey() },
        )
      ).status(),
    ).toBe(201);
    const replacementToken = emailCredential(
      emailAddress,
      "invitation",
      "invitation_token",
    );
    expect(replacementToken).not.toBe(expiredToken);

    const password = `Replacement!${randomUUID()}-password`;
    const setup = await adminAPI.post(
      "/complete-setup",
      {
        invitation_token: replacementToken,
        password,
        display_names: [
          { language_code: "en-US", display_name: "Replacement Invite" },
        ],
        primary_display_name_language: "en-US",
        preferred_language: "en-US",
        preferred_timezone: "Etc/UTC",
      },
      { idempotencyKey: idempotencyKey() },
    );
    expect(setup.status(), await setup.text()).toBe(201);
    expect(
      (await responseJSON<CompleteSetupResponse>(setup)).admin_user_id,
    ).toMatch(/^[0-9a-f-]{36}$/);
    await adminAPI.passwordSession(emailAddress, password);
  });

  test("complete-setup idempotency keys reject a changed request body", async ({
    adminAPI,
    superadminToken,
    ownedEmail,
  }) => {
    const emailAddress = ownedEmail();
    expect(
      (
        await adminAPI.post(
          "/invite-user",
          { email_address: emailAddress },
          { token: superadminToken, idempotencyKey: idempotencyKey() },
        )
      ).status(),
    ).toBe(201);
    const invitationToken = emailCredential(
      emailAddress,
      "invitation",
      "invitation_token",
    );
    const key = idempotencyKey();
    const request = {
      invitation_token: invitationToken,
      password: `Complete!${randomUUID()}-password`,
      display_names: [
        { language_code: "en-US", display_name: "Original Name" },
      ],
      primary_display_name_language: "en-US",
    };
    expect(
      (
        await adminAPI.post("/complete-setup", request, {
          idempotencyKey: key,
        })
      ).status(),
    ).toBe(201);
    await expectProblem(
      await adminAPI.post(
        "/complete-setup",
        {
          ...request,
          display_names: [
            { language_code: "en-US", display_name: "Changed Name" },
          ],
        },
        { idempotencyKey: key },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );
  });

  test("pending and existing users receive distinct conflicts", async ({
    adminAPI,
    createAdmin,
    superadminToken,
    ownedEmail,
  }) => {
    const pending = ownedEmail();
    expect(
      (
        await adminAPI.post(
          "/invite-user",
          { email_address: pending },
          { token: superadminToken, idempotencyKey: idempotencyKey() },
        )
      ).status(),
    ).toBe(201);
    await expectProblem(
      await adminAPI.post(
        "/invite-user",
        { email_address: pending },
        { token: superadminToken, idempotencyKey: idempotencyKey() },
      ),
      409,
      "vetchium-problem-details/admin-invitation-already-pending",
    );

    const existing = await createAdmin();
    await expectProblem(
      await adminAPI.post(
        "/invite-user",
        { email_address: existing.emailAddress },
        { token: superadminToken, idempotencyKey: idempotencyKey() },
      ),
      409,
      "vetchium-problem-details/admin-user-already-exists",
    );
  });

  test("complete setup rejects invalid credentials and coupled display-name violations", async ({
    adminAPI,
  }) => {
    const opaqueToken = randomBytes(32).toString("base64url");
    await expectProblem(
      await adminAPI.post(
        "/complete-setup",
        {
          invitation_token: opaqueToken,
          password: `Vetchium!${randomUUID()}-password`,
          display_names: [
            { language_code: "en-US", display_name: "Invalid Token" },
          ],
          primary_display_name_language: "en-US",
        },
        { idempotencyKey: idempotencyKey() },
      ),
      401,
      "vetchium-problem-details/invalid-invitation-token",
    );

    await expectProblem(
      await adminAPI.post(
        "/complete-setup",
        {
          invitation_token: opaqueToken,
          password: "short",
          display_names: [],
          primary_display_name_language: "en-US",
        },
        { idempotencyKey: idempotencyKey() },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["password", "display_names", "primary_display_name_language"],
    );
  });

  test("invite requires a valid idempotency key and manage-users permission", async ({
    adminAPI,
    createAdmin,
    ownedEmail,
    superadminToken,
  }) => {
    const regular = await createAdmin();
    await expectProblem(
      await adminAPI.post(
        "/invite-user",
        { email_address: ownedEmail() },
        { token: regular.sessionToken, idempotencyKey: idempotencyKey() },
      ),
      403,
      "vetchium-problem-details/admin-permission-required",
    );
    await expectProblem(
      await adminAPI.post(
        "/invite-user",
        { email_address: ownedEmail() },
        { token: superadminToken, idempotencyKey: "too-short" },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["Idempotency-Key"],
    );
  });
});

test.describe("Admin listing and lifecycle", () => {
  test("list users supports stable pagination and filter-bound keys", async ({
    adminAPI,
    createAdmin,
    superadminToken,
  }) => {
    const filterMarker = randomUUID();
    const created = await Promise.all([
      createAdmin({ displayName: `Pagination ${filterMarker} Alpha` }),
      createAdmin({ displayName: `Pagination ${filterMarker} Beta` }),
      createAdmin({ displayName: `Pagination ${filterMarker} Gamma` }),
    ]);
    const first = await adminAPI.post(
      "/list-users",
      { limit: 2, filter_display_name: filterMarker },
      { token: superadminToken },
    );
    expect(first.status()).toBe(200);
    const firstPage = await responseJSON<ListUsersResponse>(first);
    expect(firstPage.users).toHaveLength(2);
    expect(firstPage.next_pagination_key).toBeDefined();

    const second = await adminAPI.post(
      "/list-users",
      {
        limit: 2,
        filter_display_name: filterMarker,
        pagination_key: firstPage.next_pagination_key,
      },
      { token: superadminToken },
    );
    expect(second.status()).toBe(200);
    const secondPage = await responseJSON<ListUsersResponse>(second);
    const ids = [...firstPage.users, ...secondPage.users].map(
      (user) => user.admin_user_id,
    );
    for (const admin of created) expect(ids).toContain(admin.adminUserID);
    expect(new Set(ids).size).toBe(ids.length);

    await expectProblem(
      await adminAPI.post(
        "/list-users",
        {
          limit: 2,
          filter_display_name: "different-filter",
          pagination_key: firstPage.next_pagination_key,
        },
        { token: superadminToken },
      ),
      400,
      "vetchium-problem-details/invalid-pagination-key",
    );
  });

  test("list users validates limits and opaque pagination keys", async ({
    adminAPI,
    superadminToken,
  }) => {
    await expectProblem(
      await adminAPI.post(
        "/list-users",
        { limit: 0 },
        { token: superadminToken },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["limit"],
    );
    await expectProblem(
      await adminAPI.post(
        "/list-users",
        { pagination_key: randomBytes(32).toString("base64url") },
        { token: superadminToken },
      ),
      400,
      "vetchium-problem-details/invalid-pagination-key",
    );
  });

  test("list users composes email, state, superadmin, and permission filters", async ({
    adminAPI,
    createAdmin,
    superadminToken,
  }) => {
    const target = await createAdmin({ displayName: "Composed Filter Target" });
    expect(
      (
        await adminAPI.post(
          "/grant-permission",
          {
            admin_user_id: target.adminUserID,
            permission: "admin:manage_users",
          },
          { token: superadminToken },
        )
      ).status(),
    ).toBe(204);

    const active = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        {
          filter_email_address: target.emailAddress.toUpperCase(),
          filter_display_name: "composed filter",
          filter_state: "active",
          filter_is_superadmin: false,
          filter_permission: "admin:manage_users",
        },
        { token: superadminToken },
      ),
    );
    expect(active.users.map((user) => user.admin_user_id)).toEqual([
      target.adminUserID,
    ]);

    expect(
      (
        await adminAPI.post(
          "/disable-user",
          { admin_user_id: target.adminUserID },
          { token: superadminToken },
        )
      ).status(),
    ).toBe(204);
    const disabled = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        {
          filter_email_address: target.emailAddress,
          filter_state: "disabled",
        },
        { token: superadminToken },
      ),
    );
    expect(disabled.users.map((user) => user.admin_user_id)).toEqual([
      target.adminUserID,
    ]);
  });

  test("regular users require view-users permission to list", async ({
    adminAPI,
    createAdmin,
  }) => {
    const regular = await createAdmin();
    await expectProblem(
      await adminAPI.post("/list-users", {}, { token: regular.sessionToken }),
      403,
      "vetchium-problem-details/admin-permission-required",
    );
  });

  test("disable revokes sessions and enable does not restore them", async ({
    adminAPI,
    createAdmin,
    superadminToken,
  }) => {
    const target = await createAdmin();
    expect(
      (
        await adminAPI.post(
          "/disable-user",
          { admin_user_id: target.adminUserID },
          { token: superadminToken },
        )
      ).status(),
    ).toBe(204);
    await expectProblem(
      await adminAPI.get("/my-info", target.sessionToken),
      401,
      "vetchium-problem-details/admin-authentication-required",
    );
    await expectProblem(
      await adminAPI.post("/login", {
        email_address: target.emailAddress,
        password: target.password,
      }),
      403,
      "vetchium-problem-details/admin-user-disabled",
    );
    expect(
      (
        await adminAPI.post(
          "/enable-user",
          { admin_user_id: target.adminUserID },
          { token: superadminToken },
        )
      ).status(),
    ).toBe(204);
    const replacement = await adminAPI.passwordSession(
      target.emailAddress,
      target.password,
    );
    expect(replacement.session_token).not.toBe(target.sessionToken);
  });

  test("admins cannot disable themselves or mutate nonexistent users", async ({
    adminAPI,
    createAdmin,
    superadminToken,
  }) => {
    const regular = await createAdmin();
    expect(
      (
        await adminAPI.post(
          "/grant-permission",
          {
            admin_user_id: regular.adminUserID,
            permission: "admin:manage_users",
          },
          { token: superadminToken },
        )
      ).status(),
    ).toBe(204);
    await expectProblem(
      await adminAPI.post(
        "/disable-user",
        { admin_user_id: regular.adminUserID },
        { token: regular.sessionToken },
      ),
      409,
      "vetchium-problem-details/cannot-disable-current-admin",
    );
    await expectProblem(
      await adminAPI.post(
        "/disable-user",
        { admin_user_id: randomUUID() },
        { token: superadminToken },
      ),
      404,
      "vetchium-problem-details/admin-user-not-found",
    );
    await expectProblem(
      await adminAPI.post(
        "/enable-user",
        { admin_user_id: randomUUID() },
        { token: superadminToken },
      ),
      404,
      "vetchium-problem-details/admin-user-not-found",
    );
  });

  test("a delegated manager cannot mutate a superadmin", async ({
    adminAPI,
    createAdmin,
    superadminToken,
  }) => {
    const regular = await createAdmin();
    const superadmin = await responseJSON<{ admin_user_id: string }>(
      await adminAPI.get("/my-info", superadminToken),
    );
    expect(
      (
        await adminAPI.post(
          "/grant-permission",
          {
            admin_user_id: regular.adminUserID,
            permission: "admin:manage_users",
          },
          { token: superadminToken },
        )
      ).status(),
    ).toBe(204);
    await expectProblem(
      await adminAPI.post(
        "/disable-user",
        { admin_user_id: superadmin.admin_user_id },
        { token: regular.sessionToken },
      ),
      403,
      "vetchium-problem-details/superadmin-required",
    );
  });
});

test.describe("Admin authorization management", () => {
  test("authorization mutations require superadmin and report missing targets", async ({
    adminAPI,
    createAdmin,
    superadminToken,
  }) => {
    const regular = await createAdmin();
    const mutations = [
      {
        path: "/grant-permission",
        body: {
          admin_user_id: randomUUID(),
          permission: "admin:view_users",
        },
      },
      {
        path: "/revoke-permission",
        body: {
          admin_user_id: randomUUID(),
          permission: "admin:view_users",
        },
      },
      {
        path: "/promote-to-superadmin",
        body: { admin_user_id: randomUUID() },
      },
      {
        path: "/demote-from-superadmin",
        body: { admin_user_id: randomUUID() },
      },
    ];

    for (const mutation of mutations) {
      await expectProblem(
        await adminAPI.post(mutation.path, mutation.body, {
          token: regular.sessionToken,
        }),
        403,
        "vetchium-problem-details/superadmin-required",
      );
      await expectProblem(
        await adminAPI.post(mutation.path, mutation.body, {
          token: superadminToken,
        }),
        404,
        "vetchium-problem-details/admin-user-not-found",
      );
    }
  });

  test("recent-authentication mutations reject an aged superadmin session", async ({
    adminAPI,
    superadminToken,
  }) => {
    ageSession(superadminToken);
    for (const { path, body } of [
      { path: "/start-totp-enrollment", body: undefined },
      { path: "/regenerate-totp-recovery-codes", body: undefined },
      { path: "/promote-to-superadmin", body: { admin_user_id: randomUUID() } },
      {
        path: "/demote-from-superadmin",
        body: { admin_user_id: randomUUID() },
      },
    ]) {
      await expectProblem(
        await adminAPI.post(path, body, {
          token: superadminToken,
          ...(path.includes("totp")
            ? { idempotencyKey: idempotencyKey() }
            : {}),
        }),
        401,
        "vetchium-problem-details/recent-authentication-required",
      );
    }
  });

  test("manage-users grant implies view-users and dependency ordering is enforced", async ({
    adminAPI,
    createAdmin,
    superadminToken,
  }) => {
    const regular = await createAdmin();
    expect(
      (
        await adminAPI.post(
          "/grant-permission",
          {
            admin_user_id: regular.adminUserID,
            permission: "admin:manage_users",
          },
          { token: superadminToken },
        )
      ).status(),
    ).toBe(204);
    const list = await adminAPI.post(
      "/list-users",
      { limit: 1 },
      { token: regular.sessionToken },
    );
    expect(list.status()).toBe(200);
    await expectProblem(
      await adminAPI.post(
        "/revoke-permission",
        { admin_user_id: regular.adminUserID, permission: "admin:view_users" },
        { token: superadminToken },
      ),
      409,
      "vetchium-problem-details/permission-dependency-conflict",
    );
    expect(
      (
        await adminAPI.post(
          "/revoke-permission",
          {
            admin_user_id: regular.adminUserID,
            permission: "admin:manage_users",
          },
          { token: superadminToken },
        )
      ).status(),
    ).toBe(204);
    expect(
      (
        await adminAPI.post(
          "/list-users",
          { limit: 1 },
          { token: regular.sessionToken },
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await adminAPI.post(
          "/revoke-permission",
          {
            admin_user_id: regular.adminUserID,
            permission: "admin:view_users",
          },
          { token: superadminToken },
        )
      ).status(),
    ).toBe(204);
    await expectProblem(
      await adminAPI.post(
        "/list-users",
        { limit: 1 },
        { token: regular.sessionToken },
      ),
      403,
      "vetchium-problem-details/admin-permission-required",
    );
  });

  test("permissions are not directly applicable to superadmins", async ({
    adminAPI,
    superadminToken,
  }) => {
    const info = await responseJSON<{ admin_user_id: string }>(
      await adminAPI.get("/my-info", superadminToken),
    );
    await expectProblem(
      await adminAPI.post(
        "/revoke-permission",
        { admin_user_id: info.admin_user_id, permission: "admin:view_users" },
        { token: superadminToken },
      ),
      409,
      "vetchium-problem-details/permission-not-applicable",
    );
  });

  test("promotion clears direct permissions and revokes the target session", async ({
    adminAPI,
    createAdmin,
    superadminToken,
  }) => {
    const target = await createAdmin();
    expect(
      (
        await adminAPI.post(
          "/grant-permission",
          {
            admin_user_id: target.adminUserID,
            permission: "admin:manage_users",
          },
          { token: superadminToken },
        )
      ).status(),
    ).toBe(204);
    expect(
      (
        await adminAPI.post(
          "/promote-to-superadmin",
          { admin_user_id: target.adminUserID },
          { token: superadminToken },
        )
      ).status(),
    ).toBe(204);
    await expectProblem(
      await adminAPI.get("/my-info", target.sessionToken),
      401,
      "vetchium-problem-details/admin-authentication-required",
    );
    const promoted = await adminAPI.passwordSession(
      target.emailAddress,
      target.password,
    );
    const info = await responseJSON<{
      is_superadmin: boolean;
      permissions: string[];
    }>(await adminAPI.get("/my-info", promoted.session_token));
    expect(info).toMatchObject({
      is_superadmin: true,
      permissions: ["admin:view_users", "admin:manage_users"],
    });
    expect(
      (
        await adminAPI.post(
          "/demote-from-superadmin",
          { admin_user_id: target.adminUserID },
          { token: superadminToken },
        )
      ).status(),
    ).toBe(204);
  });

  test("a superadmin cannot demote their current principal", async ({
    adminAPI,
    superadminToken,
  }) => {
    const info = await responseJSON<{ admin_user_id: string }>(
      await adminAPI.get("/my-info", superadminToken),
    );
    await expectProblem(
      await adminAPI.post(
        "/demote-from-superadmin",
        { admin_user_id: info.admin_user_id },
        { token: superadminToken },
      ),
      409,
      "vetchium-problem-details/cannot-demote-current-superadmin",
    );
  });

  test("concurrent cross-demotions preserve one active superadmin", async ({
    request,
  }) => {
    const tenant = "deu" as const;
    const emails = [
      `e2e+${randomUUID()}@example.test`,
      `e2e+${randomUUID()}@example.test`,
    ];
    const first = createIsolatedSuperadmin(tenant, emails[0] as string);
    const second = createIsolatedSuperadmin(tenant, emails[1] as string);
    const endpoint =
      "http://admin-ui.deu.localhost/api/admin/demote-from-superadmin";
    const demote = (actorToken: string, targetID: string) =>
      request.post(endpoint, {
        data: { admin_user_id: targetID },
        headers: { Authorization: `Bearer ${actorToken}` },
      });

    try {
      const bootstrapID = tenantBootstrapAdminID(tenant);
      expect((await demote(first.sessionToken, bootstrapID)).status()).toBe(
        204,
      );
      expect(activeSuperadminCount(tenant)).toBe(2);

      const responses = await Promise.all([
        demote(first.sessionToken, second.adminUserID),
        demote(second.sessionToken, first.adminUserID),
      ]);
      const statuses = responses.map((response) => response.status()).sort();
      expect(statuses[0]).toBe(204);
      expect([401, 409]).toContain(statuses[1]);
      expect(activeSuperadminCount(tenant)).toBe(1);
      const rejected = responses.find((response) => response.status() === 409);
      if (rejected !== undefined) {
        await expectProblem(
          rejected,
          409,
          "vetchium-problem-details/last-active-superadmin",
        );
      }
    } finally {
      restoreIsolatedSuperadminTest(tenant, emails);
    }
  });
});
