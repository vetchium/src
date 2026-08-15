import type { MyInfoResponse } from "typespec/admin/users/profile";
import { responseJSON } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";

test("public theme and language choices survive a reload", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Switch light or dark mode" }).click();
  await page.getByRole("button", { name: "Select language" }).click();
  await page.getByRole("menuitem", { name: "தமிழ்" }).click();

  await expect(page.getByRole("heading", { name: "உள்நுழை" })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "மொழியைத் தேர்ந்தெடுக்கவும்" }),
  ).toContainText("தமிழ்");
  await expect(
    page.getByRole("button", {
      name: "ஒளி அல்லது இருள் பயன்முறைக்கு மாற்று",
    }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("login replaces the local language and authenticated changes reach the server", async ({
  adminAPI,
  createAdmin,
  page,
}) => {
  const admin = await createAdmin();
  await page.goto("/login");
  await page.getByRole("button", { name: "Select language" }).click();
  await page.getByRole("menuitem", { name: "தமிழ்" }).click();
  await page
    .getByRole("textbox", { name: "மின்னஞ்சல் முகவரி" })
    .fill(admin.emailAddress);
  await page.getByLabel("கடவுச்சொல்", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "உள்நுழை" }).click();

  await expect(page).toHaveURL(/\/$/);
  const languageButton = page.getByRole("button", { name: "Select language" });
  await expect(languageButton).toContainText("English US");
  await languageButton.click();
  await page.getByRole("menuitem", { name: "Deutsch" }).click();
  await expect(
    page.getByRole("heading", { name: /^Willkommen,/ }),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const response = await adminAPI.get("/my-info", admin.sessionToken);
      return (await responseJSON<MyInfoResponse>(response)).preferred_language;
    })
    .toBe("de_DE");

  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sprache auswählen" }),
  ).toContainText("Deutsch");
});
