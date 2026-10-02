import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import type {
  AcceptInvitationResponse,
  InvitationDetailsResponse,
  InviteUsersResponse,
  ListInvitationsResponse,
  ResendInvitationResponse,
} from "typespec/orgs/users/invitations";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  invitationToken,
  inviteeAddress,
  loginOrg,
  OrgsAPI,
  orgAuditEventsByKey,
  orgEmailCount,
  orgInfo,
  orgPassword,
  orgSQL,
  orgsIdempotencyKey,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";

const authenticationRequired =
  "vetchium-problem-details/org-authentication-required";
const permissionRequired = "vetchium-problem-details/org-permission-required";
const orgSuspended = "vetchium-problem-details/org-suspended";
const limitReached = "vetchium-problem-details/org-user-limit-reached";
const invitationInvalid = "vetchium-problem-details/org-invitation-invalid";
const invitationNotFound = "vetchium-problem-details/org-invitation-not-found";
const userExists = "vetchium-problem-details/org-user-already-exists";
const validationFailed = "vetchium-problem-details/validation-failed";
const invalidJSON = "vetchium-problem-details/invalid-json";
const keyConflict = "vetchium-problem-details/idempotency-key-conflict";
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

function expireInvitation(emailAddress: string): void {
  orgSQL(
    `UPDATE vetchium.org_user_invitations
     SET created_at = now() - interval '2 days',
         expires_at = now() - interval '1 day'
     WHERE email_address = '${emailAddress}'`,
  );
}

/** Adds active users straight to the table, to fill an Org to its cap. */
function fillSeats(org: SignedUpOrg, count: number): void {
  orgSQL(
    `INSERT INTO vetchium.org_users (
       org_user_id, org_did, email_address, org_user_state, preferred_language
     )
     SELECT gen_random_uuid(), d.org_did,
            'filler-' || n || '@${org.domain}', 'active', 'en-US'
     FROM vetchium.org_domains AS d, generate_series(1, ${count}) AS n
     WHERE d.domain = '${org.domain}'`,
  );
}

test.describe("invite-users", () => {
  test("reports one outcome per address and delivers the email", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const fresh = inviteeAddress(org.domain);
      const pending = inviteeAddress(org.domain);
      const wrongDomain = `someone@other-${org.domain}`;
      const first = await api.inviteUsers(owner, {
        email_addresses: [pending],
      });
      expect(first.status()).toBe(200);

      const key = orgsIdempotencyKey();
      const response = await api.inviteUsers(
        owner,
        {
          email_addresses: [
            ` ${fresh.toUpperCase()} `,
            org.emailAddress,
            pending,
            wrongDomain,
            "not-an-address",
          ],
          permissions: ["org:manage_users"],
        },
        key,
      );
      expect(response.status(), await response.text()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      const body = await responseJSON<InviteUsersResponse>(response);
      expect(
        body.results.map((entry) => [entry.email_address, entry.outcome]),
      ).toEqual([
        [fresh, "invited"],
        [org.emailAddress, "already-member"],
        [pending, "already-invited"],
        [wrongDomain, "domain-mismatch"],
        ["not-an-address", "invalid"],
      ]);
      expect(body.results[0]?.expires_at).toBeDefined();
      expect(body.results[1]?.expires_at).toBeUndefined();

      expect(await invitationToken(request, fresh)).toMatch(/^[0-9a-f]{64}$/);
      const audit = orgAuditEventsByKey(key);
      expect(audit.map((event) => event.action)).toEqual([
        "org.invitations.created",
      ]);
      expect(JSON.stringify(audit[0]?.payload)).not.toContain("token");

      const listed = await responseJSON<ListInvitationsResponse>(
        await api.listInvitations(owner),
      );
      expect(listed.invitations.map((entry) => entry.email_address)).toEqual(
        [fresh, pending].sort(),
      );
      const invitation = listed.invitations.find(
        (entry) => entry.email_address === fresh,
      );
      expect(invitation?.permissions).toEqual(["org:manage_users"]);
      expect(invitation?.invited_by).toBe(org.emailAddress);
    });
  });

  test("replays an identical request without a second email", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const address = inviteeAddress(org.domain);
      const key = orgsIdempotencyKey();
      const first = await api.inviteUsers(
        owner,
        { email_addresses: [address] },
        key,
      );
      const second = await api.inviteUsers(
        owner,
        { email_addresses: [address] },
        key,
      );
      expect(first.status()).toBe(200);
      expect(second.status()).toBe(200);
      expect(await second.json()).toEqual(await first.json());
      await invitationToken(request, address);
      expect(await orgEmailCount(address)).toBe(1);

      await expectProblem(
        await api.inviteUsers(
          owner,
          { email_addresses: [address, "x@y.z"] },
          key,
        ),
        409,
        keyConflict,
      );
    });
  });

  test("rejects malformed requests", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const valid = inviteeAddress(org.domain);
      const tooMany = Array.from(
        { length: 101 },
        (_, index) => `user${index}@${org.domain}`,
      );
      for (const [body, fields] of [
        [{ email_addresses: [] }, ["email_addresses"]],
        [{ email_addresses: tooMany }, ["email_addresses"]],
        [
          { email_addresses: [valid, valid.toUpperCase()] },
          ["email_addresses"],
        ],
        [
          { email_addresses: [valid], permissions: ["org:future"] },
          ["permissions"],
        ],
        [
          {
            email_addresses: [valid],
            permissions: ["org:manage_users", "org:manage_users"],
          },
          ["permissions"],
        ],
      ] as const) {
        await expectProblem(
          await api.inviteUsers(owner, body as never),
          400,
          validationFailed,
          [...fields],
        );
      }
      await expectProblem(
        await api.post(
          "/invite-users",
          { email_addresses: [valid] },
          { token: owner },
        ),
        400,
        validationFailed,
        ["Idempotency-Key"],
      );
      const raw = await request.post(`${api.origin}/api/orgs/invite-users`, {
        data: "{",
        headers: {
          Authorization: `Bearer ${owner}`,
          "Content-Type": "application/json",
          "Idempotency-Key": orgsIdempotencyKey(),
        },
      });
      await expectProblem(raw, 400, invalidJSON);
    });
  });

  test("requires authentication and the manage-users permission", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await expectProblem(
        await api.post(
          "/invite-users",
          { email_addresses: [inviteeAddress(org.domain)] },
          { idempotencyKey: orgsIdempotencyKey() },
        ),
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
        await api.inviteUsers(member.token, {
          email_addresses: [inviteeAddress(org.domain)],
        }),
        403,
        permissionRequired,
      );
    });
  });

  test("a manager cannot grant reserved permissions", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const manager = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "manager"),
        ["org:manage_users"],
      );
      for (const permission of ["org:superadmin", "org:manage_billing"]) {
        await expectProblem(
          await api.inviteUsers(manager.token, {
            email_addresses: [inviteeAddress(org.domain)],
            permissions: [permission],
          }),
          403,
          permissionRequired,
        );
      }
      const delegated = await api.inviteUsers(manager.token, {
        email_addresses: [inviteeAddress(org.domain)],
        permissions: ["org:manage_users"],
      });
      expect(delegated.status()).toBe(200);
      const superadminGrant = await api.inviteUsers(owner, {
        email_addresses: [inviteeAddress(org.domain)],
        permissions: ["org:superadmin"],
      });
      expect(superadminGrant.status()).toBe(200);
    });
  });

  test("counts pending invitations against the Free cap of five", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const four = Array.from({ length: 4 }, () => inviteeAddress(org.domain));
      const filled = await api.inviteUsers(owner, { email_addresses: four });
      expect(filled.status(), await filled.text()).toBe(200);

      const refused = await api.inviteUsers(owner, {
        email_addresses: [inviteeAddress(org.domain)],
      });
      await expectProblem(refused, 409, limitReached);
      expect((await refused.json()).limit).toBe(5);

      await expectProblem(
        await api.inviteUsers(owner, {
          email_addresses: [inviteeAddress(org.domain)],
        }),
        409,
        limitReached,
      );
      // Re-inviting a pending address takes no new seat.
      const repeat = await api.inviteUsers(owner, {
        email_addresses: [four[0] ?? ""],
      });
      expect(repeat.status()).toBe(200);
      expect(
        (await responseJSON<InviteUsersResponse>(repeat)).results[0]?.outcome,
      ).toBe("already-invited");
    });
  });

  test("refuses the whole batch when it exceeds the cap", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const five = Array.from({ length: 5 }, () => inviteeAddress(org.domain));
      await expectProblem(
        await api.inviteUsers(owner, { email_addresses: five }),
        409,
        limitReached,
      );
      const listed = await responseJSON<ListInvitationsResponse>(
        await api.listInvitations(owner),
      );
      expect(listed.invitations).toEqual([]);
      const fits = await api.inviteUsers(owner, {
        email_addresses: five.slice(0, 4),
      });
      expect(fits.status()).toBe(200);
    });
  });

  test("an expired invitation frees its seat", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const four = Array.from({ length: 4 }, () => inviteeAddress(org.domain));
      await api.inviteUsers(owner, { email_addresses: four });
      expireInvitation(four[0] ?? "");
      const response = await api.inviteUsers(owner, {
        email_addresses: [inviteeAddress(org.domain)],
      });
      expect(response.status(), await response.text()).toBe(200);
      // The expired address can be invited again; that takes a seat.
      const reinvite = await api.inviteUsers(owner, {
        email_addresses: [four[0] ?? ""],
      });
      await expectProblem(reinvite, 409, limitReached);
    });
  });

  test("refuses a suspended Org", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      orgSQL(
        `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
         WHERE org_did = (SELECT org_did FROM vetchium.org_domains
                          WHERE domain = '${org.domain}')`,
      );
      await expectProblem(
        await api.inviteUsers(owner, {
          email_addresses: [inviteeAddress(org.domain)],
        }),
        403,
        orgSuspended,
      );
    });
  });
});

test.describe("list-invitations", () => {
  test("searches, filters, and pages in address order", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const stem = randomBytes(4).toString("hex");
      const addresses = ["c", "a", "b"].map(
        (letter) => `${letter}-${stem}@${org.domain}`,
      );
      await api.inviteUsers(owner, { email_addresses: addresses });

      const firstResponse = await api.listInvitations(owner, { limit: 2 });
      expect(firstResponse.headers()["cache-control"]).toBe("no-store");
      const first = await responseJSON<ListInvitationsResponse>(firstResponse);
      expect(first.invitations.map((entry) => entry.email_address)).toEqual([
        addresses[1],
        addresses[2],
      ]);
      expect(first.next_pagination_key).toBeDefined();
      const second = await responseJSON<ListInvitationsResponse>(
        await api.listInvitations(owner, {
          limit: 2,
          pagination_key: first.next_pagination_key ?? "",
        }),
      );
      expect(second.invitations.map((entry) => entry.email_address)).toEqual([
        addresses[0],
      ]);
      expect(second.next_pagination_key).toBeUndefined();

      const searched = await responseJSON<ListInvitationsResponse>(
        await api.listInvitations(owner, {
          filter_search: `B-${stem}`.toUpperCase(),
        }),
      );
      expect(searched.invitations.map((entry) => entry.email_address)).toEqual([
        addresses[2],
      ]);

      // A key issued for one search is not valid for another.
      await expectProblem(
        await api.listInvitations(owner, {
          limit: 2,
          filter_search: `a-${stem}`,
          pagination_key: first.next_pagination_key ?? "",
        }),
        400,
        invalidPaginationKey,
      );
      await expectProblem(
        await api.listInvitations(owner, {
          pagination_key: randomBytes(32).toString("base64url"),
        }),
        400,
        invalidPaginationKey,
      );
    });
  });

  test("rejects bad bounds and unauthorized callers", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await expectProblem(
        await api.listInvitations(owner, { limit: 101 }),
        400,
        validationFailed,
        ["limit"],
      );
      await expectProblem(
        await api.listInvitations(owner, { filter_search: "a" }),
        400,
        validationFailed,
        ["filter_search"],
      );
      await expectProblem(
        await api.post("/list-invitations", {}),
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
        await api.listInvitations(member.token),
        403,
        permissionRequired,
      );
      orgSQL(
        `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
         WHERE org_did = (SELECT org_did FROM vetchium.org_domains
                          WHERE domain = '${org.domain}')`,
      );
      await expectProblem(await api.listInvitations(owner), 403, orgSuspended);
    });
  });
});

test.describe("resend-invitation", () => {
  test("rotates the token, restarts the lifetime, and sends a new email", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const address = inviteeAddress(org.domain);
      await api.inviteUsers(owner, { email_addresses: [address] });
      const before = await invitationToken(request, address);

      const key = orgsIdempotencyKey();
      const response = await api.resendInvitation(
        owner,
        { email_address: address.toUpperCase() },
        key,
      );
      expect(response.status(), await response.text()).toBe(200);
      expect(
        Date.parse(
          (await responseJSON<ResendInvitationResponse>(response)).expires_at,
        ),
      ).toBeGreaterThan(Date.now());
      await expect
        .poll(async () => orgEmailCount(address), { timeout: 15_000 })
        .toBe(2);
      const after = await invitationToken(request, address);
      expect(after).not.toBe(before);

      await expectProblem(
        await api.getInvitationDetails({ invitation_token: before }),
        401,
        invitationInvalid,
      );
      const details = await api.getInvitationDetails({
        invitation_token: after,
      });
      expect(details.status()).toBe(200);
      expect(orgAuditEventsByKey(key).map((event) => event.action)).toEqual([
        "org.invitation.resent",
      ]);
    });
  });

  test("revives an expired invitation only when a seat is free", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const four = Array.from({ length: 4 }, () => inviteeAddress(org.domain));
      await api.inviteUsers(owner, { email_addresses: four });
      const target = four[0] ?? "";
      expireInvitation(target);
      // The expired invitation freed a seat; take it, so none is left.
      await api.inviteUsers(owner, {
        email_addresses: [inviteeAddress(org.domain)],
      });
      const refused = await api.resendInvitation(owner, {
        email_address: target,
      });
      await expectProblem(refused, 409, limitReached);
      expect((await refused.json()).limit).toBe(5);

      await api.cancelInvitations(owner, { email_addresses: [four[1] ?? ""] });
      const accepted = await api.resendInvitation(owner, {
        email_address: target,
      });
      expect(accepted.status(), await accepted.text()).toBe(200);
    });
  });

  test("rejects unknown invitations, bad input, and unauthorized callers", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const address = inviteeAddress(org.domain);
      await expectProblem(
        await api.resendInvitation(owner, { email_address: address }),
        404,
        invitationNotFound,
      );
      await expectProblem(
        await api.resendInvitation(owner, { email_address: "nope" }),
        400,
        validationFailed,
        ["email_address"],
      );
      await expectProblem(
        await api.post(
          "/resend-invitation",
          { email_address: address },
          {
            idempotencyKey: orgsIdempotencyKey(),
          },
        ),
        401,
        authenticationRequired,
      );
      const key = orgsIdempotencyKey();
      await api.inviteUsers(owner, { email_addresses: [address] });
      expect(
        (
          await api.resendInvitation(owner, { email_address: address }, key)
        ).status(),
      ).toBe(200);
      await expectProblem(
        await api.resendInvitation(
          owner,
          { email_address: org.emailAddress },
          key,
        ),
        409,
        keyConflict,
      );
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      await expectProblem(
        await api.resendInvitation(member.token, { email_address: address }),
        403,
        permissionRequired,
      );
      orgSQL(
        `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
         WHERE org_did = (SELECT org_did FROM vetchium.org_domains
                          WHERE domain = '${org.domain}')`,
      );
      await expectProblem(
        await api.resendInvitation(owner, { email_address: address }),
        403,
        orgSuspended,
      );
    });
  });
});

test.describe("cancel-invitations", () => {
  test("cancels pending invitations and invalidates their tokens", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const addresses = [
        inviteeAddress(org.domain),
        inviteeAddress(org.domain),
      ];
      await api.inviteUsers(owner, { email_addresses: addresses });
      const token = await invitationToken(request, addresses[0] ?? "");
      const response = await api.cancelInvitations(owner, {
        email_addresses: addresses.map((address) => address.toUpperCase()),
      });
      expect(response.status()).toBe(204);
      expect(response.headers()["cache-control"]).toBe("no-store");
      await expectProblem(
        await api.getInvitationDetails({ invitation_token: token }),
        401,
        invitationInvalid,
      );
      expect(
        (
          await responseJSON<ListInvitationsResponse>(
            await api.listInvitations(owner),
          )
        ).invitations,
      ).toEqual([]);
      // The seats are free again.
      const again = await api.inviteUsers(owner, {
        email_addresses: addresses,
      });
      expect(again.status()).toBe(200);
    });
  });

  test("is all or nothing", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const pending = inviteeAddress(org.domain);
      await api.inviteUsers(owner, { email_addresses: [pending] });
      await expectProblem(
        await api.cancelInvitations(owner, {
          email_addresses: [pending, inviteeAddress(org.domain)],
        }),
        404,
        invitationNotFound,
      );
      const listed = await responseJSON<ListInvitationsResponse>(
        await api.listInvitations(owner),
      );
      expect(listed.invitations.map((entry) => entry.email_address)).toEqual([
        pending,
      ]);
    });
  });

  test("rejects bad input and unauthorized callers", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      for (const addresses of [[], ["nope"], ["a@x.io", "A@x.io"]]) {
        await expectProblem(
          await api.cancelInvitations(owner, { email_addresses: addresses }),
          400,
          validationFailed,
          ["email_addresses"],
        );
      }
      await expectProblem(
        await api.post("/cancel-invitations", { email_addresses: ["a@x.io"] }),
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
        await api.cancelInvitations(member.token, {
          email_addresses: [org.emailAddress],
        }),
        403,
        permissionRequired,
      );
      orgSQL(
        `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
         WHERE org_did = (SELECT org_did FROM vetchium.org_domains
                          WHERE domain = '${org.domain}')`,
      );
      await expectProblem(
        await api.cancelInvitations(owner, {
          email_addresses: [org.emailAddress],
        }),
        403,
        orgSuspended,
      );
    });
  });
});

test.describe("get-invitation-details and accept-invitation", () => {
  test("accepts an invitation and signs the new user in", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const address = inviteeAddress(org.domain);
      await api.inviteUsers(owner, {
        email_addresses: [address],
        permissions: ["org:manage_users"],
      });
      const token = await invitationToken(request, address);

      const details = await api.getInvitationDetails({
        invitation_token: token,
      });
      expect(details.status()).toBe(200);
      expect(details.headers()["cache-control"]).toBe("no-store");
      const detailsBody =
        await responseJSON<InvitationDetailsResponse>(details);
      expect(detailsBody.domain).toBe(org.domain);
      expect(detailsBody.email_address).toBe(address);

      const password = orgPassword();
      const key = orgsIdempotencyKey();
      const accepted = await api.acceptInvitation(
        { invitation_token: token, password, preferred_language: "de-DE" },
        key,
      );
      expect(accepted.status(), await accepted.text()).toBe(201);
      expect(await responseJSON<AcceptInvitationResponse>(accepted)).toEqual({
        domain: org.domain,
        email_address: address,
      });
      const replay = await api.acceptInvitation(
        { invitation_token: token, password, preferred_language: "de-DE" },
        key,
      );
      expect(replay.status()).toBe(201);

      const session = await loginOrg(api, {
        domain: org.domain,
        emailAddress: address,
        password,
      });
      const info = await orgInfo(api, session);
      expect(info.permissions).toEqual(["org:manage_users"]);
      expect(info.preferred_language).toBe("de-DE");

      // Consumed: the token is dead for any other key, and the seat stays held
      // by the user.
      await expectProblem(
        await api.acceptInvitation({
          invitation_token: token,
          password,
          preferred_language: "de-DE",
        }),
        401,
        invitationInvalid,
      );
      await expectProblem(
        await api.getInvitationDetails({ invitation_token: token }),
        401,
        invitationInvalid,
      );
      expect(
        (
          await responseJSON<ListInvitationsResponse>(
            await api.listInvitations(owner),
          )
        ).invitations,
      ).toEqual([]);
    });
  });

  test("rejects unknown, expired, and malformed tokens", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const unknown = randomBytes(32).toString("hex");
      await expectProblem(
        await api.getInvitationDetails({ invitation_token: unknown }),
        401,
        invitationInvalid,
      );
      const invalidChallenge = await api.getInvitationDetails({
        invitation_token: unknown,
      });
      expect(invalidChallenge.headers()["www-authenticate"]).toBe(
        'VetchiumInvitation realm="orgs"',
      );
      await expectProblem(
        await api.acceptInvitation({
          invitation_token: unknown,
          password: orgPassword(),
          preferred_language: "en-US",
        }),
        401,
        invitationInvalid,
      );
      await expectProblem(
        await api.getInvitationDetails({ invitation_token: "short" }),
        400,
        validationFailed,
        ["invitation_token"],
      );
      await expectProblem(
        await api.acceptInvitation({
          invitation_token: "short",
          password: "short",
          preferred_language: "fr-FR" as never,
        }),
        400,
        validationFailed,
        ["invitation_token", "password", "preferred_language"],
      );
      await expectProblem(
        await api.postRaw("/get-invitation-details", "{"),
        400,
        invalidJSON,
      );

      const address = inviteeAddress(org.domain);
      await api.inviteUsers(owner, { email_addresses: [address] });
      const token = await invitationToken(request, address);
      expireInvitation(address);
      await expectProblem(
        await api.getInvitationDetails({ invitation_token: token }),
        401,
        invitationInvalid,
      );
      await expectProblem(
        await api.acceptInvitation({
          invitation_token: token,
          password: orgPassword(),
          preferred_language: "en-US",
        }),
        401,
        invitationInvalid,
      );
    });
  });

  test("conflicts when the address already has a user or the Org is full", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const taken = inviteeAddress(org.domain);
      await api.inviteUsers(owner, { email_addresses: [taken] });
      const takenToken = await invitationToken(request, taken);
      orgSQL(
        `INSERT INTO vetchium.org_users (
           org_user_id, org_did, email_address, org_user_state, preferred_language
         )
         SELECT gen_random_uuid(), org_did, '${taken}', 'active', 'en-US'
         FROM vetchium.org_domains WHERE domain = '${org.domain}'`,
      );
      await expectProblem(
        await api.acceptInvitation({
          invitation_token: takenToken,
          password: orgPassword(),
          preferred_language: "en-US",
        }),
        409,
        userExists,
      );

      // The Org is now over its cap (owner, the user above, and the
      // invitation below), as a downgrade would leave it.
      const late = inviteeAddress(org.domain);
      await api.inviteUsers(owner, { email_addresses: [late] });
      const lateToken = await invitationToken(request, late);
      fillSeats(org, 4);
      const refused = await api.acceptInvitation({
        invitation_token: lateToken,
        password: orgPassword(),
        preferred_language: "en-US",
      });
      await expectProblem(refused, 409, limitReached);
      expect((await refused.json()).limit).toBe(5);
    });
  });

  test("replaying a key with another body conflicts", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const address = inviteeAddress(org.domain);
      await api.inviteUsers(owner, { email_addresses: [address] });
      const token = await invitationToken(request, address);
      const key = orgsIdempotencyKey();
      expect(
        (
          await api.acceptInvitation(
            {
              invitation_token: token,
              password: orgPassword(),
              preferred_language: "en-US",
            },
            key,
          )
        ).status(),
      ).toBe(201);
      await expectProblem(
        await api.acceptInvitation(
          {
            invitation_token: token,
            password: orgPassword(),
            preferred_language: "ta",
          },
          key,
        ),
        409,
        keyConflict,
      );
    });
  });
});

test("malformed JSON is rejected on every invitation route", async ({
  request,
}) => {
  await withOrg(request, async ({ api, owner }) => {
    for (const path of [
      "/list-invitations",
      "/resend-invitation",
      "/cancel-invitations",
      "/get-invitation-details",
      "/accept-invitation",
    ]) {
      const response = await request.post(`${api.origin}/api/orgs${path}`, {
        data: "{",
        headers: {
          Authorization: `Bearer ${owner}`,
          "Content-Type": "application/json",
          "Idempotency-Key": orgsIdempotencyKey(),
        },
      });
      await expectProblem(response, 400, invalidJSON);
    }
  });
});
