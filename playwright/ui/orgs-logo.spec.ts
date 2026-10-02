import { expect, type Page, test } from "@playwright/test";
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
  await expect(page.getByTestId("shell-user-email")).toHaveText(
    user.emailAddress,
  );
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
      page.getByRole("heading", { name: "Organization settings", level: 1 }),
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
      page.getByRole("link", { name: "Organization settings" }),
    ).toHaveCount(0);
    await page.goto(`${ORGS_PORTAL}/settings`);
    await expect(page).toHaveURL(`${ORGS_PORTAL}/`);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
