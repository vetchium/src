import type { Page } from "@playwright/test";
import type {
  ListInvoicesResponse,
  OrgSubscription,
} from "typespec/orgs/subscriptions/subscriptions";
import type { ListInvitationsResponse } from "typespec/orgs/users/invitations";
import type { ListUsersResponse } from "typespec/orgs/users/management";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { boundaryPairEndingAt } from "../lib/billing-periods.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  inviteeAddress,
  loginOrg,
  type OrgMember,
  OrgsAPI,
  orgEmailText,
  orgInfo,
  orgSQL,
  orgSubscriptionActions,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";

// The CI configuration times dunning in seconds (a 12 s grace period, retries
// at +3, +6, and +9 s, a worker tick every second), so these tests watch the
// real worker move an Org through its lifecycle.
test.describe.configure({ timeout: 120_000 });

const userDisabledNonpayment =
  "vetchium-problem-details/org-user-disabled-nonpayment";

async function withOrg(
  request: Page["request"],
  body: (api: OrgsAPI, org: SignedUpOrg, owner: string) => Promise<void>,
): Promise<void> {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    await body(api, org, await loginOrg(api, org));
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
}

function setPeriodEnd(org: SignedUpOrg, end: Date): void {
  const pair = boundaryPairEndingAt(end, "month");
  orgSQL(
    `UPDATE vetchium.orgs
     SET subscription_anchor_at = '${pair.anchor.toISOString()}',
         subscription_period_start = '${pair.start.toISOString()}',
         subscription_period_end = '${pair.end.toISOString()}'
     WHERE org_did = (SELECT org_did FROM vetchium.org_domains
                      WHERE domain = '${org.domain}')`,
  );
}

async function subscription(api: OrgsAPI, token: string) {
  const response = await api.mySubscription(token);
  expect(response.status(), await response.text()).toBe(200);
  return responseJSON<OrgSubscription>(response);
}

async function upgradeToSilver(api: OrgsAPI, owner: string): Promise<void> {
  expect(
    (
      await api.setPaymentMethod(owner, { kind: "simulated-succeeds" })
    ).status(),
  ).toBe(200);
  const response = await api.setSubscriptionPlan(owner, {
    plan_oid: "org-silver-tier",
    billing_interval: "month",
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** Waits for the worker to record `action` for the Org. */
async function waitForAction(
  org: SignedUpOrg,
  action: string,
  timeout = 20_000,
) {
  await expect
    .poll(() => orgSubscriptionActions(org.domain).includes(action), {
      timeout,
    })
    .toBe(true);
}

async function userStates(api: OrgsAPI, owner: string) {
  const response = await api.listUsers(owner, { limit: 100 });
  expect(response.status(), await response.text()).toBe(200);
  const listed = await responseJSON<ListUsersResponse>(response);
  return new Map(listed.users.map((user) => [user.email_address, user]));
}

test("a declined renewal runs the dunning lifecycle to the deadline, then the Org can recover", async ({
  request,
}) => {
  await withOrg(request, async (api, org, owner) => {
    await upgradeToSilver(api, owner);
    const finance = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain, "fin"),
      ["org:manage_billing"],
    );
    const members: OrgMember[] = [];
    for (let index = 1; index <= 5; index++) {
      members.push(
        await addOrgMember(
          api,
          owner,
          org.domain,
          inviteeAddress(org.domain, `m${index}`),
          [],
        ),
      );
    }
    const pending = inviteeAddress(org.domain, "pending");
    expect(
      (await api.inviteUsers(owner, { email_addresses: [pending] })).status(),
    ).toBe(200);

    // The renewal falls due and the saved card declines it.
    expect(
      (
        await api.setPaymentMethod(owner, { kind: "simulated-declines" })
      ).status(),
    ).toBe(200);
    const ended = new Date(Date.now() - 1000);
    setPeriodEnd(org, ended);

    // Past due: service continues, everyone is warned, billing holders emailed.
    await waitForAction(org, "org.subscription.renewal-failed");
    expect((await subscription(api, owner)).billing_state).toBe("past-due");
    const warned = await orgInfo(api, members[0]?.token ?? "");
    expect(warned.plan_oid).toBe("org-silver-tier");
    expect(warned.billing_notice).toMatchObject({
      kind: "past-due",
      banner: true,
    });
    expect(
      await orgEmailText(request, finance.emailAddress, "Payment failed"),
    ).toContain(org.domain);

    // The worker retries on schedule; each declined retry is audited.
    await waitForAction(org, "org.subscription.retry-failed");

    // At the deadline the Org drops to Free and only the keep set stays.
    await waitForAction(org, "org.subscription.deadline-enforced", 30_000);
    const free = await subscription(api, owner);
    expect(free).toMatchObject({
      plan_oid: "org-free-tier",
      billing_state: "current",
    });
    expect(free.open_invoice).toBeUndefined();
    expect(free.scheduled_change).toBeUndefined();

    // Keep set (D11): the superadmin, the billing holder, then the three
    // longest-standing members. The two newest members are disabled.
    const states = await userStates(api, owner);
    const [first, second, third, fourth, fifth] = members;
    for (const kept of [org, finance, first, second, third]) {
      expect(states.get(kept?.emailAddress ?? "")?.state).toBe("active");
    }
    for (const disabled of [fourth, fifth]) {
      const user = states.get(disabled?.emailAddress ?? "");
      expect(user).toMatchObject({
        state: "disabled",
        disabled_reason: "nonpayment",
      });
      await expectProblem(
        await api.post("/login", {
          domain: org.domain,
          email_address: disabled?.emailAddress,
          password: disabled?.password,
        }),
        403,
        userDisabledNonpayment,
      );
      await expectProblem(
        await api.myInfo(disabled?.token),
        401,
        "vetchium-problem-details/org-authentication-required",
      );
    }
    const invitations = await responseJSON<ListInvitationsResponse>(
      await api.listInvitations(owner),
    );
    expect(invitations.invitations).toEqual([]);
    const invoices = await responseJSON<ListInvoicesResponse>(
      await api.listInvoices(owner),
    );
    expect(invoices.invoices[0]).toMatchObject({
      state: "void",
      reason: "renewal",
    });

    expect(
      await orgEmailText(request, fourth?.emailAddress ?? "", "was disabled"),
    ).toContain(org.domain);
    expect(
      await orgEmailText(request, finance.emailAddress, "Free plan"),
    ).toContain(org.domain);

    // Paying later is a fresh upgrade; users return one at a time (D12).
    expect(
      (
        await api.setPaymentMethod(owner, { kind: "simulated-succeeds" })
      ).status(),
    ).toBe(200);
    expect(
      (
        await api.setSubscriptionPlan(owner, {
          plan_oid: "org-silver-tier",
          billing_interval: "month",
        })
      ).status(),
    ).toBe(200);
    expect(states.get(fourth?.emailAddress ?? "")?.state).toBe("disabled");
    for (const restored of [fourth, fifth]) {
      expect(
        (
          await api.enableUser(owner, {
            email_address: restored?.emailAddress ?? "",
          })
        ).status(),
      ).toBe(204);
    }
    expect(
      (await userStates(api, owner)).get(fifth?.emailAddress ?? "")?.state,
    ).toBe("active");
    expect((await loginOrg(api, fifth ?? org)).length).toBeGreaterThan(0);
  });
});

test("a request that reaches the deadline first disables users as the worker would", async ({
  request,
}) => {
  await withOrg(request, async (api, org, owner) => {
    await upgradeToSilver(api, owner);
    const members: OrgMember[] = [];
    for (let index = 1; index <= 6; index++) {
      members.push(
        await addOrgMember(
          api,
          owner,
          org.domain,
          inviteeAddress(org.domain, `m${index}`),
          [],
        ),
      );
    }
    expect(
      (
        await api.setPaymentMethod(owner, { kind: "simulated-declines" })
      ).status(),
    ).toBe(200);
    setPeriodEnd(org, new Date(Date.now() - 1000));
    await waitForAction(org, "org.subscription.renewal-failed");
    const open = (await subscription(api, owner)).open_invoice;
    expect(open).toBeDefined();

    // Pass the deadline and ask at once, so the request usually persists it
    // before the worker's next tick. Whichever acts, the outcome must match.
    orgSQL(
      `UPDATE vetchium.org_invoices
       SET due_at = now() - interval '1 second', next_attempt_at = NULL
       WHERE invoice_state = 'open'
         AND org_did = (SELECT org_did FROM vetchium.org_domains
                        WHERE domain = '${org.domain}')`,
    );
    await expectProblem(
      await api.payInvoice(owner, { invoice_id: open?.invoice_id ?? "" }),
      409,
      "vetchium-problem-details/org-invoice-not-open",
    );
    // The deadline and its effect on people commit in one transaction.
    await waitForAction(org, "org.subscription.deadline-enforced");

    const states = await userStates(api, owner);
    const active = [...states.values()].filter(
      (user) => user.state === "active",
    );
    expect(active.map((user) => user.email_address).sort()).toEqual(
      [org, ...members.slice(0, 4)].map((kept) => kept.emailAddress).sort(),
    );
    for (const disabled of members.slice(4)) {
      expect(states.get(disabled.emailAddress)).toMatchObject({
        state: "disabled",
        disabled_reason: "nonpayment",
      });
    }
  });
});

test("paying the open invoice before the deadline keeps the plan and every user", async ({
  request,
}) => {
  await withOrg(request, async (api, org, owner) => {
    await upgradeToSilver(api, owner);
    const members: OrgMember[] = [];
    for (let index = 1; index <= 5; index++) {
      members.push(
        await addOrgMember(
          api,
          owner,
          org.domain,
          inviteeAddress(org.domain, `m${index}`),
          [],
        ),
      );
    }
    expect(
      (
        await api.setPaymentMethod(owner, { kind: "simulated-declines" })
      ).status(),
    ).toBe(200);
    const ended = new Date(Date.now() - 1000);
    setPeriodEnd(org, ended);
    await waitForAction(org, "org.subscription.renewal-failed");

    const open = (await subscription(api, owner)).open_invoice;
    expect(open).toBeDefined();
    expect(
      (
        await api.setPaymentMethod(owner, { kind: "simulated-succeeds" })
      ).status(),
    ).toBe(200);
    const paid = await api.payInvoice(owner, {
      invoice_id: open?.invoice_id ?? "",
    });
    expect(paid.status(), await paid.text()).toBe(200);
    expect((await responseJSON<OrgSubscription>(paid)).billing_state).toBe(
      "current",
    );

    // Wait out the original deadline: nothing is enforced.
    const deadline = ended.getTime() + 12_000;
    await expect
      .poll(() => Date.now() > deadline + 3000, { timeout: 30_000 })
      .toBe(true);
    expect(orgSubscriptionActions(org.domain)).not.toContain(
      "org.subscription.deadline-enforced",
    );
    expect(await subscription(api, owner)).toMatchObject({
      plan_oid: "org-silver-tier",
      billing_state: "current",
    });
    const states = await userStates(api, owner);
    expect([...states.values()].every((user) => user.state === "active")).toBe(
      true,
    );
    expect(states.size).toBe(6);
  });
});

test("a retry that the card now accepts settles the invoice", async ({
  request,
}) => {
  await withOrg(request, async (api, org, owner) => {
    await upgradeToSilver(api, owner);
    expect(
      (
        await api.setPaymentMethod(owner, { kind: "simulated-declines" })
      ).status(),
    ).toBe(200);
    setPeriodEnd(org, new Date(Date.now() - 1000));
    await waitForAction(org, "org.subscription.renewal-failed");
    // The customer fixes the card; the next scheduled retry collects it.
    expect(
      (
        await api.setPaymentMethod(owner, { kind: "simulated-succeeds" })
      ).status(),
    ).toBe(200);
    await waitForAction(org, "org.subscription.retry-succeeded");
    const settled = await subscription(api, owner);
    expect(settled).toMatchObject({
      plan_oid: "org-silver-tier",
      billing_state: "current",
    });
    expect(settled.open_invoice).toBeUndefined();
    const invoices = await responseJSON<ListInvoicesResponse>(
      await api.listInvoices(owner),
    );
    expect(invoices.invoices[0]).toMatchObject({
      state: "paid",
      reason: "renewal",
    });
  });
});
