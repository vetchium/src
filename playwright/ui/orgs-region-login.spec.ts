import { ORGS_PORTAL } from "../lib/portals.ts";
import {
  chooseRegion,
  expect,
  expectSelectedRegion,
  recordRegionalAPIHosts,
  test,
} from "../lib/region-ui.ts";

test("an Org sign-in fails identically for wrong region and password and needs an explicit correction", async ({
  context,
  org,
  page,
}) => {
  const signedUp = await org("sgp");
  const hosts = recordRegionalAPIHosts(page);
  await page.goto(`${ORGS_PORTAL}/login`);
  await chooseRegion(page, "usa1");
  await page.getByLabel("Organization domain").fill(signedUp.domain);
  await page.getByLabel("Email address").fill(signedUp.emailAddress);
  await page.getByLabel("Password", { exact: true }).fill(signedUp.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const alert = page.getByRole("alert");
  const failure =
    "The organization domain, email address, or password is incorrect, or the selected region is wrong.";
  await expect(alert).toContainText(failure);
  await expectSelectedRegion(page, "usa1");
  expect(new Set(hosts)).toEqual(new Set(["usa1.api.vetchium.localhost"]));
  await expect(
    page.getByRole("button", { name: "Continue to that region" }),
  ).toHaveCount(0);
  await chooseRegion(page, "sgp");
  await expect(alert).toHaveCount(0);
  await expect(page.getByLabel("Organization domain")).toHaveValue(
    signedUp.domain,
  );
  await expect(page.getByLabel("Email address")).toHaveValue(
    signedUp.emailAddress,
  );
  await page
    .getByLabel("Password", { exact: true })
    .fill(`Wrong-${signedUp.password}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(alert).toContainText(failure);
  hosts.length = 0;
  await page.getByLabel("Password", { exact: true }).fill(signedUp.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${ORGS_PORTAL}/`);
  await expect(page.getByTestId("home-domain")).toContainText(signedUp.domain);
  expect(new Set(hosts)).toEqual(new Set(["sgp.api.vetchium.localhost"]));
  const next = await context.newPage();
  await next.goto(`${ORGS_PORTAL}/login`);
  await expect(next.getByRole("button", { name: "Sign in" })).toBeDisabled();
});
