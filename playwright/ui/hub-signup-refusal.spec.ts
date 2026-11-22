import { expect, test } from "@playwright/test";
import { stubSignupDetails } from "../lib/hub-ui-stubs.ts";
import { HUB_PORTAL } from "../lib/portals.ts";

test("a signup completion policy refusal offers a new region choice", async ({
  page,
}) => {
  await stubSignupDetails(page);
  await page.route("**/api/hub/complete-signup", async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/problem+json",
      json: {
        type: "vetchium-problem-details/hub-signup-unavailable",
        title: "Hub signup unavailable",
        status: 403,
      },
    });
  });
  await page.goto(
    `${HUB_PORTAL}/complete-signup?region=sgp&token=${"a".repeat(64)}`,
  );
  await page
    .getByLabel("Password", { exact: true })
    .fill("A sufficiently long password!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByText(
      "This region is not accepting signup for your country. Choose another region.",
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Start signup again" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/signup`);
});
