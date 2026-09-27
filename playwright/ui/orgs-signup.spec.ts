import { expect, type Page, test } from "@playwright/test";
import {
  deleteOrgVerificationRecord,
  setOrgVerificationRecord,
  uniqueOrgDomain,
} from "../lib/dev-dns.ts";
import {
  cleanupOrg,
  OrgsAPI,
  orgEmailText,
  orgPassword,
  orgSQL,
  orgsOrigin,
  recordValue,
  type SignedUpOrg,
  signupOrg,
  signupToken,
} from "../lib/orgs-api.ts";

const sgp = orgsOrigin("sgp");

// Lifecycle tests wait for the CI re-verification timings (2s checks, 8s
// grace), which is longer than the default budget.
test.describe.configure({ timeout: 90_000 });

async function signIn(page: Page, org: SignedUpOrg, origin = sgp) {
  await page.goto(`${origin}/login?domain=${org.domain}`);
  await expect(page.getByLabel("Organization domain")).toHaveValue(org.domain);
  await page.getByLabel("Email address").fill(org.emailAddress);
  await page.getByLabel("Password", { exact: true }).fill(org.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("signs an Org up through region choice, DNS proof and sign-in", async ({
  page,
  request,
}) => {
  const domain = uniqueOrgDomain();
  const emailAddress = `it@${domain}`;
  try {
    await page.goto(`${sgp}/signup`);
    const country = page.getByRole("combobox", { name: "Country" });
    await country.click();
    await country.fill("Singapore");
    await country.press("Enter");
    await expect(page.getByText("Singapore (sgp), recommended")).toBeVisible();
    await page
      .getByRole("button", { name: /Continue in Singapore \(sgp\)/ })
      .click();
    await expect(page).toHaveURL(`${sgp}/signup/SG/en-US/details`);
    await expect(page.getByTestId("signup-region")).toContainText("sgp");

    await page.getByLabel("Work email address").fill(emailAddress);
    await expect(page.getByTestId("signup-domain")).toContainText(domain);
    await page.getByRole("button", { name: "Send signup emails" }).click();
    await expect(page.getByTestId("signup-sent")).toBeVisible();

    const value = recordValue(
      await orgEmailText(request, emailAddress, "DNS record"),
    );
    const token = signupToken(
      await orgEmailText(request, emailAddress, "Complete"),
    );
    await page.goto(`${sgp}/complete-signup?token=${token}`);
    await expect(page.getByTestId("dns-record-name")).toHaveText(
      `_vetchium.${domain}`,
    );
    await expect(page.getByTestId("dns-record-value")).toHaveText(value);

    const password = orgPassword();
    await page.getByLabel("Organization name").fill("Browser Org");
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Confirm password").fill(password);
    const submit = page.getByRole("button", {
      name: "Verify domain and create organization",
    });
    await submit.click();
    await expect(
      page.getByText("The TXT record is not visible yet", { exact: false }),
    ).toBeVisible();

    await setOrgVerificationRecord(domain, [value]);
    await submit.click();
    await expect(page).toHaveURL(`${sgp}/login?domain=${domain}`);

    await signIn(page, { domain, emailAddress, password, value });
    await expect(page).toHaveURL(`${sgp}/home`);
    await expect(page.getByTestId("shell-org-name")).toHaveText("Browser Org");
    await expect(page.getByTestId("home-domain")).toHaveText(domain);
    await expect(page.getByTestId("home-domain-state")).toHaveAttribute(
      "data-state",
      "verified",
    );
  } finally {
    await deleteOrgVerificationRecord(domain);
    cleanupOrg(domain);
  }
});

test("sends a sign-in at the wrong region to the Org's own region", async ({
  page,
  request,
}) => {
  const org = await signupOrg(new OrgsAPI(request, "sgp"));
  try {
    await signIn(page, org, orgsOrigin("usa1"));
    const notice = page.getByTestId("login-homed-elsewhere");
    await expect(notice).toBeVisible();
    await notice
      .getByRole("button", { name: "Continue to that region" })
      .click();
    await expect(page).toHaveURL(`${sgp}/login?domain=${org.domain}`);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("a failing domain shows the record and recovers with check-now", async ({
  page,
  request,
}) => {
  const org = await signupOrg(new OrgsAPI(request));
  try {
    await signIn(page, org);
    await expect(page).toHaveURL(`${sgp}/home`);
    await deleteOrgVerificationRecord(org.domain);
    const banner = page.getByTestId("domain-failing-banner");
    await expect(async () => {
      await page.reload();
      await expect(banner).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expect(banner).toContainText(org.value);

    await setOrgVerificationRecord(org.domain, [org.value]);
    await banner.getByRole("button", { name: "Check now" }).click();
    await expect(banner).toBeHidden();
    await expect(page.getByTestId("home-domain-state")).toHaveAttribute(
      "data-state",
      "verified",
    );
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("a suspended Org can only restore its domain", async ({
  page,
  request,
}) => {
  const org = await signupOrg(new OrgsAPI(request));
  try {
    await deleteOrgVerificationRecord(org.domain);
    await expect
      .poll(
        () =>
          orgSQL(
            `SELECT o.org_state FROM vetchium.orgs o
             JOIN vetchium.org_domains d USING (org_did)
             WHERE d.domain = '${org.domain}'`,
          ),
        { timeout: 45_000 },
      )
      .toBe("suspended");

    await signIn(page, org);
    await expect(page).toHaveURL(`${sgp}/restore-domain`);
    await expect(page.getByTestId("restore-domain")).toContainText(org.value);
    await page.goto(`${sgp}/home`);
    await expect(page).toHaveURL(`${sgp}/restore-domain`);

    await setOrgVerificationRecord(org.domain, [org.value]);
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(page).toHaveURL(`${sgp}/home`);
    await expect(page.getByTestId("home-domain-state")).toHaveAttribute(
      "data-state",
      "verified",
    );
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("the security page asks for the password when the session is old", async ({
  page,
  request,
}) => {
  const org = await signupOrg(new OrgsAPI(request));
  try {
    await signIn(page, org);
    await expect(page).toHaveURL(`${sgp}/home`);
    await page.goto(`${sgp}/security`);
    await expect(
      page.getByRole("button", { name: "Set up authenticator app" }),
    ).toBeVisible();

    orgSQL(
      `UPDATE vetchium.org_sessions
       SET created_at = now() - interval '10 minutes',
           authenticated_at = now() - interval '10 minutes'
       WHERE org_user_id IN (
         SELECT org_user_id FROM vetchium.org_users
         WHERE email_address = '${org.emailAddress}'
       )`,
    );
    await page.goto(`${sgp}/home`);
    await page.reload();
    await page.goto(`${sgp}/security`);
    await expect(page).toHaveURL(/\/reauthenticate\?returnTo=/);
    await page.getByLabel("Password").fill(org.password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(`${sgp}/security`);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
