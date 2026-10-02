import type { Page } from "@playwright/test";
import { HUB_PORTAL } from "../lib/portals.ts";
import { chooseRegion, expect, test } from "../lib/region-ui.ts";

async function expectNotAvailable(page: Page, domain: string) {
  const main = page.getByRole("main");
  await expect(
    main.getByText("Organization pages are not available yet", { exact: true }),
  ).toBeVisible();
  await expect(main).toContainText(`Information about ${domain}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex",
  );
}

test("a signed-out visitor sees that Organization pages are not available yet", async ({
  page,
}) => {
  await page.goto(`${HUB_PORTAL}/org/example.com`);
  await expect(page).toHaveURL(`${HUB_PORTAL}/org/example.com`);
  await expectNotAvailable(page, "example.com");
});

test("a signed-in Hub user sees the same not-available Organization page", async ({
  hubUser,
  page,
}) => {
  const user = await hubUser("sgp");
  await page.goto(`${HUB_PORTAL}/login?region=sgp`);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await chooseRegion(page, "sgp");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: `Welcome back, ${user.displayName}` }),
  ).toBeVisible();

  await page.goto(`${HUB_PORTAL}/org/example.org`);
  await expect(page).toHaveURL(`${HUB_PORTAL}/org/example.org`);
  await expectNotAvailable(page, "example.org");
  // The page was shown to a live session, not a signed-out fallback.
  await page.goto(HUB_PORTAL);
  await expect(
    page.getByRole("heading", { name: `Welcome back, ${user.displayName}` }),
  ).toBeVisible();
});
