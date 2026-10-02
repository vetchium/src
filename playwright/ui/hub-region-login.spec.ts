import type { Page } from "@playwright/test";
import { HUB_PORTAL } from "../lib/portals.ts";
import {
  chooseRegion,
  expect,
  expectSelectedRegion,
  type HubTestUser,
  recordRegionalAPIHosts,
  regionPicker,
  test,
} from "../lib/region-ui.ts";

const wrongRegionHint =
  "If your email and password are right, check that the selected region is the one where you created your account.";

async function signIn(
  page: Page,
  user: Pick<HubTestUser, "email">,
  password: string,
) {
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("the region picker's starting choice", () => {
  test("follows the browser locale's country", async ({ browser }) => {
    for (const [locale, tenant] of [
      ["de-DE", "deu"],
      ["en-IN", "ind1"],
      ["en-US", "usa1"],
      ["ja-JP", "sgp"],
      ["en", "sgp"],
    ] as const) {
      const context = await browser.newContext({ locale });
      try {
        const page = await context.newPage();
        await page.goto(`${HUB_PORTAL}/login`);
        // The portal speaks the browser's language, so only the tenant id in
        // the option label is locale-independent.
        await expect(regionPicker(page).locator("..")).toHaveAttribute(
          "title",
          new RegExp(`\\(${tenant}\\)$`),
        );
      } finally {
        await context.close();
      }
    }
  });

  test("is taken from a valid region link parameter without being remembered", async ({
    context,
    page,
  }) => {
    await page.goto(`${HUB_PORTAL}/login?region=deu`);
    await expectSelectedRegion(page, "deu");

    const next = await context.newPage();
    await next.goto(`${HUB_PORTAL}/login`);
    await expectSelectedRegion(next, "usa1");
  });

  for (const query of [
    "region=SGP",
    "region=nowhere",
    "region=deu&region=deu",
  ]) {
    test(`ignores the invalid link parameter ${query}`, async ({ page }) => {
      await page.goto(`${HUB_PORTAL}/login?${query}`);
      await expectSelectedRegion(page, "usa1");
    });
  }
});

test("a Hub user signs in at the chosen region, which is remembered for the next visit", async ({
  context,
  hubUser,
  page,
}) => {
  const user = await hubUser("sgp");
  const hosts = recordRegionalAPIHosts(page);
  await page.goto(`${HUB_PORTAL}/login`);
  await expect(regionPicker(page)).toBeVisible();
  // The browser locale recommends usa1, so this sign-in depends on the choice.
  await expectSelectedRegion(page, "usa1");
  await chooseRegion(page, "sgp");
  await expectSelectedRegion(page, "sgp");

  await signIn(page, user, user.password);
  await expect(page).toHaveURL(`${HUB_PORTAL}/`);
  await expect(
    page.getByRole("heading", { name: `Welcome back, ${user.displayName}` }),
  ).toBeVisible();
  expect(hosts.length).toBeGreaterThan(0);
  expect(new Set(hosts)).toEqual(new Set(["sgp.api.vetchium.localhost"]));

  // The session lives in this tab's storage; a new tab signs in again but
  // starts from the remembered region.
  const next = await context.newPage();
  await next.goto(`${HUB_PORTAL}/login`);
  await expect(next.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expectSelectedRegion(next, "sgp");
});

test("a region taken from a link is remembered once sign-in succeeds", async ({
  context,
  hubUser,
  page,
}) => {
  const user = await hubUser("sgp");
  await page.goto(`${HUB_PORTAL}/login?region=sgp`);
  await expectSelectedRegion(page, "sgp");
  await signIn(page, user, user.password);
  await expect(
    page.getByRole("heading", { name: `Welcome back, ${user.displayName}` }),
  ).toBeVisible();

  const next = await context.newPage();
  await next.goto(`${HUB_PORTAL}/login`);
  await expectSelectedRegion(next, "sgp");
});

test("a sign-in at the wrong region fails generically, hints at the region, and asks no other region", async ({
  hubUser,
  page,
}) => {
  const user = await hubUser("sgp");
  const hosts = recordRegionalAPIHosts(page);
  await page.goto(`${HUB_PORTAL}/login`);
  await chooseRegion(page, "deu");
  await signIn(page, user, user.password);

  const alert = page.getByRole("alert");
  await expect(alert).toContainText(
    "The email address or password is incorrect.",
  );
  await expect(page.getByText(wrongRegionHint)).toBeVisible();
  await expect(page).toHaveURL(`${HUB_PORTAL}/login`);
  expect(hosts.length).toBeGreaterThan(0);
  expect(new Set(hosts)).toEqual(new Set(["deu.api.vetchium.localhost"]));

  // Changing the region clears the stale failure before the next attempt.
  await chooseRegion(page, "sgp");
  await expect(page.getByText(wrongRegionHint)).toHaveCount(0);

  // A wrong password at the right region reads exactly the same.
  await signIn(page, user, `Wrong!${user.password}`);
  await expect(alert).toContainText(
    "The email address or password is incorrect.",
  );
  await expect(page.getByText(wrongRegionHint)).toBeVisible();

  await signIn(page, user, user.password);
  await expect(
    page.getByRole("heading", { name: `Welcome back, ${user.displayName}` }),
  ).toBeVisible();
});
