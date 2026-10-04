import type { Page } from "@playwright/test";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import { makePNG } from "../lib/logo-fixtures.ts";
import {
  addOrgMember,
  cleanupOrg,
  inviteeAddress,
  loginOrg,
  OrgsAPI,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";
import { ORGS_PORTAL } from "../lib/portals.ts";
import { chooseRegion } from "../lib/region-ui.ts";

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

test("a Free Org is offered an upgrade; a Silver Org uploads and removes its logo", async ({
  page,
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    await signIn(page, org);
    await page.goto(`${ORGS_PORTAL}/settings`);
    await expect(
      page.getByRole("heading", { name: "Company", level: 1 }),
    ).toBeVisible();
    await expect(page.getByTestId("logo-none")).toBeVisible();
    await expect(page.getByTestId("logo-upgrade")).toContainText(
      "Silver plan or higher",
    );
    await expect(
      page.getByRole("button", { name: "Upload logo" }),
    ).toBeDisabled();

    expect(
      (
        await api.setSubscriptionPlan(owner, {
          plan_oid: "org-silver-tier",
          billing_interval: "month",
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    await expect(page.getByTestId("logo-upgrade")).toHaveCount(0);

    // An unusable image is refused with a clear message.
    await page.locator('input[type="file"]').setInputFiles({
      name: "small.png",
      mimeType: "image/png",
      buffer: makePNG(64, 64),
    });
    await expect(page.getByText("That image cannot be used.")).toBeVisible();
    await expect(page.getByTestId("logo-none")).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: makePNG(200, 200),
    });
    await expect(page.getByTestId("logo-image")).toBeVisible();
    // The logo also appears in the shell, loaded from the media origin.
    await expect(page.getByTestId("shell-org-logo")).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByTestId("shell-org-logo")
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(200);

    await page.getByRole("button", { name: "Remove logo" }).click();
    await expect(page.getByTestId("logo-none")).toBeVisible();
    await expect(page.getByTestId("shell-org-logo")).toHaveCount(0);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("only a superadmin reaches the settings page", async ({
  page,
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const member = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain),
      ["org:manage_users"],
    );
    await signIn(page, member);
    await expect(
      page.getByRole("menuitem", { name: /Organization settings/ }),
    ).toHaveCount(0);
    await page.goto(`${ORGS_PORTAL}/settings`);
    await expect(page).toHaveURL(`${ORGS_PORTAL}/`);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("company name, account privacy and old routes work together", async ({
  page,
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    await signIn(page, org);
    await expect(page.getByText(org.emailAddress, { exact: true })).toHaveCount(
      0,
    );
    await page.goto(`${ORGS_PORTAL}/settings`);
    await expect(page).toHaveURL(`${ORGS_PORTAL}/company`);
    await page
      .getByLabel("Company name", { exact: true })
      .fill("Updated Company");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("shell-org-name")).toHaveText(
      "Updated Company",
    );
    await page.reload();
    await expect(page.getByLabel("Company name", { exact: true })).toHaveValue(
      "Updated Company",
    );
    await page.getByLabel("Company name", { exact: true }).fill(" ");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Enter a name of 1 to 200 characters."),
    ).toBeVisible();
    await page.goto(`${ORGS_PORTAL}/security`);
    await expect(page).toHaveURL(`${ORGS_PORTAL}/account`);
    await expect(
      page.getByText(org.emailAddress, { exact: true }),
    ).toBeVisible();
    await page.goto(`${ORGS_PORTAL}/organization-security`);
    await expect(page.getByText(org.emailAddress, { exact: true })).toHaveCount(
      0,
    );
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByTestId("google-switch")).toBeVisible();
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
