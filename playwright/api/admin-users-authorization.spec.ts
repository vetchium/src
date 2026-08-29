import { randomBytes, randomUUID } from "node:crypto";
import type {
  CompleteSetupResponse,
  InviteUserResponse,
} from "typespec/admin/users/invitations";
import type { ListUsersResponse } from "typespec/admin/users/management";
import type { MyInfoResponse } from "typespec/admin/users/profile";
import {
  AdminAPI,
  expectProblem,
  idempotencyKey,
  responseJSON,
} from "../lib/admin-api.ts";
import {
  ageAdminInvitation,
  ageSession,
  createAdminForPendingInvitation,
  createSeededManagerSession,
  emailCredential,
  ISOLATED_TENANT,
  isolatedTenantBaseURL,
  seededManagerGrants,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";

test.describe("Admin invitations", () => {
  test("an invitation carries its initial access through account setup", async ({
    adminAPI,
    managerToken,
    ownedEmail,
  }) => {
    const emailAddress = ownedEmail();
    const invitation = await adminAPI.post(
      "/invite-user",
      {
        email_address: `  ${emailAddress.toUpperCase()}  `,
        permissions: ["admin:manage_users"],
      },
      { token: managerToken, idempotencyKey: idempotencyKey() },
    );
    expect(invitation.status()).toBe(201);
    expect(invitation.headers()["cache-control"]).toBe("no-store");
    const invitationBody = await responseJSON<InviteUserResponse>(invitation);
    expect(invitationBody.admin_invitation_id).toMatch(/^[0-9a-f-]{36}$/);

    const password = `Invited!${randomUUID()}-password`;
    const setupRequest = {
      invitation_token: emailCredential(
        emailAddress,
        "invitation",
        "invitation_token",
      ),
      password,
      display_name: "Initial Manager",
      preferred_language: "en-US" as const,
    };
    const setupKey = idempotencyKey();
    const setup = await adminAPI.post("/complete-setup", setupRequest, {
      idempotencyKey: setupKey,
    });
    expect(setup.status(), await setup.text()).toBe(201);
    const { admin_user_id: adminUserID } =
      await responseJSON<CompleteSetupResponse>(setup);

    const listed = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        {
          filter_search: emailAddress,
          filter_permissions: ["admin:manage_users"],
        },
        { token: managerToken },
      ),
    );
    expect(listed.users).toMatchObject([
      {
        admin_user_id: adminUserID,
        email_address: emailAddress,
        display_name: "Initial Manager",
        permissions: ["admin:manage_users", "admin:view_users"],
      },
    ]);
    await expectProblem(
      await adminAPI.post(
        "/complete-setup",
        { ...setupRequest, display_name: "Changed Setup" },
        { idempotencyKey: setupKey },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );
    await adminAPI.passwordSession(emailAddress, password);
  });

  test("invitation idempotency and pending-account conflicts remain distinct", async ({
    adminAPI,
    managerToken,
    ownedEmail,
  }) => {
    const firstEmail = ownedEmail();
    const secondEmail = ownedEmail();
    const key = idempotencyKey();
    const request = {
      email_address: firstEmail,
      permissions: ["admin:view_users"],
    };
    const first = await adminAPI.post("/invite-user", request, {
      token: managerToken,
      idempotencyKey: key,
    });
    expect(first.status()).toBe(201);
    const firstBody = await responseJSON<InviteUserResponse>(first);

    const replay = await adminAPI.post("/invite-user", request, {
      token: managerToken,
      idempotencyKey: key,
    });
    expect(replay.status()).toBe(201);
    expect(await responseJSON<InviteUserResponse>(replay)).toEqual(firstBody);

    await expectProblem(
      await adminAPI.post(
        "/invite-user",
        { email_address: secondEmail, permissions: [] },
        { token: managerToken, idempotencyKey: key },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );
    await expectProblem(
      await adminAPI.post("/invite-user", request, {
        token: managerToken,
        idempotencyKey: idempotencyKey(),
      }),
      409,
      "vetchium-problem-details/admin-invitation-already-pending",
    );
  });

  test("account setup rejects a blank display name", async ({ adminAPI }) => {
    await expectProblem(
      await adminAPI.post(
        "/complete-setup",
        {
          invitation_token: "x".repeat(32),
          password: `Valid!${randomUUID()}-password`,
          display_name: " ",
          preferred_language: "en-US",
        },
        { idempotencyKey: idempotencyKey() },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["display_name"],
    );
  });

  test("an expired invitation is replaced and only the new token is accepted", async ({
    adminAPI,
    managerToken,
    ownedEmail,
  }) => {
    const emailAddress = ownedEmail();
    expect(
      (
        await adminAPI.post(
          "/invite-user",
          { email_address: emailAddress, permissions: [] },
          { token: managerToken, idempotencyKey: idempotencyKey() },
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
          { email_address: emailAddress, permissions: ["admin:view_users"] },
          { token: managerToken, idempotencyKey: idempotencyKey() },
        )
      ).status(),
    ).toBe(201);
    const replacementToken = emailCredential(
      emailAddress,
      "invitation",
      "invitation_token",
    );
    expect(replacementToken).not.toBe(expiredToken);

    await expectProblem(
      await adminAPI.post(
        "/complete-setup",
        {
          invitation_token: expiredToken,
          password: `Expired!${randomUUID()}-password`,
          display_name: "Expired Invite",
          preferred_language: "en-US",
        },
        { idempotencyKey: idempotencyKey() },
      ),
      401,
      "vetchium-problem-details/invalid-invitation-token",
    );
  });

  test("invitation requires manager access", async ({
    adminAPI,
    createAdmin,
    ownedEmail,
  }) => {
    const regular = await createAdmin();
    await expectProblem(
      await adminAPI.post(
        "/invite-user",
        { email_address: ownedEmail(), permissions: [] },
        { token: regular.sessionToken, idempotencyKey: idempotencyKey() },
      ),
      403,
      "vetchium-problem-details/admin-permission-required",
    );
  });

  test("an existing administrator cannot be invited", async ({
    adminAPI,
    createAdmin,
    managerToken,
  }) => {
    const existing = await createAdmin();
    await expectProblem(
      await adminAPI.post(
        "/invite-user",
        { email_address: existing.emailAddress, permissions: [] },
        { token: managerToken, idempotencyKey: idempotencyKey() },
      ),
      409,
      "vetchium-problem-details/admin-user-already-exists",
    );
  });

  test("setup refuses an invitation whose email became occupied", async ({
    adminAPI,
    managerToken,
    ownedEmail,
  }) => {
    const emailAddress = ownedEmail();
    expect(
      (
        await adminAPI.post(
          "/invite-user",
          { email_address: emailAddress, permissions: [] },
          { token: managerToken, idempotencyKey: idempotencyKey() },
        )
      ).status(),
    ).toBe(201);
    const invitationToken = emailCredential(
      emailAddress,
      "invitation",
      "invitation_token",
    );
    createAdminForPendingInvitation(emailAddress);

    await expectProblem(
      await adminAPI.post(
        "/complete-setup",
        {
          invitation_token: invitationToken,
          password: `Occupied!${randomUUID()}-password`,
          display_name: "Occupied Setup",
          preferred_language: "en-US",
        },
        { idempotencyKey: idempotencyKey() },
      ),
      409,
      "vetchium-problem-details/admin-user-already-exists",
    );
  });
});

test.describe("Admin listing and lifecycle", () => {
  test("listing supports unified search and filter-bound pagination", async ({
    adminAPI,
    createAdmin,
    managerToken,
  }) => {
    const marker = randomUUID();
    const created = await Promise.all([
      createAdmin({ displayName: `Pagination ${marker} Alpha` }),
      createAdmin({ displayName: `Pagination ${marker} Beta` }),
      createAdmin({ displayName: `Pagination ${marker} Gamma` }),
    ]);
    const first = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        { limit: 2, filter_search: marker },
        { token: managerToken },
      ),
    );
    expect(first.users).toHaveLength(2);
    expect(first.next_pagination_key).toBeDefined();
    const second = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        {
          limit: 2,
          filter_search: marker,
          pagination_key: first.next_pagination_key,
        },
        { token: managerToken },
      ),
    );
    const ids = [...first.users, ...second.users].map(
      (user) => user.admin_user_id,
    );
    for (const admin of created) expect(ids).toContain(admin.adminUserID);
    expect(new Set(ids).size).toBe(ids.length);

    await expectProblem(
      await adminAPI.post(
        "/list-users",
        {
          limit: 2,
          filter_search: "different-filter",
          pagination_key: first.next_pagination_key,
        },
        { token: managerToken },
      ),
      400,
      "vetchium-problem-details/invalid-pagination-key",
    );
  });

  test("access, account, and security filters compose", async ({
    adminAPI,
    createAdmin,
    managerToken,
  }) => {
    const target = await createAdmin({ displayName: "Composed Filter Target" });
    expect(
      (
        await adminAPI.post(
          "/set-user-permissions",
          {
            admin_user_id: target.adminUserID,
            permissions: ["admin:view_users"],
          },
          { token: managerToken },
        )
      ).status(),
    ).toBe(204);
    const active = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        {
          filter_search: target.emailAddress.toUpperCase(),
          filter_state: "active",
          filter_permissions: ["admin:view_users"],
          filter_totp_enabled: false,
        },
        { token: managerToken },
      ),
    );
    expect(active.users.map((user) => user.admin_user_id)).toEqual([
      target.adminUserID,
    ]);
  });

  test("view access is required to list administrators", async ({
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

  test("manager access is required to disable or enable administrators", async ({
    adminAPI,
    createAdmin,
  }) => {
    const actor = await createAdmin();
    const target = await createAdmin();
    for (const path of ["/disable-user", "/enable-user"] as const) {
      await expectProblem(
        await adminAPI.post(
          path,
          { admin_user_id: target.adminUserID },
          { token: actor.sessionToken },
        ),
        403,
        "vetchium-problem-details/admin-permission-required",
      );
    }
  });

  test("disable revokes sessions and enable does not restore them", async ({
    adminAPI,
    createAdmin,
    managerToken,
  }) => {
    const target = await createAdmin();
    expect(
      (
        await adminAPI.post(
          "/disable-user",
          { admin_user_id: target.adminUserID },
          { token: managerToken },
        )
      ).status(),
    ).toBe(204);
    await expectProblem(
      await adminAPI.get("/my-info", target.sessionToken),
      401,
      "vetchium-problem-details/admin-authentication-required",
    );
    expect(
      (
        await adminAPI.post(
          "/enable-user",
          { admin_user_id: target.adminUserID },
          { token: managerToken },
        )
      ).status(),
    ).toBe(204);
    const replacement = await adminAPI.passwordSession(
      target.emailAddress,
      target.password,
    );
    expect(replacement.session_token).not.toBe(target.sessionToken);
  });

  test("administrators cannot disable themselves or unknown accounts", async ({
    adminAPI,
    createAdmin,
    managerToken,
  }) => {
    const manager = await createAdmin();
    expect(
      (
        await adminAPI.post(
          "/set-user-permissions",
          {
            admin_user_id: manager.adminUserID,
            permissions: ["admin:manage_users"],
          },
          { token: managerToken },
        )
      ).status(),
    ).toBe(204);
    await expectProblem(
      await adminAPI.post(
        "/disable-user",
        { admin_user_id: manager.adminUserID },
        { token: manager.sessionToken },
      ),
      409,
      "vetchium-problem-details/cannot-disable-current-admin",
    );
    for (const path of ["/disable-user", "/enable-user"] as const) {
      await expectProblem(
        await adminAPI.post(
          path,
          { admin_user_id: randomUUID() },
          { token: managerToken },
        ),
        404,
        "vetchium-problem-details/admin-user-not-found",
      );
    }
  });
});

test.describe("Admin access management", () => {
  test("a manager atomically replaces access and implied permissions", async ({
    adminAPI,
    createAdmin,
    managerToken,
  }) => {
    const target = await createAdmin();
    expect(
      (
        await adminAPI.post(
          "/set-user-permissions",
          {
            admin_user_id: target.adminUserID,
            permissions: ["admin:manage_users"],
          },
          { token: managerToken },
        )
      ).status(),
    ).toBe(204);
    const manager = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        { filter_search: target.emailAddress },
        { token: managerToken },
      ),
    );
    expect(manager.users[0]?.permissions).toEqual([
      "admin:manage_users",
      "admin:view_users",
    ]);

    expect(
      (
        await adminAPI.post(
          "/set-user-permissions",
          {
            admin_user_id: target.adminUserID,
            permissions: ["admin:view_users"],
          },
          { token: managerToken },
        )
      ).status(),
    ).toBe(204);
    const viewer = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        {
          filter_search: target.emailAddress,
          filter_permissions: ["admin:view_users"],
        },
        { token: managerToken },
      ),
    );
    expect(viewer.users[0]?.permissions).toEqual(["admin:view_users"]);
  });

  test("access changes require manager permission and recent authentication", async ({
    adminAPI,
    createAdmin,
    managerToken,
  }) => {
    const target = await createAdmin();
    await expectProblem(
      await adminAPI.post(
        "/set-user-permissions",
        { admin_user_id: target.adminUserID, permissions: [] },
        { token: target.sessionToken },
      ),
      403,
      "vetchium-problem-details/admin-permission-required",
    );

    ageSession(managerToken);
    await expectProblem(
      await adminAPI.post(
        "/set-user-permissions",
        { admin_user_id: target.adminUserID, permissions: [] },
        { token: managerToken },
      ),
      401,
      "vetchium-problem-details/admin-recent-authentication-required",
    );
  });

  test("a manager may remove their own management access", async ({
    adminAPI,
    createAdmin,
    managerToken,
  }) => {
    const delegated = await createAdmin();
    expect(
      (
        await adminAPI.post(
          "/set-user-permissions",
          {
            admin_user_id: delegated.adminUserID,
            permissions: ["admin:manage_users"],
          },
          { token: managerToken },
        )
      ).status(),
    ).toBe(204);
    expect(
      (
        await adminAPI.post(
          "/set-user-permissions",
          { admin_user_id: delegated.adminUserID, permissions: [] },
          { token: delegated.sessionToken },
        )
      ).status(),
    ).toBe(204);
    await expectProblem(
      await adminAPI.post("/list-users", {}, { token: delegated.sessionToken }),
      403,
      "vetchium-problem-details/admin-permission-required",
    );
  });

  test("changing access for an unknown administrator returns not found", async ({
    adminAPI,
    managerToken,
  }) => {
    await expectProblem(
      await adminAPI.post(
        "/set-user-permissions",
        { admin_user_id: randomUUID(), permissions: [] },
        { token: managerToken },
      ),
      404,
      "vetchium-problem-details/admin-user-not-found",
    );
  });

  test("opaque list pagination keys are rejected", async ({
    adminAPI,
    managerToken,
  }) => {
    await expectProblem(
      await adminAPI.post(
        "/list-users",
        { pagination_key: randomBytes(32).toString("base64url") },
        { token: managerToken },
      ),
      400,
      "vetchium-problem-details/invalid-pagination-key",
    );
  });
});

test.describe("Admin permission vocabulary", () => {
  test("a permission this API version does not define is refused everywhere", async ({
    adminAPI,
    createAdmin,
    managerToken,
    ownedEmail,
  }) => {
    const target = await createAdmin();
    await expectProblem(
      await adminAPI.post(
        "/set-user-permissions",
        {
          admin_user_id: target.adminUserID,
          permissions: ["admin:view_users", "admin:manage_domains"],
        },
        { token: managerToken },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["permissions"],
    );
    await expectProblem(
      await adminAPI.post(
        "/invite-user",
        {
          email_address: ownedEmail(),
          permissions: ["admin:manage_domains"],
        },
        { token: managerToken, idempotencyKey: idempotencyKey() },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["permissions"],
    );
    await expectProblem(
      await adminAPI.post(
        "/list-users",
        { filter_permissions: ["admin:view_users", "admin:view_users"] },
        { token: managerToken },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["filter_permissions"],
    );

    const listed = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        { filter_search: target.emailAddress },
        { token: managerToken },
      ),
    );
    expect(listed.users[0]?.permissions).toEqual([]);
  });

  test("permission filters match implied grants and unassigned administrators", async ({
    adminAPI,
    createAdmin,
    managerToken,
  }) => {
    const manager = await createAdmin({ displayName: "Filter Manager" });
    const unassigned = await createAdmin({ displayName: "Filter Unassigned" });
    expect(
      (
        await adminAPI.post(
          "/set-user-permissions",
          {
            admin_user_id: manager.adminUserID,
            permissions: ["admin:manage_users"],
          },
          { token: managerToken },
        )
      ).status(),
    ).toBe(204);

    const impliedMatch = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        {
          filter_search: manager.emailAddress,
          filter_permissions: ["admin:view_users"],
        },
        { token: managerToken },
      ),
    );
    expect(impliedMatch.users.map((user) => user.admin_user_id)).toEqual([
      manager.adminUserID,
    ]);

    const both = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        {
          filter_search: manager.emailAddress,
          filter_permissions: ["admin:view_users", "admin:manage_users"],
        },
        { token: managerToken },
      ),
    );
    expect(both.users.map((user) => user.admin_user_id)).toEqual([
      manager.adminUserID,
    ]);

    const excluded = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        {
          filter_search: unassigned.emailAddress,
          filter_permissions: ["admin:view_users"],
        },
        { token: managerToken },
      ),
    );
    expect(excluded.users).toEqual([]);

    const withoutPermissions = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        {
          filter_search: unassigned.emailAddress,
          filter_no_permissions: true,
        },
        { token: managerToken },
      ),
    );
    expect(withoutPermissions.users.map((user) => user.admin_user_id)).toEqual([
      unassigned.adminUserID,
    ]);

    const managerExcluded = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        { filter_search: manager.emailAddress, filter_no_permissions: true },
        { token: managerToken },
      ),
    );
    expect(managerExcluded.users).toEqual([]);
  });

  test("granting a permission that another grant implies stores one grant", async ({
    adminAPI,
    createAdmin,
    managerToken,
  }) => {
    const target = await createAdmin();
    expect(
      (
        await adminAPI.post(
          "/set-user-permissions",
          {
            admin_user_id: target.adminUserID,
            permissions: ["admin:view_users", "admin:manage_users"],
          },
          { token: managerToken },
        )
      ).status(),
    ).toBe(204);
    const listed = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        { filter_search: target.emailAddress },
        { token: managerToken },
      ),
    );
    expect(listed.users[0]?.permissions).toEqual([
      "admin:manage_users",
      "admin:view_users",
    ]);

    expect(
      (
        await adminAPI.post(
          "/set-user-permissions",
          {
            admin_user_id: target.adminUserID,
            permissions: ["admin:view_users"],
          },
          { token: managerToken },
        )
      ).status(),
    ).toBe(204);
    const reduced = await responseJSON<ListUsersResponse>(
      await adminAPI.post(
        "/list-users",
        { filter_search: target.emailAddress },
        { token: managerToken },
      ),
    );
    expect(reduced.users[0]?.permissions).toEqual(["admin:view_users"]);
  });
});

test.describe("Admin management continuity", () => {
  // Runs against a tenant no other test touches: the invariant is tenant-wide
  // and cannot be observed where parallel tests create their own managers.
  test("the last administrator able to manage administrators keeps it", async ({
    playwright,
  }) => {
    const context = await playwright.request.newContext({
      baseURL: isolatedTenantBaseURL(),
    });
    const isolatedAPI = new AdminAPI(context);
    const token = createSeededManagerSession(ISOLATED_TENANT);
    try {
      const me = await responseJSON<MyInfoResponse>(
        await isolatedAPI.get("/my-info", token),
      );
      expect(me.permissions).toContain("admin:manage_users");

      for (const permissions of [[], ["admin:view_users"]]) {
        await expectProblem(
          await isolatedAPI.post(
            "/set-user-permissions",
            { admin_user_id: me.admin_user_id, permissions },
            { token },
          ),
          409,
          "vetchium-problem-details/last-admin-manager",
        );
      }

      expect(seededManagerGrants(ISOLATED_TENANT)).toEqual([
        "admin:manage_hub_signup_domains",
        "admin:manage_users",
      ]);
      const retained = await responseJSON<MyInfoResponse>(
        await isolatedAPI.get("/my-info", token),
      );
      expect(retained.permissions).toEqual([
        "admin:manage_hub_signup_domains",
        "admin:manage_users",
        "admin:view_hub_signup_domains",
        "admin:view_users",
      ]);
    } finally {
      await isolatedAPI.post("/logout", undefined, { token });
      await context.dispose();
    }
  });
});
