import { expect, type Page, test } from "@playwright/test";
import { boundaryPairEndingAt } from "../lib/billing-periods.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  inviteeAddress,
  loginOrg,
  OrgsAPI,
  orgSQL,
  orgSubscriptionActions,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";
import { chooseRegion } from "../lib/region-ui.ts";

test.describe.configure({ timeout: 90_000 });

async function signIn(
  page: Page,
  user: Pick<SignedUpOrg, "domain" | "emailAddress" | "password">,
) {
  await page.goto(`${ORGS_PORTAL}/login?domain=${user.domain}`);
  await page.getByLabel("Email address").fill(user.emailAddress);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await chooseRegion(page, "sgp");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("shell-user-email")).toHaveText(
    user.emailAddress,
  );
}

async function withOrg(
  request: Parameters<typeof signupOrg>[0]["request"],
  body: (org: SignedUpOrg, api: OrgsAPI, owner: string) => Promise<void>,
) {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    await body(org, api, await loginOrg(api, org));
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
}

async function silverWithCard(
  api: OrgsAPI,
  owner: string,
  kind: "simulated-succeeds" | "simulated-declines" = "simulated-succeeds",
) {
  expect((await api.setPaymentMethod(owner, { kind })).status()).toBe(200);
  expect(
    (
      await api.setSubscriptionPlan(owner, {
        plan_oid: "org-silver-tier",
        billing_interval: "month",
      })
    ).status(),
  ).toBe(200);
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

/** Pushes the deadline out and drops the scheduled retries, so a test that
 * needs the Org to stay past due is not raced by the CI grace period. */
function stabilizeOpenInvoice(org: SignedUpOrg): void {
  orgSQL(
    `UPDATE vetchium.org_invoices
     SET due_at = now() + interval '1 hour', next_attempt_at = NULL
     WHERE invoice_state = 'open'
       AND org_did = (SELECT org_did FROM vetchium.org_domains
                      WHERE domain = '${org.domain}')`,
  );
}

test("picks a plan, a payment method, and upgrades; a declining card refuses", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org) => {
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/plans`);
    await expect(
      page.getByRole("heading", { name: "Plan and billing", level: 1 }),
    ).toBeVisible();

    // The comparison comes from the contract's entitlements; Gold's ticket
    // support and MCP support are announced, not offered yet.
    const comparison = page.getByTestId("plan-comparison");
    await expect(comparison.getByText("Coming soon")).toHaveCount(2);
    await expect(comparison).toContainText(
      "1,000 users, unlimited with Google sign-in",
    );
    await expect(page.getByText("Introductory pricing").first()).toBeVisible();
    await expect(
      page.getByText(
        "Paid plans fund the development of Vetchium, a free and open-source project.",
      ),
    ).toBeVisible();
    await expect(page.getByTestId("current-plan")).toHaveText("Free");

    // Without a saved card the upgrade is refused and nothing changes.
    await page
      .getByTestId("plan-card-org-silver-tier")
      .getByRole("button", { name: "Upgrade" })
      .click();
    await expect(page.getByText("Save a payment method first.")).toBeVisible();
    await expect(page.getByTestId("current-plan")).toHaveText("Free");

    const card = page.getByTestId("payment-method");
    await expect(card).toContainText("Payments are simulated");
    await card.getByRole("radio", { name: /ending 4242/ }).check();
    await card.getByRole("button", { name: "Save payment method" }).click();
    await expect(page.getByTestId("payment-method-saved")).toContainText(
      "ending 4242",
    );

    await page
      .getByTestId("plan-card-org-silver-tier")
      .getByRole("button", { name: "Upgrade" })
      .click();
    await expect(page.getByTestId("current-plan")).toHaveText(
      "Silver · Monthly",
    );
    await expect(page.getByTestId("current-seats")).toContainText(
      "1 of 50 seats used",
    );
    await expect(
      page.getByTestId("invoices").getByTestId("invoice-state"),
    ).toHaveText(["Paid"]);

    // A declining card refuses the next upgrade and leaves the plan alone.
    await card.getByRole("radio", { name: /ending 0002/ }).check();
    await card.getByRole("button", { name: "Save payment method" }).click();
    await expect(page.getByTestId("payment-method-saved")).toContainText(
      "ending 0002",
    );
    await page
      .getByTestId("plan-card-org-gold-tier")
      .getByRole("button", { name: "Upgrade" })
      .click();
    await expect(
      page.getByText("The saved payment method was declined."),
    ).toBeVisible();
    await expect(page.getByTestId("current-plan")).toHaveText(
      "Silver · Monthly",
    );

    // Downgrading is scheduled, not immediate.
    await page
      .getByTestId("plan-card-org-free-tier")
      .getByRole("button", { name: "Switch to Free at period end" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Switch to Free at period end" })
      .click();
    await expect(page.getByTestId("scheduled-change")).toHaveText("Free");
    await expect(page.getByTestId("current-plan")).toHaveText(
      "Silver · Monthly",
    );
    await expect(page.getByTestId("billing-banner-ending")).toHaveCount(0);
  });
});

test("everyone sees an unpaid invoice; a billing holder pays it", async ({
  browser,
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    await silverWithCard(api, owner);
    const member = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain),
      [],
    );
    expect(
      (
        await api.setPaymentMethod(owner, { kind: "simulated-declines" })
      ).status(),
    ).toBe(200);
    setPeriodEnd(org, new Date(Date.now() - 1000));
    await expect
      .poll(
        () =>
          orgSubscriptionActions(org.domain).includes(
            "org.subscription.renewal-failed",
          ),
        {
          timeout: 20_000,
        },
      )
      .toBe(true);
    stabilizeOpenInvoice(org);

    // A plain member is warned but has nothing to pay with.
    const memberContext = await browser.newContext();
    try {
      const memberPage = await memberContext.newPage();
      await signIn(memberPage, member);
      const banner = memberPage.getByTestId("billing-banner-past-due");
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(
        "Users beyond the Free plan's limit may be disabled",
      );
      await expect(banner.getByRole("button", { name: "Pay now" })).toHaveCount(
        0,
      );
      await expect(
        memberPage.getByRole("link", { name: "Plan and billing" }),
      ).toHaveCount(0);
    } finally {
      await memberContext.close();
    }

    // The billing holder pays; a declining card fails, a good one settles it.
    await signIn(page, org);
    const ownerBanner = page.getByTestId("billing-banner-past-due");
    await expect(ownerBanner).toBeVisible();
    await ownerBanner.getByRole("button", { name: "Pay now" }).click();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/plans`);
    await expect(page.getByTestId("current-subscription")).toContainText(
      "Past due",
    );
    await page
      .getByTestId("invoices")
      .getByRole("button", { name: "Pay now" })
      .click();
    await expect(
      page.getByText("The saved payment method was declined."),
    ).toBeVisible();

    const card = page.getByTestId("payment-method");
    await card.getByRole("radio", { name: /ending 4242/ }).check();
    await card.getByRole("button", { name: "Save payment method" }).click();
    await expect(page.getByTestId("payment-method-saved")).toContainText(
      "ending 4242",
    );
    await page
      .getByTestId("invoices")
      .getByRole("button", { name: "Pay now" })
      .click();
    await expect(page.getByTestId("current-subscription")).toContainText(
      "Up to date",
    );
    await expect(page.getByTestId("billing-banner-past-due")).toHaveCount(0);
    await expect(
      page.getByTestId("invoices").getByTestId("invoice-state").first(),
    ).toHaveText("Paid");
  });
});

test("billing holders are told when no payment method is saved or the plan is dropping", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    await silverWithCard(api, owner);
    await signIn(page, org);
    await expect(page.getByTestId("billing-banner-no-method")).toHaveCount(0);

    expect((await api.removePaymentMethod(owner)).status()).toBe(204);
    await page.reload();
    await expect(page.getByTestId("billing-banner-no-method")).toBeVisible();
    await page
      .getByTestId("billing-banner-no-method")
      .getByRole("button", { name: "Add payment method" })
      .click();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/plans`);

    expect(
      (
        await api.setPaymentMethod(owner, { kind: "simulated-succeeds" })
      ).status(),
    ).toBe(200);
    expect(
      (
        await api.setSubscriptionPlan(owner, { plan_oid: "org-free-tier" })
      ).status(),
    ).toBe(200);
    setPeriodEnd(org, new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
    await page.reload();
    const ending = page.getByTestId("billing-banner-ending");
    await expect(ending).toBeVisible();
    await expect(ending).toContainText("Your plan changes to Free");
  });
});

test("an unrecognized plan is shown as it is and cannot be changed", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org) => {
    await signIn(page, org);
    await page.route("**/api/orgs/my-subscription", (route) =>
      route.fulfill({
        json: {
          plan_oid: "org-platinum-tier",
          cancel_at_period_end: false,
          billing_state: "current",
          seats_in_use: 1,
        },
      }),
    );
    await page.goto(`${ORGS_PORTAL}/plans`);
    await expect(page.getByTestId("current-plan")).toHaveText(
      "org-platinum-tier",
    );
    await expect(page.getByText("Unrecognized plan").first()).toBeVisible();
    for (const plan of ["org-free-tier", "org-silver-tier", "org-gold-tier"]) {
      await expect(
        page.getByTestId(`plan-card-${plan}`).getByRole("button").last(),
      ).toBeDisabled();
    }
  });
});
