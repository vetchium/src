import type { Page } from "@playwright/test";
import { ORGS_PORTAL } from "../lib/portals.ts";
import {
  chooseRegion,
  expect,
  expectSelectedRegion,
  type OrgTestOrg,
  recordRegionalAPIHosts,
  test,
} from "../lib/region-ui.ts";

const wrongRegionHint =
  "If the domain, email, and password are right, check that the selected region is the one where your organization signed up.";

async function fillCredentials(page: Page, org: OrgTestOrg, password: string) {
  await page.getByLabel("Organization domain").fill(org.domain);
  await page.getByLabel("Email address").fill(org.emailAddress);
  await page.getByLabel("Password", { exact: true }).fill(password);
}

test("a valid region link parameter pre-selects the Orgs sign-in region; an invalid one is ignored", async ({
  page,
}) => {
  await page.goto(`${ORGS_PORTAL}/login?region=deu`);
  await expectSelectedRegion(page, "deu");
  for (const query of [
    "region=SGP",
    "region=nowhere",
    "region=deu&region=deu",
  ]) {
    await page.goto(`${ORGS_PORTAL}/login?${query}`);
    await expectSelectedRegion(page, "usa1");
  }
});

test("an Org homed in another region switches the picker in place and then signs in", async ({
  context,
  org,
  page,
}) => {
  const signedUp = await org("sgp");
  const hosts = recordRegionalAPIHosts(page);
  await page.goto(`${ORGS_PORTAL}/login`);
  await chooseRegion(page, "usa1");
  await fillCredentials(page, signedUp, signedUp.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  const notice = page.getByTestId("login-homed-elsewhere");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(signedUp.domain);
  expect(new Set(hosts)).toEqual(new Set(["usa1.api.vetchium.localhost"]));

  await notice.getByRole("button", { name: "Continue to that region" }).click();
  await expect(notice).toHaveCount(0);
  await expectSelectedRegion(page, "sgp");
  await expect(page).toHaveURL(`${ORGS_PORTAL}/login`);
  await expect(page.getByLabel("Organization domain")).toHaveValue(
    signedUp.domain,
  );
  await expect(page.getByLabel("Email address")).toHaveValue(
    signedUp.emailAddress,
  );

  hosts.length = 0;
  await page.getByLabel("Password", { exact: true }).fill(signedUp.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${ORGS_PORTAL}/`);
  await expect(page.getByTestId("home-domain")).toContainText(signedUp.domain);
  expect(hosts.length).toBeGreaterThan(0);
  expect(new Set(hosts)).toEqual(new Set(["sgp.api.vetchium.localhost"]));

  const next = await context.newPage();
  await next.goto(`${ORGS_PORTAL}/login`);
  await expectSelectedRegion(next, "sgp");
});

test("a wrong Orgs password fails generically with the region hint", async ({
  org,
  page,
}) => {
  const signedUp = await org("sgp");
  await page.goto(`${ORGS_PORTAL}/login?region=sgp`);
  await fillCredentials(page, signedUp, `Wrong-${signedUp.password}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText(wrongRegionHint)).toBeVisible();
  await expect(page.getByTestId("login-homed-elsewhere")).toHaveCount(0);
  await expect(page).toHaveURL(`${ORGS_PORTAL}/login?region=sgp`);
});
