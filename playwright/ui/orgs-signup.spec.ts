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
  recordValue,
  requestOrgSignup,
  type SignedUpOrg,
  signupOrg,
  signupToken,
} from "../lib/orgs-api.ts";
import { ORGS_PORTAL, rememberRegion } from "../lib/portals.ts";
import { chooseRegion } from "../lib/region-ui.ts";
import { uniqueTestID } from "../lib/test-id.ts";

// Lifecycle tests wait for the CI re-verification timings (2s checks, 8s
// grace), which is longer than the default budget.
test.describe.configure({ timeout: 90_000 });

/** Signs in using an explicit region choice. */
async function signIn(
  page: Page,
  org: SignedUpOrg,
  region: "sgp" | "usa1" = "sgp",
) {
  await page.goto(`${ORGS_PORTAL}/login?domain=${org.domain}`);
  await expect(page.getByLabel("Organization domain")).toHaveValue(org.domain);
  await page.getByLabel("Email address").fill(org.emailAddress);
  await page.getByLabel("Password", { exact: true }).fill(org.password);
  await chooseRegion(page, region);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("signs a .test Org up through region choice, DNS proof and sign-in", async ({
  context,
  page,
  request,
}) => {
  const domain = uniqueOrgDomain("test");
  const emailAddress = `it@${domain}`;
  try {
    await rememberRegion(context, "orgs", "sgp");
    await page.goto(`${ORGS_PORTAL}/signup`);
    const country = page.getByRole("combobox", { name: "Country" });
    await country.click();
    await country.fill("Singapore");
    await country.press("Enter");
    await expect(page.getByText("Singapore (sgp), recommended")).toBeVisible();
    await page
      .getByRole("button", { name: /Continue in Singapore \(sgp\)/ })
      .click();
    await expect(page).toHaveURL(
      `${ORGS_PORTAL}/signup/SG/en-US/details?region=sgp`,
    );
    await expect(page.getByTestId("signup-region")).toContainText("sgp");

    // The steps explain the DNS proof before anything is sent.
    await expect(page.getByTestId("signup-steps")).toContainText(
      "Publish the TXT record",
    );
    const localPart = page.getByLabel("Your email address");
    await expect(localPart).toBeDisabled();
    await page.getByLabel("Organization domain").fill(domain.toUpperCase());
    await expect(page.getByTestId("signup-email-domain")).toHaveText(
      `@${domain}`,
    );
    await expect(page.getByTestId("signup-steps")).toContainText(domain);
    await localPart.fill("it");
    await page.getByRole("button", { name: "Send signup emails" }).click();
    const sent = page.getByTestId("signup-sent");
    await expect(sent).toContainText(emailAddress);
    await expect(sent.getByRole("button")).toHaveCount(0);

    const value = recordValue(
      await orgEmailText(request, emailAddress, "DNS record"),
    );
    const linkEmail = await orgEmailText(request, emailAddress, "Complete");
    const signupLink = `${ORGS_PORTAL}/complete-signup?region=sgp&token=${signupToken(linkEmail, "sgp")}`;
    expect(linkEmail).toContain(signupLink);
    await page.goto(signupLink);
    await expect(page.getByTestId("dns-record-name")).toHaveText(
      `_vetchium.${domain}`,
    );
    await expect(page.getByTestId("dns-record-value")).toHaveText(value);

    // The browser's lookup only advises; submitting stays possible.
    const recordCheck = page.getByTestId("signup-record-check");
    await expect(recordCheck).toHaveAttribute("data-result", "absent");
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
    await recordCheck.getByRole("button", { name: "Check again" }).click();
    await expect(recordCheck).toHaveAttribute("data-result", "present");
    await submit.click();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/login?domain=${domain}`);

    await signIn(page, { domain, emailAddress, password, value });
    await expect(page).toHaveURL(`${ORGS_PORTAL}/`);
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

test("the signup form validates the domain and the address's local part", async ({
  page,
}) => {
  await page.goto(`${ORGS_PORTAL}/signup/SG/en-US/details?region=sgp`);
  const domain = page.getByLabel("Organization domain");
  const localPart = page.getByLabel("Your email address");
  const send = page.getByRole("button", { name: "Send signup emails" });

  await send.click();
  await expect(page.getByText("This field is required.").first()).toBeVisible();

  await domain.fill("https://www.example.com");
  await expect(
    page.getByText("Enter a domain such as example.com", { exact: false }),
  ).toBeVisible();
  await expect(localPart).toBeDisabled();

  await domain.fill(uniqueOrgDomain());
  await expect(localPart).toBeEnabled();
  await localPart.fill("it@elsewhere.example");
  await expect(
    page.getByText("Enter only the part before the @."),
  ).toBeVisible();
  await localPart.fill("it..ops");
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await localPart.fill("it");
  await expect(page.getByText("Enter a valid email address.")).toBeHidden();
});

test("the signup form shows a domain the region refuses", async ({ page }) => {
  await page.goto(`${ORGS_PORTAL}/signup/SG/en-US/details?region=sgp`);
  await page.getByLabel("Organization domain").fill("gmail.com");
  await page.getByLabel("Your email address").fill(uniqueTestID("it"));
  await page.getByRole("button", { name: "Send signup emails" }).click();
  await expect(
    page.getByText("This domain cannot sign an organization up", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("signup-sent")).toHaveCount(0);
});

test("the completion page still submits when the browser cannot check DNS", async ({
  page,
  request,
}) => {
  const domain = uniqueOrgDomain();
  try {
    const { token, value } = await requestOrgSignup(
      new OrgsAPI(request),
      domain,
    );
    await page.route("http://doh.vetchium.localhost/**", (route) =>
      route.fulfill({ status: 502 }),
    );
    await page.goto(`${ORGS_PORTAL}/complete-signup?region=sgp&token=${token}`);
    await expect(page.getByTestId("signup-record-check")).toHaveAttribute(
      "data-result",
      "inconclusive",
    );

    await setOrgVerificationRecord(domain, [value]);
    const password = orgPassword();
    await page.getByLabel("Organization name").fill("Unchecked Org");
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page
      .getByRole("button", { name: "Verify domain and create organization" })
      .click();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/login?domain=${domain}`);
  } finally {
    await deleteOrgVerificationRecord(domain);
    cleanupOrg(domain);
  }
});

test("requires the user to correct a wrong sign-in region", async ({
  context,
  page,
  request,
}) => {
  const org = await signupOrg(new OrgsAPI(request, "sgp"));
  try {
    await rememberRegion(context, "orgs", "usa1");
    await signIn(page, org, "usa1");
    await expect(page.getByRole("alert")).toContainText(
      "the selected region is wrong",
    );
    await chooseRegion(page, "sgp");
    await expect(page).toHaveURL(`${ORGS_PORTAL}/login?domain=${org.domain}`);
    await expect(page.getByLabel("Organization domain")).toHaveValue(
      org.domain,
    );
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/`);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("a failing domain shows the record and recovers with check-now", async ({
  context,
  page,
  request,
}) => {
  const org = await signupOrg(new OrgsAPI(request));
  try {
    await rememberRegion(context, "orgs", "sgp");
    await signIn(page, org);
    await expect(page).toHaveURL(`${ORGS_PORTAL}/`);
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
  context,
  page,
  request,
}) => {
  const org = await signupOrg(new OrgsAPI(request));
  try {
    await rememberRegion(context, "orgs", "sgp");
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
    await expect(page).toHaveURL(`${ORGS_PORTAL}/restore-domain`);
    await expect(page.getByTestId("restore-domain")).toContainText(org.value);
    await page.goto(`${ORGS_PORTAL}/`);
    await expect(page).toHaveURL(`${ORGS_PORTAL}/restore-domain`);

    await setOrgVerificationRecord(org.domain, [org.value]);
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/`);
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
  context,
  page,
  request,
}) => {
  const org = await signupOrg(new OrgsAPI(request));
  try {
    await rememberRegion(context, "orgs", "sgp");
    await signIn(page, org);
    await expect(page).toHaveURL(`${ORGS_PORTAL}/`);
    await page.goto(`${ORGS_PORTAL}/security`);
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
    await page.goto(`${ORGS_PORTAL}/`);
    await page.reload();
    await page.goto(`${ORGS_PORTAL}/security`);
    await expect(page).toHaveURL(/\/reauthenticate\?returnTo=/);
    await page.getByLabel("Password").fill(org.password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(`${ORGS_PORTAL}/account`);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
