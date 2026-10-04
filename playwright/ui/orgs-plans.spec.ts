import type { Page } from "@playwright/test";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  inviteeAddress,
  loginOrg,
  OrgsAPI,
  orgSQL,
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
  await expect(page.getByTestId("shell-org-name")).toBeVisible();
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

test("billing separates the summary and comparison and confirms immediate changes", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org) => {
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/plans`);
    await expect(page.getByTestId("current-plan")).toHaveText("Free");
    await expect(page.getByTestId("plan-org-gold-tier")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Change plan", exact: true })
      .click();
    const gold = page.getByTestId("plan-org-gold-tier");
    await gold.getByRole("button", { name: "Upgrade", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("applies immediately");
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await gold.getByRole("button", { name: "Upgrade", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Upgrade", exact: true })
      .click();
    await expect(page.getByTestId("current-plan")).toContainText("Gold");
    await page
      .getByRole("button", { name: "Change plan", exact: true })
      .click();
    await expect(page.getByText("Recommended", { exact: true })).toHaveCount(0);
    await page
      .getByTestId("plan-org-silver-tier")
      .getByRole("button", { name: "Downgrade", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Downgrade", exact: true })
      .click();
    await expect(page.getByTestId("current-plan")).toContainText("Silver");
  });
});

test("billing requires permission and suspended organizations cannot change plans", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    const member = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain),
      [],
    );
    await signIn(page, member);
    await page.goto(`${ORGS_PORTAL}/plans`);
    await expect(page.getByTestId("current-subscription")).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await signIn(page, org);
    orgSQL(
      `UPDATE vetchium.orgs SET org_state='suspended', suspended_at=now() WHERE org_did=(SELECT org_did FROM vetchium.org_domains WHERE domain='${org.domain}')`,
    );
    await page.goto(`${ORGS_PORTAL}/plans`);
    await expect(page.getByTestId("current-subscription")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Change plan", exact: true }),
    ).toHaveCount(0);
  });
});

test("billing and company forms work in German with keyboard navigation", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org) => {
    await signIn(page, org);
    await page.getByRole("combobox", { name: "Select language" }).click();
    await page.getByRole("option", { name: "Deutsch (Deutschland)" }).click();
    await page.goto(`${ORGS_PORTAL}/plans`);
    const change = page.getByRole("button", {
      name: "Tarif ändern",
      exact: true,
    });
    await change.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("plan-org-gold-tier")).toBeVisible();
    await page
      .getByRole("button", { name: "Zurück zur Abrechnung", exact: true })
      .click();
    await expect(page.getByTestId("current-subscription")).toBeVisible();
    await page.goto(`${ORGS_PORTAL}/company`);
    await page
      .getByLabel("Unternehmensname", { exact: true })
      .fill("Beispiel GmbH");
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(page.getByTestId("shell-org-name")).toHaveText(
      "Beispiel GmbH",
    );
  });
});

test("billing explains a seat-blocked downgrade and treats interval changes separately", async ({
  page,
  request,
}) => {
  await withOrg(request, async (org, api, owner) => {
    await api.setSubscriptionPlan(owner, {
      plan_oid: "org-silver-tier",
      billing_interval: "month",
    });
    await api.inviteUsers(owner, {
      email_addresses: Array.from({ length: 5 }, () =>
        inviteeAddress(org.domain),
      ),
    });
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/plans`);
    await page
      .getByRole("button", { name: "Change plan", exact: true })
      .click();
    await page
      .getByTestId("plan-org-free-tier")
      .getByRole("button", { name: "Switch to Free" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Switch to Free" }),
    ).toBeDisabled();
    await expect(dialog.getByRole("link", { name: "People" })).toBeVisible();
    await dialog.getByRole("button", { name: "Go back" }).click();
    await page.getByRole("radio", { name: "Annual", exact: true }).focus();
    await page.keyboard.press("Space");
    await page
      .getByTestId("plan-org-silver-tier")
      .getByRole("button", { name: "Change billing interval" })
      .click();
    await dialog
      .getByRole("button", { name: "Change billing interval" })
      .click();
    await expect(page.getByTestId("current-plan")).toHaveText(
      "Silver · Annual",
    );
    await page.setViewportSize({ width: 375, height: 812 });
    await page
      .getByRole("button", { name: "Change plan", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});
