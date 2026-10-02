import { randomBytes } from "node:crypto";
import type { Page, Request } from "@playwright/test";
import { HubAPI } from "../lib/hub-api.ts";
import { HUB_PORTAL, rememberRegion } from "../lib/portals.ts";
import {
  chooseRegion,
  cleanupBrowserIdempotency,
  cleanupPasswordResetLedger,
  expect,
  type HubTestUser,
  test,
} from "../lib/region-ui.ts";

// A session token belongs to the region that issued it. Requests a signed-out
// flow sends to another region, chosen on a page or named by a link, must not
// carry it, even when the browser holds a session.

async function signInAtSgp(page: Page, user: HubTestUser): Promise<void> {
  await page.goto(`${HUB_PORTAL}/login`);
  await chooseRegion(page, "sgp");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

function recordRequests(page: Page, host: string): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).host === host) requests.push(request);
  });
  return requests;
}

async function expectSessionStillWorksAtSgp(
  page: Page,
  hubAPI: HubAPI,
): Promise<void> {
  const token = await page.evaluate(() => {
    const raw =
      sessionStorage.getItem("vetchium.hub.session") ??
      localStorage.getItem("vetchium.hub.session");
    return raw === null
      ? null
      : (JSON.parse(raw) as { session: { session_token: string } }).session
          .session_token;
  });
  expect(token).not.toBeNull();
  const info = await hubAPI.get("/my-info", token ?? "");
  expect(info.status(), await info.text()).toBe(200);
}

test("a signed-in user's token is not sent to the region a reset link names", async ({
  context,
  hubUser,
  page,
  request,
}) => {
  const user = await hubUser("sgp");
  const resetToken = randomBytes(32).toString("hex");
  await rememberRegion(context, "hub", "sgp");
  await signInAtSgp(page, user);

  const deu = recordRequests(page, "deu.api.vetchium.localhost");
  try {
    await page.goto(
      `${HUB_PORTAL}/reset-password?region=deu&token=${resetToken}`,
    );
    const password = `Reset!${randomBytes(8).toString("hex")}-password`;
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect.poll(() => deu.length).toBeGreaterThan(0);
    for (const sent of deu) {
      expect(await sent.headerValue("authorization")).toBeNull();
    }
    await expectSessionStillWorksAtSgp(page, new HubAPI(request, "sgp"));
  } finally {
    cleanupPasswordResetLedger("hub", "deu", resetToken);
  }
});

test("a signed-in user's token is not sent to the region chosen on forgot-password", async ({
  context,
  hubUser,
  page,
  request,
}) => {
  const user = await hubUser("sgp");
  await rememberRegion(context, "hub", "sgp");
  await signInAtSgp(page, user);

  const deu = recordRequests(page, "deu.api.vetchium.localhost");
  const sgp = recordRequests(page, "sgp.api.vetchium.localhost");
  const keys: string[] = [];
  try {
    await page.goto(`${HUB_PORTAL}/forgot-password`);
    await chooseRegion(page, "deu");
    await page.getByLabel("Email address").fill(user.email);
    await page.getByRole("button", { name: "Email a reset link" }).click();
    await expect(
      page.getByText("If an account exists for that address", {
        exact: false,
      }),
    ).toBeVisible();

    const resets = deu.filter((sent) =>
      sent.url().endsWith("/api/hub/request-password-reset"),
    );
    expect(resets).toHaveLength(1);
    for (const sent of resets) {
      expect(await sent.headerValue("authorization")).toBeNull();
      const key = await sent.headerValue("idempotency-key");
      if (key !== null) keys.push(key);
    }
    // The address typed on a page showing deu goes to deu only.
    expect(
      sgp.filter((sent) => sent.url().endsWith("/request-password-reset")),
    ).toEqual([]);
    await expectSessionStillWorksAtSgp(page, new HubAPI(request, "sgp"));
  } finally {
    cleanupBrowserIdempotency("deu", "hub:request-password-reset", keys);
  }
});
