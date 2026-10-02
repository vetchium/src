import { expect, type Page, test } from "@playwright/test";
import {
  DomainAlreadyOwnedError,
  InvalidSignupTokenError,
} from "typespec/problem/orgs/signup";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgEmailText,
  orgPassword,
  signupOrg,
} from "../lib/orgs-api.ts";
import {
  emailedLinkToken,
  ORGS_PORTAL,
  rememberRegion,
} from "../lib/portals.ts";
import { cleanupPasswordResetLedger } from "../lib/region-ui.ts";

const token = "a".repeat(64);
const domain = "mocked.example";

async function openCompletion(page: Page) {
  await page.route("**/api/orgs/get-signup-details", (route) =>
    route.fulfill({
      json: {
        domain,
        dns_record_name: `_vetchium.${domain}`,
        dns_record_value: "vetchium-verify=aaaaaaaaaaaaaaaaaaaaaaaaaa",
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
    }),
  );
  await page.goto(`${ORGS_PORTAL}/complete-signup?region=sgp&token=${token}`);
  const password = orgPassword();
  await page.getByLabel("Organization name").fill("Mocked Org");
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Confirm password").fill(password);
  return page.getByRole("button", {
    name: "Verify domain and create organization",
  });
}

test("a pending completion is retried with the same key until created", async ({
  page,
}) => {
  const keys: string[] = [];
  await page.route("**/api/orgs/complete-signup", async (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    if (keys.length === 1) {
      await route.fulfill({
        status: 202,
        json: { operation_id: "0199c1c2-0000-7000-8000-000000000001" },
      });
      return;
    }
    await route.fulfill({ status: 201, json: { domain } });
  });
  const submit = await openCompletion(page);
  await submit.click();
  await expect(page).toHaveURL(`${ORGS_PORTAL}/login?domain=${domain}`, {
    timeout: 15_000,
  });
  expect(keys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(keys).size).toBe(1);
});

for (const refusal of [
  { name: "an owned domain", status: 409, problem: DomainAlreadyOwnedError },
  { name: "an invalid link", status: 401, problem: InvalidSignupTokenError },
]) {
  test(`completion refused for ${refusal.name} offers a new signup`, async ({
    page,
  }) => {
    await page.route("**/api/orgs/complete-signup", (route) =>
      route.fulfill({
        status: refusal.status,
        contentType: "application/problem+json",
        headers:
          refusal.status === 401
            ? { "WWW-Authenticate": 'VetchiumSignup realm="orgs"' }
            : {},
        json: refusal.problem,
      }),
    );
    const submit = await openCompletion(page);
    await submit.click();
    await expect(
      page.getByRole("link", { name: "Request a new signup link" }),
    ).toBeVisible();
    await expect(submit).toBeHidden();
  });
}

test("an incomplete signup link explains itself", async ({ page }) => {
  await page.goto(`${ORGS_PORTAL}/complete-signup`);
  await expect(
    page.getByText("This signup link is incomplete", { exact: false }),
  ).toBeVisible();
});

test("a forgotten password is reset from the emailed link", async ({
  context,
  page,
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  let resetToken: string | undefined;
  try {
    await rememberRegion(context, "orgs", api.tenant);
    await page.goto(`${ORGS_PORTAL}/forgot-password?domain=${org.domain}`);
    await page.getByLabel("Email address").fill(org.emailAddress);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByTestId("forgot-password-sent")).toBeVisible();

    const email = await orgEmailText(request, org.emailAddress, "Reset");
    resetToken = emailedLinkToken(email, "/reset-password", api.tenant);
    expect(resetToken).toBeDefined();
    const resetLink = `${ORGS_PORTAL}/reset-password?region=${api.tenant}&token=${resetToken}`;
    expect(email).toContain(resetLink);
    const newPassword = orgPassword();
    await page.goto(resetLink);
    await page.getByLabel("New password").fill(newPassword);
    await page.getByLabel("Confirm password").fill(newPassword);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByTestId("reset-password-done")).toBeVisible();
    await loginOrg(api, { ...org, password: newPassword });

    // The link is spent now.
    await page.goto(resetLink);
    const another = orgPassword();
    await page.getByLabel("New password").fill(another);
    await page.getByLabel("Confirm password").fill(another);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(
      page.getByRole("link", { name: "Request a new reset link" }),
    ).toBeVisible();
  } finally {
    // The browser's idempotency keys are not test-prefixed, so its ledger
    // rows are found by the reset token instead.
    if (resetToken !== undefined) {
      cleanupPasswordResetLedger("orgs", api.tenant, resetToken);
    }
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("a wrong password is refused without leaving the sign-in page", async ({
  context,
  page,
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    await rememberRegion(context, "orgs", api.tenant);
    await page.goto(`${ORGS_PORTAL}/login?domain=${org.domain}`);
    await page.getByLabel("Email address").fill(org.emailAddress);
    await page.getByLabel("Password", { exact: true }).fill(orgPassword());
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/login?domain=${org.domain}`);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
