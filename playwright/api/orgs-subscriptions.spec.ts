import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import type { OrgPlan } from "typespec/orgs/subscriptions/plans";
import type {
  ListInvoicesResponse,
  OrgSubscription,
} from "typespec/orgs/subscriptions/subscriptions";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import type { TestTenant } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { boundary, boundaryPairEndingAt } from "../lib/billing-periods.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  inviteeAddress,
  loginOrg,
  OrgsAPI,
  orgAuditEventsByKey,
  orgInfo,
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
const pastDue = "vetchium-problem-details/org-billing-past-due";
const methodRequired = "vetchium-problem-details/org-payment-method-required";
const declined = "vetchium-problem-details/org-payment-declined";
const invoiceNotOpen = "vetchium-problem-details/org-invoice-not-open";
const exceedsTarget = "vetchium-problem-details/org-user-limit-exceeds-target";
const limitReached = "vetchium-problem-details/org-user-limit-reached";
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

async function saveCard(
  api: OrgsAPI,
  token: string,
  kind: "simulated-succeeds" | "simulated-declines",
): Promise<void> {
  const response = await api.setPaymentMethod(token, { kind });
  expect(response.status(), await response.text()).toBe(200);
}

/** Moves a paid Org's period so it ends at `end`, keeping a boundary pair. */
function setPeriod(
  org: SignedUpOrg,
  interval: "month" | "year",
  end: Date,
): void {
  const pair = boundaryPairEndingAt(end, interval);
  orgSQL(
    `UPDATE vetchium.orgs
     SET subscription_anchor_at = '${pair.anchor.toISOString()}',
         subscription_period_start = '${pair.start.toISOString()}',
         subscription_period_end = '${pair.end.toISOString()}'
     WHERE org_did = (SELECT org_did FROM vetchium.org_domains
                      WHERE domain = '${org.domain}')`,
  );
}

/**
 * The CI grace period is seconds long, so a test that needs the Org to stay
 * past due while it works moves the deadline out and drops the scheduled
 * retries. The invoice is otherwise exactly what the API wrote.
 */
function stabilizeOpenInvoice(org: SignedUpOrg): void {
  orgSQL(
    `UPDATE vetchium.org_invoices
     SET due_at = now() + interval '1 hour', next_attempt_at = NULL
     WHERE invoice_state = 'open'
       AND org_did = (SELECT org_did FROM vetchium.org_domains
                      WHERE domain = '${org.domain}')`,
  );
}

/** A period end a moment ago: inside the grace period, outside the period. */
function justEnded(): Date {
  return new Date(Date.now() - 1000);
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

async function invoices(
  api: OrgsAPI,
  token: string,
  limit?: number,
  key?: string,
): Promise<ListInvoicesResponse> {
  const response = await api.listInvoices(token, {
    ...(limit === undefined ? {} : { limit }),
    ...(key === undefined ? {} : { pagination_key: key }),
  });
  expect(response.status(), await response.text()).toBe(200);
  return responseJSON<ListInvoicesResponse>(response);
}

test.describe("my-subscription", () => {
  test("shows a new Org on the Free plan", async ({ request }) => {
    await withOrg(request, async ({ api, owner }) => {
      const response = await api.mySubscription(owner);
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.json()).toEqual({
        plan_oid: "org-free-tier",
        cancel_at_period_end: false,
        billing_state: "current",
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

test.describe("set-payment-method and remove-payment-method", () => {
  test("saves, replaces, and removes the only payment method", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const saved = await api.setPaymentMethod(owner, {
        kind: "simulated-succeeds",
      });
      expect(saved.status()).toBe(200);
      expect(saved.headers()["cache-control"]).toBe("no-store");
      expect(await saved.json()).toEqual({ kind: "simulated-succeeds" });
      expect((await subscription(api, owner)).payment_method).toEqual({
        kind: "simulated-succeeds",
      });

      await saveCard(api, owner, "simulated-declines");
      expect((await subscription(api, owner)).payment_method).toEqual({
        kind: "simulated-declines",
      });
      expect(
        orgSQL(
          `SELECT count(*) FROM vetchium.audit_events
           WHERE action = 'org.payment_method.set'
             AND entity_id = (SELECT org_did::text FROM vetchium.org_domains
                              WHERE domain = '${org.domain}')`,
        ),
      ).toBe("2");

      const removed = await api.removePaymentMethod(owner);
      expect(removed.status()).toBe(204);
      expect(removed.headers()["cache-control"]).toBe("no-store");
      expect((await subscription(api, owner)).payment_method).toBeUndefined();
      expect((await api.removePaymentMethod(owner)).status()).toBe(204);
    });
  });

  test("validates and authorizes", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await expectProblem(
        await api.post(
          "/set-payment-method",
          { kind: "visa-4242" },
          { token: owner },
        ),
        400,
        validationFailed,
        ["kind"],
      );
      const raw = await request.post(
        `${api.origin}/api/orgs/set-payment-method`,
        {
          data: "{",
          headers: {
            Authorization: `Bearer ${owner}`,
            "Content-Type": "application/json",
          },
        },
      );
      await expectProblem(raw, 400, invalidJSON);
      await expectProblem(
        await api.post("/set-payment-method", { kind: "simulated-succeeds" }),
        401,
        authenticationRequired,
      );
      await expectProblem(
        await api.post("/remove-payment-method"),
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
        await api.setPaymentMethod(member.token, {
          kind: "simulated-succeeds",
        }),
        403,
        permissionRequired,
      );
      await expectProblem(
        await api.removePaymentMethod(member.token),
        403,
        permissionRequired,
      );
      // A suspended Org keeps its payment method controls (D27).
      suspend(org);
      expect(
        (
          await api.setPaymentMethod(owner, { kind: "simulated-succeeds" })
        ).status(),
      ).toBe(200);
      expect((await api.removePaymentMethod(owner)).status()).toBe(204);
    });
  });
});

test.describe("set-subscription-plan upgrades", () => {
  test("charges at once, starts a period, and records a paid invoice", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await saveCard(api, owner, "simulated-succeeds");
      const key = orgsIdempotencyKey();
      const before = Date.now();
      const response = await api.setSubscriptionPlan(
        owner,
        { plan_oid: "org-silver-tier", billing_interval: "month" },
        key,
      );
      expect(response.status(), await response.text()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      const body = await responseJSON<OrgSubscription>(response);
      expect(body).toMatchObject({
        plan_oid: "org-silver-tier",
        billing_interval: "month",
        billing_state: "current",
        cancel_at_period_end: false,
        seat_limit: 50,
        payment_method: { kind: "simulated-succeeds" },
      });
      const start = new Date(body.current_period_start ?? "");
      expect(start.getTime()).toBeGreaterThan(before - 60_000);
      expect(Date.parse(body.current_period_end ?? "")).toBe(
        boundary(start, "month", 1).getTime(),
      );

      const listed = await invoices(api, owner);
      expect(listed.invoices).toHaveLength(1);
      expect(listed.invoices[0]).toMatchObject({
        plan_oid: "org-silver-tier",
        billing_interval: "month",
        reason: "upgrade",
        state: "paid",
        period_start: body.current_period_start,
        period_end: body.current_period_end,
      });
      expect(listed.invoices[0]?.paid_at).toBeDefined();
      expect(listed.invoices[0]?.due_at).toBeUndefined();

      const audit = orgAuditEventsByKey(key);
      expect(audit.map((event) => event.action)).toEqual([
        "org.subscription.upgraded",
      ]);
      expect(JSON.stringify(audit[0]?.payload)).not.toContain("simulated");
      expect(await orgInfo(api, owner)).toMatchObject({
        plan_oid: "org-silver-tier",
      });
    });
  });

  test("replays an identical request once", async ({ request }) => {
    await withOrg(request, async ({ api, owner }) => {
      await saveCard(api, owner, "simulated-succeeds");
      const key = orgsIdempotencyKey();
      const first = await api.setSubscriptionPlan(
        owner,
        { plan_oid: "org-gold-tier", billing_interval: "year" },
        key,
      );
      const second = await api.setSubscriptionPlan(
        owner,
        { plan_oid: "org-gold-tier", billing_interval: "year" },
        key,
      );
      expect(first.status()).toBe(200);
      expect(await second.json()).toEqual(await first.json());
      expect((await invoices(api, owner)).invoices).toHaveLength(1);
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

  test("moves up a plan, then from monthly to annual", async ({ request }) => {
    await withOrg(request, async ({ api, owner }) => {
      await saveCard(api, owner, "simulated-succeeds");
      await choose(api, owner, "org-silver-tier", "month");
      const gold = await choose(api, owner, "org-gold-tier", "month");
      expect(gold).toMatchObject({
        plan_oid: "org-gold-tier",
        seat_limit: 1000,
      });
      const annual = await choose(api, owner, "org-gold-tier", "year");
      expect(annual.billing_interval).toBe("year");
      const start = new Date(annual.current_period_start ?? "");
      expect(Date.parse(annual.current_period_end ?? "")).toBe(
        boundary(start, "year", 1).getTime(),
      );
      const listed = await invoices(api, owner);
      expect(
        listed.invoices.map((invoice) => invoice.billing_interval),
      ).toEqual(["year", "month", "month"]);
    });
  });

  test("refuses an upgrade it cannot collect and changes nothing", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, owner }) => {
      await expectProblem(
        await api.setSubscriptionPlan(owner, {
          plan_oid: "org-silver-tier",
          billing_interval: "month",
        }),
        409,
        methodRequired,
      );
      await saveCard(api, owner, "simulated-declines");
      await expectProblem(
        await api.setSubscriptionPlan(owner, {
          plan_oid: "org-silver-tier",
          billing_interval: "month",
        }),
        402,
        declined,
      );
      const current = await subscription(api, owner);
      expect(current.plan_oid).toBe("org-free-tier");
      expect(current.billing_state).toBe("current");
      expect((await invoices(api, owner)).invoices).toEqual([]);
    });
  });

  test("refuses a plan the tenant does not offer", async ({ request }) => {
    // usa1 offers only the Free and Silver plans in the CI configuration.
    await withOrg(
      request,
      async ({ api, owner }) => {
        await saveCard(api, owner, "simulated-succeeds");
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
});

test.describe("set-subscription-plan downgrades", () => {
  test("schedules a change for period end and keeps access", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, owner }) => {
      await saveCard(api, owner, "simulated-succeeds");
      const gold = await choose(api, owner, "org-gold-tier", "month");
      const key = orgsIdempotencyKey();
      const scheduled = await choose(
        api,
        owner,
        "org-silver-tier",
        "year",
        key,
      );
      expect(scheduled).toMatchObject({
        plan_oid: "org-gold-tier",
        cancel_at_period_end: false,
        scheduled_change: {
          plan_oid: "org-silver-tier",
          billing_interval: "year",
        },
        current_period_end: gold.current_period_end,
      });
      expect(orgAuditEventsByKey(key).map((event) => event.action)).toEqual([
        "org.subscription.change-scheduled",
      ]);
      expect((await invoices(api, owner)).invoices).toHaveLength(1);

      const cancelled = await choose(api, owner, "org-free-tier");
      expect(cancelled).toMatchObject({
        cancel_at_period_end: true,
        scheduled_change: { plan_oid: "org-free-tier" },
      });
      expect(cancelled.scheduled_change?.billing_interval).toBeUndefined();

      // Choosing the current plan and interval clears the schedule.
      const cleared = await choose(api, owner, "org-gold-tier", "month");
      expect(cleared.scheduled_change).toBeUndefined();
      expect(cleared.cancel_at_period_end).toBe(false);
    });
  });

  test("is refused while the Org has more users than the target allows", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await saveCard(api, owner, "simulated-succeeds");
      await choose(api, owner, "org-silver-tier", "month");
      fillSeats(org, 5); // the owner and five more: six seats
      const refused = await api.setSubscriptionPlan(owner, {
        plan_oid: "org-free-tier",
      });
      await expectProblem(refused, 409, exceedsTarget);
      const body = await refused.json();
      expect(body.limit).toBe(5);
      expect(body.seats_in_use).toBe(6);
      expect((await subscription(api, owner)).scheduled_change).toBeUndefined();

      // Pending invitations count too: at five seats, one more is too many.
      orgSQL(
        `DELETE FROM vetchium.org_users WHERE email_address = 'filler-5@${org.domain}'`,
      );
      expect(
        (
          await api.setSubscriptionPlan(owner, { plan_oid: "org-free-tier" })
        ).status(),
      ).toBe(200);
    });
  });

  test("a scheduled downgrade lowers the cap for new invitations", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await saveCard(api, owner, "simulated-succeeds");
      await choose(api, owner, "org-silver-tier", "month");
      const roomy = await api.inviteUsers(owner, {
        email_addresses: [0, 1, 2, 3, 4].map(() => inviteeAddress(org.domain)),
      });
      expect(roomy.status(), await roomy.text()).toBe(200);
      await api.cancelInvitations(owner, {
        email_addresses: (
          await responseJSON<{ results: { email_address: string }[] }>(roomy)
        ).results.map((entry) => entry.email_address),
      });

      await choose(api, owner, "org-free-tier");
      expect((await subscription(api, owner)).seat_limit).toBe(5);
      const refused = await api.inviteUsers(owner, {
        email_addresses: [0, 1, 2, 3, 4].map(() => inviteeAddress(org.domain)),
      });
      await expectProblem(refused, 409, limitReached);
      expect((await refused.json()).limit).toBe(5);
    });
  });
});

test.describe("renewal, dunning, and pay-invoice through the API", () => {
  test("a failed renewal makes the Org past due and refuses plan changes", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await saveCard(api, owner, "simulated-succeeds");
      await choose(api, owner, "org-silver-tier", "month");
      await saveCard(api, owner, "simulated-declines");
      const dueAt = justEnded();
      setPeriod(org, "month", dueAt);

      // Whoever looks first - this read, the next request, or the worker that
      // runs every second in CI - sees the same failed renewal.
      expect((await subscription(api, owner)).billing_state).toBe("past-due");

      // A change request is refused while the renewal is unpaid.
      await expectProblem(
        await api.setSubscriptionPlan(owner, {
          plan_oid: "org-gold-tier",
          billing_interval: "month",
        }),
        409,
        pastDue,
      );
      expect(
        orgSubscriptionActions(org.domain).filter(
          (action) => action === "org.subscription.renewal-failed",
        ),
      ).toHaveLength(1);
      stabilizeOpenInvoice(org);
      const current = await subscription(api, owner);
      expect(current).toMatchObject({
        plan_oid: "org-silver-tier",
        billing_state: "past-due",
        open_invoice: {
          state: "open",
          reason: "renewal",
          last_failure: "declined",
          attempt_count: 1,
        },
      });
      const open = current.open_invoice;
      expect(Date.parse(open?.due_at ?? "")).toBeGreaterThan(Date.now());
      expect(Date.parse(current.current_period_start ?? "")).toBe(
        dueAt.getTime(),
      );

      await expectProblem(
        await api.setSubscriptionPlan(owner, { plan_oid: "org-free-tier" }),
        409,
        pastDue,
      );

      // Paying the open invoice returns to current billing, period unchanged.
      await saveCard(api, owner, "simulated-succeeds");
      const payKey = orgsIdempotencyKey();
      const paid = await api.payInvoice(
        owner,
        { invoice_id: open?.invoice_id ?? "" },
        payKey,
      );
      expect(paid.status(), await paid.text()).toBe(200);
      const after = await responseJSON<OrgSubscription>(paid);
      expect(after).toMatchObject({
        billing_state: "current",
        plan_oid: "org-silver-tier",
      });
      expect(after.open_invoice).toBeUndefined();
      expect(after.current_period_end).toBe(current.current_period_end);
      expect(after.current_period_start).toBe(current.current_period_start);
      expect(orgAuditEventsByKey(payKey).map((event) => event.action)).toEqual([
        "org.subscription.invoice-paid",
      ]);
      const listed = await invoices(api, owner);
      expect(listed.invoices[0]).toMatchObject({
        state: "paid",
        reason: "renewal",
      });
      expect(
        (
          await api.setSubscriptionPlan(owner, { plan_oid: "org-free-tier" })
        ).status(),
      ).toBe(200);
    });
  });

  test("a successful renewal starts the next period", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await saveCard(api, owner, "simulated-succeeds");
      await choose(api, owner, "org-silver-tier", "month");
      const end = new Date(Date.now() - 60 * 60 * 1000);
      setPeriod(org, "month", end);
      // The request applies the renewal if the worker has not already.
      const body = await choose(api, owner, "org-silver-tier", "month");
      expect(Date.parse(body.current_period_start ?? "")).toBe(end.getTime());
      expect(body.billing_state).toBe("current");
      expect(
        orgSubscriptionActions(org.domain).filter(
          (action) => action === "org.subscription.renewed",
        ),
      ).toHaveLength(1);
      const listed = await invoices(api, owner);
      expect(listed.invoices.map((invoice) => invoice.reason)).toEqual([
        "renewal",
        "upgrade",
      ]);
    });
  });

  test("a scheduled cancellation is applied at period end", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await saveCard(api, owner, "simulated-succeeds");
      await choose(api, owner, "org-silver-tier", "month");
      await choose(api, owner, "org-free-tier");
      setPeriod(org, "month", new Date(Date.now() - 60 * 60 * 1000));
      const body = await choose(api, owner, "org-free-tier");
      expect(body).toMatchObject({
        plan_oid: "org-free-tier",
        cancel_at_period_end: false,
      });
      expect(body.current_period_end).toBeUndefined();
      expect(body.scheduled_change).toBeUndefined();
    });
  });

  test("pay-invoice refuses what it cannot collect or find", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await saveCard(api, owner, "simulated-succeeds");
      await choose(api, owner, "org-silver-tier", "month");
      await expectProblem(
        await api.payInvoice(owner, {
          invoice_id: "00000000-0000-4000-8000-000000000000",
        }),
        409,
        invoiceNotOpen,
      );
      await saveCard(api, owner, "simulated-declines");
      setPeriod(org, "month", justEnded());
      await api.setSubscriptionPlan(owner, { plan_oid: "org-free-tier" }); // persists the failure
      stabilizeOpenInvoice(org);
      const open = (await subscription(api, owner)).open_invoice;
      expect(open).toBeDefined();
      const invoiceID = open?.invoice_id ?? "";

      await expectProblem(
        await api.payInvoice(owner, { invoice_id: invoiceID }),
        402,
        declined,
      );
      await api.removePaymentMethod(owner);
      await expectProblem(
        await api.payInvoice(owner, { invoice_id: invoiceID }),
        409,
        methodRequired,
      );
      const still = await subscription(api, owner);
      expect(still.billing_state).toBe("past-due");
      expect(still.open_invoice?.attempt_count).toBe(1);

      // A suspended Org may still pay (D27).
      suspend(org);
      await saveCard(api, owner, "simulated-succeeds");
      const key = orgsIdempotencyKey();
      const paid = await api.payInvoice(owner, { invoice_id: invoiceID }, key);
      expect(paid.status(), await paid.text()).toBe(200);
      const replay = await api.payInvoice(
        owner,
        { invoice_id: invoiceID },
        key,
      );
      expect(await replay.json()).toEqual(await paid.json());
      await expectProblem(
        await api.payInvoice(owner, { invoice_id: invoiceID }),
        409,
        invoiceNotOpen,
      );
      await expectProblem(
        await api.payInvoice(
          owner,
          { invoice_id: "00000000-0000-4000-8000-000000000001" },
          key,
        ),
        409,
        keyConflict,
      );
    });
  });

  test("past due is shown to every user, billing detail only to billing holders", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await saveCard(api, owner, "simulated-succeeds");
      await choose(api, owner, "org-silver-tier", "month");
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        [],
      );
      expect((await orgInfo(api, member.token)).billing_notice).toBeUndefined();

      await choose(api, owner, "org-free-tier");
      setPeriod(org, "month", new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
      const ending = await orgInfo(api, owner);
      expect(ending.billing_notice).toMatchObject({
        kind: "subscription-ending",
        banner: true,
        scheduled_plan_oid: "org-free-tier",
      });
      expect((await orgInfo(api, member.token)).billing_notice).toBeUndefined();

      await choose(api, owner, "org-silver-tier", "month");
      await saveCard(api, owner, "simulated-declines");
      setPeriod(org, "month", justEnded());
      await api.setSubscriptionPlan(owner, {
        plan_oid: "org-silver-tier",
        billing_interval: "month",
      });
      stabilizeOpenInvoice(org);
      const forMember = await orgInfo(api, member.token);
      expect(forMember.plan_oid).toBe("org-silver-tier");
      expect(forMember.billing_notice).toMatchObject({
        kind: "past-due",
        banner: true,
      });
      expect((await orgInfo(api, owner)).billing_notice?.kind).toBe("past-due");
    });
  });
});

test.describe("list-invoices", () => {
  test("pages newest first and rejects a foreign key", async ({ request }) => {
    await withOrg(request, async ({ api, owner }) => {
      await saveCard(api, owner, "simulated-succeeds");
      await choose(api, owner, "org-silver-tier", "month");
      await choose(api, owner, "org-gold-tier", "month");
      await choose(api, owner, "org-gold-tier", "year");
      const first = await invoices(api, owner, 2);
      expect(first.invoices.map((invoice) => invoice.billing_interval)).toEqual(
        ["year", "month"],
      );
      expect(first.next_pagination_key).toBeDefined();
      const second = await invoices(api, owner, 2, first.next_pagination_key);
      expect(second.invoices).toHaveLength(1);
      expect(second.invoices[0]?.plan_oid).toBe("org-silver-tier");
      expect(second.next_pagination_key).toBeUndefined();
      await expectProblem(
        await api.listInvoices(owner, {
          pagination_key: randomBytes(32).toString("base64url"),
        }),
        400,
        invalidPaginationKey,
      );
    });
  });

  test("validates and authorizes", async ({ request }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await expectProblem(
        await api.listInvoices(owner, { limit: 0 }),
        400,
        validationFailed,
        ["limit"],
      );
      const raw = await request.post(`${api.origin}/api/orgs/list-invoices`, {
        data: "{",
        headers: {
          Authorization: `Bearer ${owner}`,
          "Content-Type": "application/json",
        },
      });
      await expectProblem(raw, 400, invalidJSON);
      await expectProblem(
        await api.post("/list-invoices", {}),
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
        await api.listInvoices(member.token),
        403,
        permissionRequired,
      );
    });
  });
});

test.describe("set-subscription-plan and pay-invoice validation", () => {
  test("rejects malformed and unauthorized requests", async ({ request }) => {
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
        await api.payInvoice(owner, { invoice_id: "nope" }),
        400,
        validationFailed,
        ["invoice_id"],
      );
      for (const path of ["/set-subscription-plan", "/pay-invoice"]) {
        const raw = await request.post(`${api.origin}/api/orgs${path}`, {
          data: "{",
          headers: {
            Authorization: `Bearer ${owner}`,
            "Content-Type": "application/json",
            "Idempotency-Key": orgsIdempotencyKey(),
          },
        });
        await expectProblem(raw, 400, invalidJSON);
      }
      await expectProblem(
        await api.post(
          "/set-subscription-plan",
          { plan_oid: "org-free-tier" },
          {
            idempotencyKey: orgsIdempotencyKey(),
          },
        ),
        401,
        authenticationRequired,
      );
      await expectProblem(
        await api.post(
          "/pay-invoice",
          { invoice_id: "00000000-0000-4000-8000-000000000000" },
          {
            idempotencyKey: orgsIdempotencyKey(),
          },
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
      await expectProblem(
        await api.payInvoice(member.token, {
          invoice_id: "00000000-0000-4000-8000-000000000000",
        }),
        403,
        permissionRequired,
      );
      // Choosing a plan is not a billing read: a suspended Org cannot (D27).
      suspend(org);
      await expectProblem(
        await api.setSubscriptionPlan(owner, { plan_oid: "org-free-tier" }),
        403,
        orgSuspended,
      );
    });
  });
});
