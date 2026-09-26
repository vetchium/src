import { expect, test } from "@playwright/test";

const orgsBaseURL =
  process.env.PLAYWRIGHT_ORGS_BASE_URL ?? "http://orgs-ui.sgp.localhost";

test("the home page names the portal under one level-1 heading", async ({
  page,
}) => {
  await page.goto(orgsBaseURL);

  const headings = page.getByRole("heading", { level: 1 });
  await expect(headings).toHaveCount(1);
  await expect(headings).toHaveText("Vetchium for organizations");
  await expect(page).toHaveTitle("Vetchium for organizations");
  await expect(
    page.getByRole("button", { name: "Vetchium for organizations home" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
});

test("an unknown route offers a way back home", async ({ page }) => {
  await page.goto(`${orgsBaseURL}/no-such-page`);

  await expect(page.getByText("Page not found")).toBeVisible();
  await page.getByRole("link", { name: "Go to home" }).click();

  await expect(page).toHaveURL(`${orgsBaseURL}/`);
  await expect(
    page.getByRole("heading", { name: "Vetchium for organizations" }),
  ).toBeVisible();
});

test("language and theme choices survive a reload", async ({ page }) => {
  await page.goto(orgsBaseURL);
  await page.getByRole("switch", { name: "Switch light or dark mode" }).click();
  await page.getByRole("combobox", { name: "Select language" }).click();
  await page.getByRole("option", { name: "Deutsch (Deutschland)" }).click();

  await expect(
    page.getByRole("heading", { name: "Vetchium für Organisationen" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");

  await page.reload();

  await expect(
    page.getByRole("heading", { name: "Vetchium für Organisationen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", {
      name: "Zwischen hellem und dunklem Modus wechseln",
    }),
  ).toBeChecked();
});

test("the header fits a 320px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(orgsBaseURL);

  await expect(
    page.getByRole("combobox", { name: "Select language" }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Switch light or dark mode" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
