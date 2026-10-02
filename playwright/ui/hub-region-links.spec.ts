import { randomUUID } from "node:crypto";
import { HubAPI, hubIdempotencyKey, MAILPIT_ORIGIN } from "../lib/hub-api.ts";
import { login } from "../lib/hub-signup.ts";
import { emailedLinkToken, HUB_PORTAL } from "../lib/portals.ts";
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
    message: "This password-reset link is incomplete.",
  },
  { path: "/complete-signup", message: "This signup link is incomplete." },
]) {
  for (const link of invalidLinks) {
    test(`a Hub ${path} link with ${link.name} is shown as incomplete`, async ({
      page,
    }) => {
      const hosts = recordRegionalAPIHosts(page);
      await page.goto(`${HUB_PORTAL}${path}?${link.query}`);
      await expect(page.getByRole("alert")).toContainText(message);
      await expect(page.getByLabel("New password")).toHaveCount(0);
      expect(hosts).toEqual([]);
    });
  }
}

test("an emailed Hub reset link resets the password at the region it names", async ({
  context,
  hubUser,
  page,
  request,
}) => {
  const user = await hubUser("sgp");
  const resetKey = hubIdempotencyKey();
  user.keys.push(resetKey);
  const requested = await new HubAPI(request, "sgp").post(
    "/request-password-reset",
    { email_address: user.email },
    { idempotencyKey: resetKey },
  );
  expect(requested.status(), await requested.text()).toBe(202);

  const mailbox = `${MAILPIT_ORIGIN}/view/latest.txt?query=${encodeURIComponent(
    `to:${user.email}`,
  )}`;
  let text = "";
  await expect
    .poll(
      async () => {
        const mail = await request.get(mailbox);
        text = mail.ok() ? await mail.text() : "";
        return emailedLinkToken(text, "/reset-password", "sgp") !== undefined;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const resetToken = emailedLinkToken(text, "/reset-password", "sgp");
  if (resetToken === undefined) throw new Error("no sgp reset link");
  expect(text).toContain(
    `${HUB_PORTAL}/reset-password?region=sgp&token=${resetToken}`,
  );

  const hosts = recordRegionalAPIHosts(page);
  const password = `Reset!${randomUUID()}-password`;
  try {
    await page.goto(
      `${HUB_PORTAL}/reset-password?region=sgp&token=${resetToken}`,
    );
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(
      page.getByText("Your password has been reset.", { exact: false }),
    ).toBeVisible();
    expect(new Set(hosts)).toEqual(new Set(["sgp.api.vetchium.localhost"]));
    await login(request, "sgp", user.email, password);

    // Completing the reset remembers the link's region for the next sign-in.
    const next = await context.newPage();
    await next.goto(`${HUB_PORTAL}/login`);
    await expectSelectedRegion(next, "sgp");
  } finally {
    cleanupPasswordResetLedger("hub", "sgp", resetToken);
  }
});
