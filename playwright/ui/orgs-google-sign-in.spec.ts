import { expect, type Page, test } from "@playwright/test";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";
import { chooseRegion } from "../lib/region-ui.ts";

async function signInWithPassword(page: Page, user: SignedUpOrg) {
  await page.goto(`${ORGS_PORTAL}/login?domain=${user.domain}`);
  await page.getByLabel("Email address").fill(user.emailAddress);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await chooseRegion(page, "sgp");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("shell-org-name")).toBeVisible();
}

/** The development provider has no account chooser, so the test plays the
 * user's choice by naming the account on the way to the provider. */
async function chooseGoogleAccount(page: Page, email: string) {
  await page.route("**/authorize?*", async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("login_hint", email);
    await route.continue({ url: url.toString() });
  });
}

async function startGoogleSignIn(page: Page, domain: string) {
  await page.goto(`${ORGS_PORTAL}/login?domain=${domain}`);
  await chooseRegion(page, "sgp");
  await page.getByTestId("google-sign-in").click();
}

test("a superadmin turns Google sign-in on, and a user signs in through it", async ({
  page,
  browser,
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    await signInWithPassword(page, org);

    await page.goto(`${ORGS_PORTAL}/organization-security`);
    await expect(page.getByTestId("google-upgrade")).toContainText("Gold plan");
    await expect(page.getByTestId("google-switch")).toBeDisabled();

    expect(
      (
        await api.setSubscriptionPlan(owner, {
          plan_oid: "org-gold-tier",
          billing_interval: "month",
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    await expect(page.getByTestId("google-upgrade")).toHaveCount(0);
    const toggle = page.getByTestId("google-switch");
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "OK", exact: true })
      .click();
    await expect(toggle).toBeChecked();
    await page.reload();
    await expect(page.getByTestId("google-switch")).toBeChecked();

    // A fresh browser context has no session and no stored region.
    const context = await browser.newContext();
    try {
      const visitor = await context.newPage();
      await chooseGoogleAccount(visitor, org.emailAddress);
      await startGoogleSignIn(visitor, org.domain);
      await expect(visitor.getByTestId("shell-org-name")).toBeVisible();
      expect(new URL(visitor.url()).pathname).toBe("/");
    } finally {
      await context.close();
    }

    // An account the Org does not have is refused with a plain message.
    const stranger = await browser.newContext();
    try {
      const visitor = await stranger.newPage();
      await chooseGoogleAccount(visitor, `ghost@${org.domain}`);
      await startGoogleSignIn(visitor, org.domain);
      await expect(visitor.getByTestId("google-failed")).toContainText(
        "Google sign-in did not work",
      );
      await visitor.getByRole("button", { name: "Back to sign-in" }).click();
      await expect(
        visitor.getByRole("heading", { name: "Sign in", level: 1 }),
      ).toBeVisible();
    } finally {
      await stranger.close();
    }

    // Turning it off ends the option for the next visitor.
    await page.getByTestId("google-switch").click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "OK", exact: true })
      .click();
    await expect(page.getByTestId("google-switch")).not.toBeChecked();
    const later = await browser.newContext();
    try {
      const visitor = await later.newPage();
      await chooseGoogleAccount(visitor, org.emailAddress);
      await startGoogleSignIn(visitor, org.domain);
      await expect(visitor.getByTestId("google-failed")).toBeVisible();
    } finally {
      await later.close();
    }
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("a callback with nothing pending fails without calling the API", async ({
  page,
}) => {
  let called = false;
  await page.route("**/api/orgs/sso/google/complete", async (route) => {
    called = true;
    await route.abort();
  });
  await page.goto(`${ORGS_PORTAL}/sso/google/callback?code=x&state=y`);
  await expect(page.getByTestId("google-failed")).toBeVisible();
  expect(called).toBe(false);
});

test("a callback carrying a state this tab did not start fails without calling the API", async ({
  page,
}) => {
  let called = false;
  await page.route("**/api/orgs/sso/google/complete", async (route) => {
    called = true;
    await route.abort();
  });
  await page.goto(`${ORGS_PORTAL}/login`);
  await page.evaluate(() =>
    sessionStorage.setItem(
      "vetchium.orgs.sso.google",
      JSON.stringify({
        tenantId: "sgp",
        returnTo: "/",
        state: "started-in-this-tab",
      }),
    ),
  );
  await page.goto(`${ORGS_PORTAL}/sso/google/callback?code=x&state=planted`);
  await expect(page.getByTestId("google-failed")).toBeVisible();
  expect(called).toBe(false);
});
