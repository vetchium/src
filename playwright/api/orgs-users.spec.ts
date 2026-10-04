import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import type { ListPermissionsResponse } from "typespec/orgs/authorization/management";
import type {
  ListUsersResponse,
  UserSummaryResponse,
} from "typespec/orgs/users/management";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  inviteeAddress,
  loginOrg,
  type OrgMember,
  OrgsAPI,
  orgInfo,
  orgSQL,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";

const authenticationRequired =
  "vetchium-problem-details/org-authentication-required";
const recentRequired =
  "vetchium-problem-details/org-recent-authentication-required";
const permissionRequired = "vetchium-problem-details/org-permission-required";
const superadminRequired = "vetchium-problem-details/org-superadmin-required";
const orgSuspended = "vetchium-problem-details/org-suspended";
const limitReached = "vetchium-problem-details/org-user-limit-reached";
const userNotFound = "vetchium-problem-details/org-user-not-found";
const selfChange = "vetchium-problem-details/org-self-change-forbidden";
const lastSuperadmin = "vetchium-problem-details/org-last-superadmin";
const userDisabled = "vetchium-problem-details/org-user-disabled";
const validationFailed = "vetchium-problem-details/validation-failed";
const invalidJSON = "vetchium-problem-details/invalid-json";
const invalidPaginationKey = "vetchium-problem-details/invalid-pagination-key";

interface Fixture {
  api: OrgsAPI;
  org: SignedUpOrg;
  owner: string;
}

async function withOrg(
  request: Page["request"],
  body: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    await body({ api, org, owner });
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
}

function suspend(org: SignedUpOrg): void {
  orgSQL(
    `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
     WHERE org_did = (SELECT org_did FROM vetchium.org_domains
                      WHERE domain = '${org.domain}')`,
  );
}

function ageSessions(emailAddress: string): void {
  orgSQL(
    `UPDATE vetchium.org_sessions
     SET created_at = now() - interval '10 minutes',
         authenticated_at = now() - interval '10 minutes'
     WHERE org_user_id IN (
       SELECT org_user_id FROM vetchium.org_users
       WHERE email_address = '${emailAddress}'
     )`,
  );
}

async function listed(
  api: OrgsAPI,
  token: string,
  request: Parameters<OrgsAPI["listUsers"]>[1] = {},
): Promise<ListUsersResponse> {
  const response = await api.listUsers(token, request);
  expect(response.status(), await response.text()).toBe(200);
  return responseJSON<ListUsersResponse>(response);
}

function emails(response: ListUsersResponse): string[] {
  return response.users.map((user) => user.email_address);
}

test.describe("list-users and user-summary", () => {
  test("lists, searches, filters, sorts, and pages", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const finance = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "fin"),
        ["org:manage_billing"],
      );
      const manager = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "mgr"),
        ["org:manage_users"],
      );
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "mem"),
        [],
      );
      const everyone = [
        org.emailAddress,
        finance.emailAddress,
        manager.emailAddress,
        member.emailAddress,
      ];

      const all = await listed(api, owner);
      expect(emails(all)).toEqual([...everyone].sort());
      const owned = all.users.find((u) => u.email_address === org.emailAddress);
      expect(owned?.granted_permissions).toEqual(["org:superadmin"]);
      expect(owned?.effective_permissions).toEqual([
        "org:manage_billing",
        "org:manage_users",
        "org:superadmin",
      ]);
      expect(owned?.state).toBe("active");
      expect(owned?.disabled_reason).toBeUndefined();
      expect(owned?.last_login_at).toBeDefined();

      const response = await api.listUsers(owner);
      expect(response.headers()["cache-control"]).toBe("no-store");

      expect(
        emails(await listed(api, owner, { filter_search: "FIN-" })),
      ).toEqual([finance.emailAddress]);
      expect(
        emails(
          await listed(api, owner, { filter_permission: "org:manage_billing" }),
        ),
      ).toEqual([finance.emailAddress]);
      expect(
        emails(await listed(api, owner, { filter_no_permissions: true })),
      ).toEqual([member.emailAddress]);
      expect(
        emails(await listed(api, owner, { filter_state: "disabled-manual" })),
      ).toEqual([]);

      const joined = await listed(api, owner, { sort_by: "joined" });
      expect(emails(joined)).toEqual(everyone);
      const newest = await listed(api, owner, {
        sort_by: "joined",
        sort_descending: true,
      });
      expect(emails(newest)).toEqual([...everyone].reverse());
      const reversed = await listed(api, owner, { sort_descending: true });
      expect(emails(reversed)).toEqual([...everyone].sort().reverse());

      const first = await listed(api, owner, { limit: 3, sort_by: "joined" });
      expect(emails(first)).toEqual(everyone.slice(0, 3));
      expect(first.next_pagination_key).toBeDefined();
      const second = await listed(api, owner, {
        limit: 3,
        sort_by: "joined",
        pagination_key: first.next_pagination_key ?? "",
      });
      expect(emails(second)).toEqual(everyone.slice(3));
      expect(second.next_pagination_key).toBeUndefined();

      const byEmail = await listed(api, owner, { limit: 2 });
      const rest = await listed(api, owner, {
        limit: 2,
        pagination_key: byEmail.next_pagination_key ?? "",
      });
      expect([...emails(byEmail), ...emails(rest)]).toEqual(
        [...everyone].sort(),
      );

      // A key is bound to the filters and sort it was issued for.
      await expectProblem(
        await api.listUsers(owner, {
          limit: 3,
          sort_by: "email",
          pagination_key: first.next_pagination_key ?? "",
        }),
        400,
        invalidPaginationKey,
      );
      await expectProblem(
        await api.listUsers(owner, {
          pagination_key: randomBytes(32).toString("base64url"),
        }),
        400,
        invalidPaginationKey,
      );
    });
  });

  test("shows disabled users with their reason", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const manual = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      const unpaid = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      expect(
        (
          await api.disableUser(owner, { email_address: manual.emailAddress })
        ).status(),
      ).toBe(204);
      orgSQL(
        `UPDATE vetchium.org_users
         SET org_user_state = 'disabled', disabled_reason = 'manual',
             disabled_at = now()
         WHERE email_address = '${unpaid.emailAddress}'`,
      );
      const manualOnly = await listed(api, owner, {
        filter_state: "disabled-manual",
      });
      expect(emails(manualOnly).sort()).toEqual(
        [manual.emailAddress, unpaid.emailAddress].sort(),
      );
      expect(manualOnly.users[0]?.disabled_reason).toBe("manual");
      expect(
        emails(await listed(api, owner, { filter_state: "active" })),
      ).toEqual([org.emailAddress]);

      const summary = await responseJSON<UserSummaryResponse>(
        await api.userSummary(owner),
      );
      expect(summary).toMatchObject({
        seats_in_use: 1,
        seat_limit: 5,
        active_users: 1,
        disabled_manual_users: 2,
        active_users_without_permissions: 0,
        permission_counts: [{ permission: "org:superadmin", users: 1 }],
      });
    });
  });

  test("summarizes seats, states, and roles", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      await addOrgMember(api, owner, org.domain, inviteeAddress(org.domain), [
        "org:manage_users",
      ]);
      await api.inviteUsers(owner, {
        email_addresses: [inviteeAddress(org.domain)],
      });
      const response = await api.userSummary(owner);
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await responseJSON<UserSummaryResponse>(response)).toEqual({
        seats_in_use: 4,
        seat_limit: 5,
        active_users: 3,
        disabled_manual_users: 0,
        active_users_without_permissions: 1,
        permission_counts: [
          { permission: "org:manage_users", users: 1 },
          { permission: "org:superadmin", users: 1 },
        ],
      });
    });
  });

  test("validates, authenticates, and authorizes", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      for (const [body, fields] of [
        [{ limit: 0 }, ["limit"]],
        [{ limit: 101 }, ["limit"]],
        [{ filter_search: "a" }, ["filter_search"]],
        [{ filter_state: "gone" }, ["filter_state"]],
        [{ filter_permission: "org:future" }, ["filter_permission"]],
        [{ sort_by: "name" }, ["sort_by"]],
      ] as const) {
        await expectProblem(
          await api.listUsers(owner, body as never),
          400,
          validationFailed,
          [...fields],
        );
      }
      const raw = await request.post(`${api.origin}/api/orgs/list-users`, {
        data: "{",
        headers: {
          Authorization: `Bearer ${owner}`,
          "Content-Type": "application/json",
        },
      });
      await expectProblem(raw, 400, invalidJSON);
      await expectProblem(
        await api.post("/list-users", {}),
        401,
        authenticationRequired,
      );
      await expectProblem(
        await api.post("/user-summary"),
        401,
        authenticationRequired,
      );
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      await expectProblem(
        await api.listUsers(member.token),
        403,
        permissionRequired,
      );
      await expectProblem(
        await api.userSummary(member.token),
        403,
        permissionRequired,
      );
      suspend(org);
      await expectProblem(await api.listUsers(owner), 403, orgSuspended);
      await expectProblem(await api.userSummary(owner), 403, orgSuspended);
    });
  });
});

test.describe("list-permissions", () => {
  test("returns the catalog with its implications", async ({ request }) => {
    await withOrg(request, async ({ api, owner }) => {
      const response = await api.listPermissions(owner);
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await responseJSON<ListPermissionsResponse>(response)).toEqual({
        permissions: [
          { permission: "org:manage_billing", implies: [] },
          { permission: "org:manage_users", implies: [] },
          {
            permission: "org:superadmin",
            implies: ["org:manage_billing", "org:manage_users"],
          },
        ],
      });
      await expectProblem(
        await api.listPermissions(),
        401,
        authenticationRequired,
      );
    });
  });
});

test.describe("disable-user and bulk-disable-users", () => {
  test("disables a user, ends the session, and frees the seat", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      const response = await api.disableUser(owner, {
        email_address: member.emailAddress.toUpperCase(),
      });
      expect(response.status(), await response.text()).toBe(204);
      expect(response.headers()["cache-control"]).toBe("no-store");

      await expectProblem(
        await api.myInfo(member.token),
        401,
        authenticationRequired,
      );
      await expectProblem(
        await api.post("/login", {
          domain: org.domain,
          email_address: member.emailAddress,
          password: member.password,
        }),
        403,
        userDisabled,
      );
      const summary = await responseJSON<UserSummaryResponse>(
        await api.userSummary(owner),
      );
      expect(summary.seats_in_use).toBe(1);
      expect(summary.disabled_manual_users).toBe(1);

      expect(
        orgSQL(
          `SELECT count(*) FROM vetchium.audit_events
           WHERE action = 'org.users.disabled'
             AND payload -> 'email_addresses' @> '["${member.emailAddress}"]'::jsonb
             AND payload ->> 'reason' = 'manual'`,
        ),
      ).toBe("1");

      // Repeating is harmless.
      expect(
        (
          await api.disableUser(owner, { email_address: member.emailAddress })
        ).status(),
      ).toBe(204);
    });
  });

  test("disables a batch all or nothing", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const first = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      const second = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      const stranger = inviteeAddress(org.domain);
      const missing = await api.bulkDisableUsers(owner, {
        email_addresses: [first.emailAddress, stranger],
      });
      expect((await missing.json()).email_address).toBe(stranger);
      expect(
        emails(await listed(api, owner, { filter_state: "active" })).length,
      ).toBe(3);

      const done = await api.bulkDisableUsers(owner, {
        email_addresses: [first.emailAddress, second.emailAddress],
      });
      expect(done.status(), await done.text()).toBe(204);
      expect(
        emails(await listed(api, owner, { filter_state: "active" })),
      ).toEqual([org.emailAddress]);
      await expectProblem(
        await api.myInfo(second.token),
        401,
        authenticationRequired,
      );
    });
  });

  test("refuses self, delegation violations, and lockout", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await expectProblem(
        await api.disableUser(owner, { email_address: org.emailAddress }),
        409,
        selfChange,
      );
      const manager = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "mgr"),
        ["org:manage_users"],
      );
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "mem"),
        [],
      );
      await expectProblem(
        await api.bulkDisableUsers(manager.token, {
          email_addresses: [org.emailAddress, manager.emailAddress],
        }),
        409,
        selfChange,
      );
      const refused = await api.bulkDisableUsers(manager.token, {
        email_addresses: [member.emailAddress, org.emailAddress],
      });
      await expectProblem(refused, 403, superadminRequired);
      expect((await refused.json()).email_address).toBe(org.emailAddress);
      expect((await api.myInfo(member.token)).status()).toBe(200);
      const single = await api.disableUser(manager.token, {
        email_address: org.emailAddress,
      });
      await expectProblem(single, 403, superadminRequired);
      expect((await single.json()).email_address).toBe(org.emailAddress);
      await expectProblem(
        await api.disableUser(manager.token, {
          email_address: inviteeAddress(org.domain),
        }),
        404,
        userNotFound,
      );
      expect(
        (
          await api.disableUser(manager.token, {
            email_address: member.emailAddress,
          })
        ).status(),
      ).toBe(204);

      // An Org left without a superadmin cannot lose another administrator
      // the way a tenant cannot lose its last manager; the state is only
      // reachable by writing the database.
      const second = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "two"),
        [],
      );
      orgSQL(
        `DELETE FROM vetchium.org_user_permissions
         WHERE org_user_id IN (SELECT org_user_id FROM vetchium.org_users
                               WHERE email_address = '${org.emailAddress}')`,
      );
      await expectProblem(
        await api.disableUser(manager.token, {
          email_address: second.emailAddress,
        }),
        409,
        lastSuperadmin,
      );
      await expectProblem(
        await api.bulkDisableUsers(manager.token, {
          email_addresses: [second.emailAddress],
        }),
        409,
        lastSuperadmin,
      );
      expect((await api.myInfo(second.token)).status()).toBe(200);
    });
  });

  test("validates, authenticates, and authorizes", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await expectProblem(
        await api.disableUser(owner, { email_address: "nope" }),
        400,
        validationFailed,
        ["email_address"],
      );
      for (const addresses of [[], ["nope"], ["a@x.io", "A@x.io"]]) {
        await expectProblem(
          await api.bulkDisableUsers(owner, { email_addresses: addresses }),
          400,
          validationFailed,
          ["email_addresses"],
        );
      }
      const tooMany = Array.from(
        { length: 101 },
        (_, i) => `u${i}@${org.domain}`,
      );
      await expectProblem(
        await api.bulkDisableUsers(owner, { email_addresses: tooMany }),
        400,
        validationFailed,
        ["email_addresses"],
      );
      for (const path of ["/disable-user", "/bulk-disable-users"]) {
        const raw = await request.post(`${api.origin}/api/orgs${path}`, {
          data: "{",
          headers: {
            Authorization: `Bearer ${owner}`,
            "Content-Type": "application/json",
          },
        });
        await expectProblem(raw, 400, invalidJSON);
      }
      await expectProblem(
        await api.post("/disable-user", { email_address: "a@x.io" }),
        401,
        authenticationRequired,
      );
      await expectProblem(
        await api.post("/bulk-disable-users", { email_addresses: ["a@x.io"] }),
        401,
        authenticationRequired,
      );
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      await expectProblem(
        await api.disableUser(member.token, {
          email_address: org.emailAddress,
        }),
        403,
        permissionRequired,
      );
      await expectProblem(
        await api.bulkDisableUsers(member.token, {
          email_addresses: [org.emailAddress],
        }),
        403,
        permissionRequired,
      );
      suspend(org);
      await expectProblem(
        await api.disableUser(owner, { email_address: member.emailAddress }),
        403,
        orgSuspended,
      );
      await expectProblem(
        await api.bulkDisableUsers(owner, {
          email_addresses: [member.emailAddress],
        }),
        403,
        orgSuspended,
      );
    });
  });
});

test.describe("enable-user and bulk-enable-users", () => {
  test("re-enables disabled users individually and in bulk", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const manual = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      const unpaid = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      await api.disableUser(owner, { email_address: manual.emailAddress });
      orgSQL(
        `UPDATE vetchium.org_users
         SET org_user_state = 'disabled', disabled_reason = 'manual',
             disabled_at = now()
         WHERE email_address = '${unpaid.emailAddress}'`,
      );
      await expectProblem(
        await api.post("/login", {
          domain: org.domain,
          email_address: unpaid.emailAddress,
          password: unpaid.password,
        }),
        403,
        userDisabled,
      );

      const single = await api.enableUser(owner, {
        email_address: manual.emailAddress.toUpperCase(),
      });
      expect(single.status(), await single.text()).toBe(204);
      expect(single.headers()["cache-control"]).toBe("no-store");
      await loginOrg(api, manual);

      const bulk = await api.bulkEnableUsers(owner, {
        email_addresses: [unpaid.emailAddress],
      });
      expect(bulk.status(), await bulk.text()).toBe(204);
      await loginOrg(api, unpaid);
      const row = (
        await listed(api, owner, { filter_search: unpaid.emailAddress })
      ).users[0];
      expect(row?.state).toBe("active");
      expect(row?.disabled_reason).toBeUndefined();
    });
  });

  test("refuses a batch that does not fit the seat cap", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const members: OrgMember[] = [];
      for (let index = 0; index < 4; index++) {
        members.push(
          await addOrgMember(
            api,
            owner,
            org.domain,
            inviteeAddress(org.domain),
            [],
          ),
        );
      }
      const [first, second] = members;
      if (!first || !second) throw new Error("members were not created");
      await api.bulkDisableUsers(owner, {
        email_addresses: [first.emailAddress, second.emailAddress],
      });
      // Two seats free; invite one, leaving room for only one of the two.
      await api.inviteUsers(owner, {
        email_addresses: [inviteeAddress(org.domain)],
      });
      const refused = await api.bulkEnableUsers(owner, {
        email_addresses: [first.emailAddress, second.emailAddress],
      });
      await expectProblem(refused, 409, limitReached);
      expect((await refused.json()).limit).toBe(5);
      expect(
        emails(await listed(api, owner, { filter_state: "disabled-manual" }))
          .length,
      ).toBe(2);
      expect(
        (
          await api.enableUser(owner, { email_address: first.emailAddress })
        ).status(),
      ).toBe(204);
      await expectProblem(
        await api.enableUser(owner, { email_address: second.emailAddress }),
        409,
        limitReached,
      );
    });
  });

  test("a manager cannot re-enable a superadmin", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const manager = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "mgr"),
        ["org:manage_users"],
      );
      const second = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "adm"),
        ["org:superadmin"],
      );
      await api.disableUser(owner, { email_address: second.emailAddress });
      const refused = await api.enableUser(manager.token, {
        email_address: second.emailAddress,
      });
      await expectProblem(refused, 403, superadminRequired);
      expect((await refused.json()).email_address).toBe(second.emailAddress);
      await expectProblem(
        await api.bulkEnableUsers(manager.token, {
          email_addresses: [second.emailAddress],
        }),
        403,
        superadminRequired,
      );
      expect(
        (
          await api.enableUser(owner, { email_address: second.emailAddress })
        ).status(),
      ).toBe(204);
    });
  });

  test("validates, authenticates, and authorizes", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await expectProblem(
        await api.enableUser(owner, {
          email_address: inviteeAddress(org.domain),
        }),
        404,
        userNotFound,
      );
      await expectProblem(
        await api.bulkEnableUsers(owner, {
          email_addresses: [inviteeAddress(org.domain)],
        }),
        404,
        userNotFound,
      );
      await expectProblem(
        await api.enableUser(owner, { email_address: "nope" }),
        400,
        validationFailed,
        ["email_address"],
      );
      await expectProblem(
        await api.bulkEnableUsers(owner, { email_addresses: [] }),
        400,
        validationFailed,
        ["email_addresses"],
      );
      for (const path of ["/enable-user", "/bulk-enable-users"]) {
        const raw = await request.post(`${api.origin}/api/orgs${path}`, {
          data: "{",
          headers: {
            Authorization: `Bearer ${owner}`,
            "Content-Type": "application/json",
          },
        });
        await expectProblem(raw, 400, invalidJSON);
      }
      await expectProblem(
        await api.post("/enable-user", { email_address: "a@x.io" }),
        401,
        authenticationRequired,
      );
      await expectProblem(
        await api.post("/bulk-enable-users", { email_addresses: ["a@x.io"] }),
        401,
        authenticationRequired,
      );
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      await expectProblem(
        await api.enableUser(member.token, { email_address: org.emailAddress }),
        403,
        permissionRequired,
      );
      await expectProblem(
        await api.bulkEnableUsers(member.token, {
          email_addresses: [org.emailAddress],
        }),
        403,
        permissionRequired,
      );
      suspend(org);
      await expectProblem(
        await api.enableUser(owner, { email_address: member.emailAddress }),
        403,
        orgSuspended,
      );
      await expectProblem(
        await api.bulkEnableUsers(owner, {
          email_addresses: [member.emailAddress],
        }),
        403,
        orgSuspended,
      );
    });
  });
});

test.describe("set-user-permissions and bulk-set-user-permissions", () => {
  test("applies on the target's next request and needs step-up", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      await expectProblem(
        await api.listInvitations(member.token),
        403,
        permissionRequired,
      );

      ageSessions(org.emailAddress);
      await expectProblem(
        await api.setUserPermissions(owner, {
          email_address: member.emailAddress,
          permissions: ["org:manage_users"],
        }),
        401,
        recentRequired,
      );
      const refreshed = await api.post(
        "/reauthenticate",
        { password: org.password },
        { token: owner },
      );
      expect(refreshed.status()).toBe(200);

      const response = await api.setUserPermissions(owner, {
        email_address: member.emailAddress.toUpperCase(),
        permissions: ["org:manage_users"],
      });
      expect(response.status(), await response.text()).toBe(204);
      expect(response.headers()["cache-control"]).toBe("no-store");
      // The member's existing session sees the grant without signing in again.
      expect((await api.listInvitations(member.token)).status()).toBe(200);
      expect((await orgInfo(api, member.token)).permissions).toEqual([
        "org:manage_users",
      ]);

      expect(
        (
          await api.setUserPermissions(owner, {
            email_address: member.emailAddress,
            permissions: [],
          })
        ).status(),
      ).toBe(204);
      await expectProblem(
        await api.listInvitations(member.token),
        403,
        permissionRequired,
      );
    });
  });

  test("sends grants, not effective permissions", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      expect(
        (
          await api.setUserPermissions(owner, {
            email_address: member.emailAddress,
            permissions: [
              "org:manage_billing",
              "org:manage_users",
              "org:superadmin",
            ],
          })
        ).status(),
      ).toBe(204);
      const row = (
        await listed(api, owner, { filter_search: member.emailAddress })
      ).users[0];
      expect(row?.granted_permissions).toEqual(["org:superadmin"]);
      expect(row?.effective_permissions).toEqual([
        "org:manage_billing",
        "org:manage_users",
        "org:superadmin",
      ]);
    });
  });

  test("keeps a held grant while adding another, singly and in a batch", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const both = ["org:manage_billing", "org:manage_users"];
      const holder = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        ["org:manage_users"],
      );
      const single = await api.setUserPermissions(owner, {
        email_address: holder.emailAddress,
        permissions: both,
      });
      expect(single.status(), await single.text()).toBe(204);
      const granted = async (emailAddress: string) =>
        (await listed(api, owner, { filter_search: emailAddress })).users[0]
          ?.granted_permissions;
      expect(await granted(holder.emailAddress)).toEqual(both);

      // A batch whose targets already hold some of the grants.
      const overlapping = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        ["org:manage_billing"],
      );
      const fresh = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      const batch = await api.bulkSetUserPermissions(owner, {
        email_addresses: [
          holder.emailAddress,
          overlapping.emailAddress,
          fresh.emailAddress,
        ],
        permissions: both,
      });
      expect(batch.status(), await batch.text()).toBe(204);
      for (const member of [holder, overlapping, fresh]) {
        expect(await granted(member.emailAddress)).toEqual(both);
      }

      // Dropping one grant keeps the other.
      const narrowed = await api.setUserPermissions(owner, {
        email_address: holder.emailAddress,
        permissions: ["org:manage_billing"],
      });
      expect(narrowed.status(), await narrowed.text()).toBe(204);
      expect(await granted(holder.emailAddress)).toEqual([
        "org:manage_billing",
      ]);
    });
  });

  test("applies one set to a batch, audited once", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const first = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      const second = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        ["org:manage_billing"],
      );
      const response = await api.bulkSetUserPermissions(owner, {
        email_addresses: [first.emailAddress, second.emailAddress],
        permissions: ["org:manage_users"],
      });
      expect(response.status(), await response.text()).toBe(204);
      const users = await listed(api, owner, {
        filter_permission: "org:manage_users",
      });
      expect(emails(users)).toEqual(
        [first.emailAddress, second.emailAddress].sort(),
      );
      for (const user of users.users) {
        expect(user.granted_permissions).toEqual(["org:manage_users"]);
      }
      expect(
        orgSQL(
          `SELECT count(*) FROM vetchium.audit_events
           WHERE action = 'org.users.permissions_set'
             AND payload -> 'email_addresses' @> '["${first.emailAddress}"]'::jsonb
             AND payload -> 'email_addresses' @> '["${second.emailAddress}"]'::jsonb`,
        ),
      ).toBe("1");
    });
  });

  test("delegates only the non-reserved permissions", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const manager = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "mgr"),
        ["org:manage_users"],
      );
      const finance = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "fin"),
        ["org:manage_billing"],
      );
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "mem"),
        [],
      );
      // Granting a reserved permission, and revoking one, both need a
      // superadmin; the refusal names the target.
      const grant = await api.setUserPermissions(manager.token, {
        email_address: member.emailAddress,
        permissions: ["org:superadmin"],
      });
      await expectProblem(grant, 403, superadminRequired);
      expect((await grant.json()).email_address).toBe(member.emailAddress);
      await expectProblem(
        await api.setUserPermissions(manager.token, {
          email_address: member.emailAddress,
          permissions: ["org:manage_billing"],
        }),
        403,
        superadminRequired,
      );
      const revoke = await api.setUserPermissions(manager.token, {
        email_address: finance.emailAddress,
        permissions: [],
      });
      await expectProblem(revoke, 403, superadminRequired);
      expect((await revoke.json()).email_address).toBe(finance.emailAddress);
      await expectProblem(
        await api.bulkSetUserPermissions(manager.token, {
          email_addresses: [member.emailAddress, finance.emailAddress],
          permissions: [],
        }),
        403,
        superadminRequired,
      );
      expect(
        emails(
          await listed(api, owner, { filter_permission: "org:manage_billing" }),
        ),
      ).toEqual([finance.emailAddress]);

      expect(
        (
          await api.setUserPermissions(manager.token, {
            email_address: member.emailAddress,
            permissions: ["org:manage_users"],
          })
        ).status(),
      ).toBe(204);
      expect(
        (
          await api.setUserPermissions(owner, {
            email_address: finance.emailAddress,
            permissions: [],
          })
        ).status(),
      ).toBe(204);
    });
  });

  test("refuses self, unknown users, and lockout", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await expectProblem(
        await api.setUserPermissions(owner, {
          email_address: org.emailAddress,
          permissions: [],
        }),
        409,
        selfChange,
      );
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      await expectProblem(
        await api.bulkSetUserPermissions(owner, {
          email_addresses: [member.emailAddress, org.emailAddress],
          permissions: [],
        }),
        409,
        selfChange,
      );
      const stranger = inviteeAddress(org.domain);
      const missing = await api.setUserPermissions(owner, {
        email_address: stranger,
        permissions: [],
      });
      await expectProblem(missing, 404, userNotFound);
      expect((await missing.json()).email_address).toBe(stranger);
      await expectProblem(
        await api.bulkSetUserPermissions(owner, {
          email_addresses: [member.emailAddress, stranger],
          permissions: [],
        }),
        404,
        userNotFound,
      );

      const manager = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "mgr"),
        ["org:manage_users"],
      );
      orgSQL(
        `DELETE FROM vetchium.org_user_permissions
         WHERE org_user_id IN (SELECT org_user_id FROM vetchium.org_users
                               WHERE email_address = '${org.emailAddress}')`,
      );
      await expectProblem(
        await api.setUserPermissions(manager.token, {
          email_address: member.emailAddress,
          permissions: ["org:manage_users"],
        }),
        409,
        lastSuperadmin,
      );
      await expectProblem(
        await api.bulkSetUserPermissions(manager.token, {
          email_addresses: [member.emailAddress],
          permissions: [],
        }),
        409,
        lastSuperadmin,
      );
    });
  });

  test("validates, authenticates, and authorizes", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await expectProblem(
        await api.setUserPermissions(owner, {
          email_address: "nope",
          permissions: ["org:future"],
        }),
        400,
        validationFailed,
        ["email_address", "permissions"],
      );
      await expectProblem(
        await api.setUserPermissions(owner, {
          email_address: org.emailAddress,
          permissions: ["org:manage_users", "org:manage_users"],
        }),
        400,
        validationFailed,
        ["permissions"],
      );
      await expectProblem(
        await api.bulkSetUserPermissions(owner, {
          email_addresses: [],
          permissions: ["org:future"],
        }),
        400,
        validationFailed,
        ["email_addresses", "permissions"],
      );
      const tooMany = Array.from(
        { length: 101 },
        (_, i) => `u${i}@${org.domain}`,
      );
      await expectProblem(
        await api.bulkSetUserPermissions(owner, {
          email_addresses: tooMany,
          permissions: [],
        }),
        400,
        validationFailed,
        ["email_addresses"],
      );
      for (const path of [
        "/set-user-permissions",
        "/bulk-set-user-permissions",
      ]) {
        const raw = await request.post(`${api.origin}/api/orgs${path}`, {
          data: "{",
          headers: {
            Authorization: `Bearer ${owner}`,
            "Content-Type": "application/json",
          },
        });
        await expectProblem(raw, 400, invalidJSON);
      }
      await expectProblem(
        await api.post("/set-user-permissions", {
          email_address: "a@x.io",
          permissions: [],
        }),
        401,
        authenticationRequired,
      );
      await expectProblem(
        await api.post("/bulk-set-user-permissions", {
          email_addresses: ["a@x.io"],
          permissions: [],
        }),
        401,
        authenticationRequired,
      );
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      await expectProblem(
        await api.setUserPermissions(member.token, {
          email_address: org.emailAddress,
          permissions: [],
        }),
        403,
        permissionRequired,
      );
      await expectProblem(
        await api.bulkSetUserPermissions(member.token, {
          email_addresses: [org.emailAddress],
          permissions: [],
        }),
        403,
        permissionRequired,
      );
      ageSessions(org.emailAddress);
      await expectProblem(
        await api.bulkSetUserPermissions(owner, {
          email_addresses: [member.emailAddress],
          permissions: [],
        }),
        401,
        recentRequired,
      );
      const fresh = await loginOrg(api, org);
      suspend(org);
      await expectProblem(
        await api.setUserPermissions(fresh, {
          email_address: member.emailAddress,
          permissions: [],
        }),
        403,
        orgSuspended,
      );
      await expectProblem(
        await api.bulkSetUserPermissions(fresh, {
          email_addresses: [member.emailAddress],
          permissions: [],
        }),
        403,
        orgSuspended,
      );
    });
  });
});
