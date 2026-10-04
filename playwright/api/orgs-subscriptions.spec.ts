import type { Page } from "@playwright/test";
import type { OrgPlan } from "typespec/orgs/subscriptions/plans";
import type { OrgSubscription } from "typespec/orgs/subscriptions/subscriptions";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import type { TestTenant } from "../lib/admin-db.ts";
import { openTenantSession } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  installOrgAuditInsertFailure,
  inviteeAddress,
  loginOrg,
  OrgsAPI,
  orgSQL,
  orgSubscriptionActions,
  orgsIdempotencyKey,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";

const authenticationRequired =
  "vetchium-problem-details/org-authentication-required";
const permissionRequired = "vetchium-problem-details/org-permission-required";
const orgSuspended = "vetchium-problem-details/org-suspended";
const planNotOffered = "vetchium-problem-details/org-plan-not-offered";
const exceedsTarget = "vetchium-problem-details/org-user-limit-exceeds-target";
const validationFailed = "vetchium-problem-details/validation-failed";
const invalidJSON = "vetchium-problem-details/invalid-json";
const keyConflict = "vetchium-problem-details/idempotency-key-conflict";

interface Fixture {
  api: OrgsAPI;
  org: SignedUpOrg;
  owner: string;
}

async function withOrg(
  request: Page["request"],
  body: (fixture: Fixture) => Promise<void>,
  tenant: TestTenant = "sgp",
): Promise<void> {
  const api = new OrgsAPI(request, tenant);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    await body({ api, org, owner });
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain, tenant);
  }
}

async function subscription(
  api: OrgsAPI,
  token: string,
): Promise<OrgSubscription> {
  const response = await api.mySubscription(token);
  expect(response.status(), await response.text()).toBe(200);
  return responseJSON<OrgSubscription>(response);
}

async function choose(
  api: OrgsAPI,
  token: string,
  plan: OrgPlan,
  interval?: "month" | "year",
  key: string = orgsIdempotencyKey(),
): Promise<OrgSubscription> {
  const response = await api.setSubscriptionPlan(
    token,
    interval === undefined
      ? { plan_oid: plan }
      : { plan_oid: plan, billing_interval: interval },
    key,
  );
  expect(response.status(), await response.text()).toBe(200);
  return responseJSON<OrgSubscription>(response);
}

function suspend(org: SignedUpOrg): void {
  orgSQL(
    `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
     WHERE org_did = (SELECT org_did FROM vetchium.org_domains
                      WHERE domain = '${org.domain}')`,
  );
}

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

test.describe("my-subscription", () => {
  test("shows a new Org on the Free plan", async ({ request }) => {
    await withOrg(request, async ({ api, owner }) => {
      const response = await api.mySubscription(owner);
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.json()).toEqual({
        plan_oid: "org-free-tier",
        seats_in_use: 1,
        seat_limit: 5,
      });
    });
  });

  test("needs authentication and the billing permission, not an active Org", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await expectProblem(
        await api.mySubscription(),
        401,
        authenticationRequired,
      );
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        ["org:manage_users"],
      );
      await expectProblem(
        await api.mySubscription(member.token),
        403,
        permissionRequired,
      );
      const finance = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        ["org:manage_billing"],
      );
      expect((await api.mySubscription(finance.token)).status()).toBe(200);
      // A suspended Org may still read its billing (D27).
      suspend(org);
      expect((await api.mySubscription(owner)).status()).toBe(200);
    });
  });
});

test("plan and interval changes apply immediately and identical choices are no-ops", async ({
  request,
}) => {
  await withOrg(request, async ({ api, org, owner }) => {
    for (const [plan, interval, limit] of [
      ["org-gold-tier", "month", 1000],
      ["org-gold-tier", "year", 1000],
      ["org-silver-tier", "month", 50],
      ["org-free-tier", undefined, 5],
    ] as const) {
      const result = await choose(api, owner, plan, interval);
      expect(result).toEqual({
        plan_oid: plan,
        ...(interval === undefined ? {} : { billing_interval: interval }),
        seats_in_use: 1,
        seat_limit: limit,
      });
      expect(await subscription(api, owner)).toEqual(result);
    }
    expect(orgSubscriptionActions(org.domain)).toEqual(
      Array(4).fill("org.subscription.changed"),
    );
    await choose(api, owner, "org-free-tier");
    expect(orgSubscriptionActions(org.domain)).toHaveLength(4);
  });
});

test("retries replay once and conflicting idempotency payloads fail", async ({
  request,
}) => {
  await withOrg(request, async ({ api, org, owner }) => {
    const key = orgsIdempotencyKey();
    const first = await choose(api, owner, "org-gold-tier", "year", key);
    expect(await choose(api, owner, "org-gold-tier", "year", key)).toEqual(
      first,
    );
    expect(orgSubscriptionActions(org.domain)).toEqual([
      "org.subscription.changed",
    ]);
    await expectProblem(
      await api.setSubscriptionPlan(
        owner,
        { plan_oid: "org-silver-tier", billing_interval: "year" },
        key,
      ),
      409,
      keyConflict,
    );
  });
});

test("a lower seat cap is refused without changing the plan", async ({
  request,
}) => {
  await withOrg(request, async ({ api, org, owner }) => {
    await choose(api, owner, "org-gold-tier", "month");
    fillSeats(org, 5);
    await expectProblem(
      await api.setSubscriptionPlan(owner, { plan_oid: "org-free-tier" }),
      409,
      exceedsTarget,
    );
    expect((await subscription(api, owner)).plan_oid).toBe("org-gold-tier");
  });
});

test("only offered plans can be selected", async ({ request }) => {
  await withOrg(
    request,
    async ({ api, owner }) => {
      await expectProblem(
        await api.setSubscriptionPlan(owner, {
          plan_oid: "org-gold-tier",
          billing_interval: "month",
        }),
        403,
        planNotOffered,
      );
      expect(
        (await choose(api, owner, "org-silver-tier", "month")).plan_oid,
      ).toBe("org-silver-tier");
    },
    "usa1",
  );
});

test("plan writes validate input, authorization and suspension", async ({
  request,
}) => {
  await withOrg(request, async ({ api, org, owner }) => {
    for (const [body, fields] of [
      [{ plan_oid: "org-platinum-tier" }, ["plan_oid"]],
      [
        { plan_oid: "org-free-tier", billing_interval: "month" },
        ["billing_interval"],
      ],
      [{ plan_oid: "org-silver-tier" }, ["billing_interval"]],
      [
        { plan_oid: "org-silver-tier", billing_interval: "week" },
        ["billing_interval"],
      ],
      [
        { plan_oid: "org-silver-tier", billing_interval: null },
        ["billing_interval"],
      ],
    ] as const) {
      await expectProblem(
        await api.post("/set-subscription-plan", body, {
          token: owner,
          idempotencyKey: orgsIdempotencyKey(),
        }),
        400,
        validationFailed,
        [...fields],
      );
    }
    await expectProblem(
      await api.post(
        "/set-subscription-plan",
        { plan_oid: "org-free-tier" },
        { token: owner },
      ),
      400,
      validationFailed,
      ["Idempotency-Key"],
    );
    await expectProblem(
      await request.post(`${api.origin}/api/orgs/set-subscription-plan`, {
        data: "{",
        headers: {
          Authorization: `Bearer ${owner}`,
          "Content-Type": "application/json",
          "Idempotency-Key": orgsIdempotencyKey(),
        },
      }),
      400,
      invalidJSON,
    );
    await expectProblem(
      await api.post(
        "/set-subscription-plan",
        { plan_oid: "org-free-tier" },
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
      ["org:manage_users"],
    );
    await expectProblem(
      await api.setSubscriptionPlan(member.token, {
        plan_oid: "org-free-tier",
      }),
      403,
      permissionRequired,
    );
    suspend(org);
    await expectProblem(
      await api.setSubscriptionPlan(owner, { plan_oid: "org-free-tier" }),
      403,
      orgSuspended,
    );
  });
});

test("a plan change reads seats committed while waiting for the Org lock", async ({
  request,
}) => {
  await withOrg(request, async ({ api, org, owner }) => {
    await choose(api, owner, "org-gold-tier", "month");
    const session = await openTenantSession("sgp");
    try {
      const did = `(SELECT org_did FROM vetchium.org_domains WHERE domain='${org.domain}')`;
      await session.run(
        `BEGIN; SELECT org_did FROM vetchium.orgs WHERE org_did=${did} FOR UPDATE;`,
      );
      const pending = api.setSubscriptionPlan(owner, {
        plan_oid: "org-free-tier",
      });
      await expect
        .poll(() =>
          Number(
            orgSQL(
              `SELECT count(*) FROM pg_stat_activity WHERE ${session.pid}=ANY(pg_blocking_pids(pid))`,
            ),
          ),
        )
        .toBeGreaterThan(0);
      await session.run(
        `INSERT INTO vetchium.org_users(org_user_id,org_did,email_address,org_user_state,preferred_language) SELECT gen_random_uuid(),${did},'lock-'||n||'@${org.domain}','active','en-US' FROM generate_series(1,5) n; COMMIT;`,
      );
      await expectProblem(await pending, 409, exceedsTarget);
      expect((await subscription(api, owner)).plan_oid).toBe("org-gold-tier");
    } finally {
      await session.close();
    }
  });
});

test("plan changes roll back if their audit cannot be written", async ({
  request,
}) => {
  await withOrg(request, async ({ api, org, owner }) => {
    const key = orgsIdempotencyKey();
    const removeFault = installOrgAuditInsertFailure({
      action: "org.subscription.changed",
      idempotencyKey: key,
    });
    try {
      expect(
        (
          await api.setSubscriptionPlan(
            owner,
            { plan_oid: "org-gold-tier", billing_interval: "month" },
            key,
          )
        ).status(),
      ).toBe(500);
    } finally {
      removeFault();
    }
    expect((await subscription(api, owner)).plan_oid).toBe("org-free-tier");
    expect(orgSubscriptionActions(org.domain)).toHaveLength(0);
    await choose(api, owner, "org-gold-tier", "month", key);
    expect(orgSubscriptionActions(org.domain)).toHaveLength(1);
  });
});
