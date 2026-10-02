import {
  loginOrg,
  OrgsAPI,
  orgEmailText,
  orgPassword,
  orgsIdempotencyKey,
} from "../lib/orgs-api.ts";
import { emailedLinkToken, ORGS_PORTAL } from "../lib/portals.ts";
import {
  cleanupPasswordResetLedger,
  expect,
  expectSelectedRegion,
  recordRegionalAPIHosts,
  test,
} from "../lib/region-ui.ts";

const token = "a".repeat(64);

const invalidLinks = [
  { name: "no region", query: `token=${token}` },
  { name: "an upper-case region", query: `region=SGP&token=${token}` },
  { name: "an unknown region", query: `region=nowhere&token=${token}` },
  {
    name: "a duplicated region",
    query: `region=sgp&region=sgp&token=${token}`,
  },
  { name: "no token", query: "region=sgp" },
];

for (const { path, message } of [
  {
    path: "/reset-password",
    message: "This password reset link is incomplete.",
  },
  { path: "/complete-signup", message: "This signup link is incomplete." },
]) {
  for (const link of invalidLinks) {
    test(`an Orgs ${path} link with ${link.name} is shown as incomplete`, async ({
      page,
    }) => {
      const hosts = recordRegionalAPIHosts(page);
      await page.goto(`${ORGS_PORTAL}${path}?${link.query}`);
      await expect(page.getByRole("alert")).toContainText(message);
      await expect(page.getByLabel("New password")).toHaveCount(0);
      expect(hosts).toEqual([]);
    });
  }
}

test("an emailed Orgs reset link resets the password at the region it names", async ({
  context,
  org,
  page,
  request,
}) => {
  const signedUp = await org("sgp");
  const api = new OrgsAPI(request, "sgp");
  const requested = await api.post(
    "/request-password-reset",
    { domain: signedUp.domain, email_address: signedUp.emailAddress },
    { idempotencyKey: orgsIdempotencyKey() },
  );
  expect(requested.status(), await requested.text()).toBe(202);
  const email = await orgEmailText(request, signedUp.emailAddress, "Reset");
  const resetToken = emailedLinkToken(email, "/reset-password", "sgp");
  if (resetToken === undefined) throw new Error("no sgp reset link");
  expect(email).toContain(
    `${ORGS_PORTAL}/reset-password?region=sgp&token=${resetToken}`,
  );

  const hosts = recordRegionalAPIHosts(page);
  const password = orgPassword();
  try {
    await page.goto(
      `${ORGS_PORTAL}/reset-password?region=sgp&token=${resetToken}`,
    );
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByTestId("reset-password-done")).toBeVisible();
    expect(new Set(hosts)).toEqual(new Set(["sgp.api.vetchium.localhost"]));
    await loginOrg(api, { ...signedUp, password });

    const next = await context.newPage();
    await next.goto(`${ORGS_PORTAL}/login`);
    await expectSelectedRegion(next, "sgp");
  } finally {
    cleanupPasswordResetLedger("orgs", "sgp", resetToken);
  }
});
