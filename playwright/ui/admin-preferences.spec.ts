import type { MyInfoResponse } from "typespec/admin/users/profile";
import { responseJSON } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";

test("public theme and language choices survive a reload", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("switch", { name: "Switch light or dark mode" }).click();
  await page.getByRole("combobox", { name: "Select language" }).click();
  await page.getByRole("option", { name: "தமிழ்" }).click();

  await expect(page.getByRole("heading", { name: "உள்நுழை" })).toBeVisible();
  await page.reload();
  const tamilLanguageSelect = page.getByRole("combobox", {
    name: "மொழியைத் தேர்ந்தெடுக்கவும்",
  });
  await tamilLanguageSelect.click();
  await expect(page.getByRole("option", { name: "தமிழ்" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await tamilLanguageSelect.press("Escape");
  await expect(
    page.getByRole("switch", {
      name: "ஒளி அல்லது இருள் பயன்முறைக்கு மாற்று",
    }),
  ).toHaveAttribute("aria-checked", "true");
});

test("login replaces the local language and authenticated changes reach the server", async ({
  adminAPI,
  createAdmin,
  page,
}) => {
  const admin = await createAdmin();
  await page.goto("/login");
  await page.getByRole("combobox", { name: "Select language" }).click();
  await page.getByRole("option", { name: "தமிழ்" }).click();
  await page
    .getByRole("textbox", { name: "மின்னஞ்சல் முகவரி" })
    .fill(admin.emailAddress);
  await page.getByLabel("கடவுச்சொல்", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "உள்நுழை" }).click();

  await expect(page).toHaveURL(/\/$/);
  const languageSelect = page.getByRole("combobox", {
    name: "Select language",
  });
  await languageSelect.click();
  await expect(
    page.getByRole("option", { name: "English US" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("option", { name: "Deutsch" }).click();
  await expect(
    page.getByRole("heading", { name: /^Willkommen,/ }),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const response = await adminAPI.get("/my-info", admin.sessionToken);
      return (await responseJSON<MyInfoResponse>(response)).preferred_language;
    })
    .toBe("de-DE");

  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  await page.getByRole("combobox", { name: "Sprache auswählen" }).click();
  await expect(page.getByRole("option", { name: "Deutsch" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("permission tags use the authenticated user's language", async ({
  adminAPI,
  createAdmin,
  managerToken,
  page,
}) => {
  const admin = await createAdmin();
  const grant = await adminAPI.post(
    "/set-user-permissions",
    {
      admin_user_id: admin.adminUserID,
      permissions: ["admin:view_users"],
    },
    { token: managerToken },
  );
  expect(grant.status(), await grant.text()).toBe(204);

  await page.addInitScript((sessionToken) => {
    sessionStorage.setItem("vetchium.admin.session-token", sessionToken);
  }, admin.sessionToken);
  await page.goto("/");
  await expect(
    page.getByText("VIEW_ADMINISTRATORS", { exact: true }),
  ).toBeVisible();

  await page.getByRole("combobox", { name: "Select language" }).click();
  await page.getByRole("option", { name: "Deutsch" }).click();
  await expect(
    page.getByText("ADMINISTRATOREN_ANZEIGEN", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("VIEW_ADMINISTRATORS", { exact: true }),
  ).not.toBeVisible();
});

test("authenticated header remains usable on a 320px viewport", async ({
  createAdmin,
  page,
}) => {
  const admin = await createAdmin();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/login");
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill(admin.emailAddress);
  await page.getByLabel("Password", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/$/);
  const header = page.getByRole("banner");
  await expect(
    header.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
  await expect(
    header.getByRole("button", { name: "Vetchium admin home" }),
  ).toBeVisible();
  await expect(
    header.getByRole("combobox", { name: "Select language" }),
  ).toBeVisible();
  await expect(
    header.getByRole("switch", { name: "Switch light or dark mode" }),
  ).toBeVisible();
  await expect(header.getByRole("button", { name: "Sign out" })).toBeVisible();
  expect(
    await header.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);

  await header.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Overview" })).toBeVisible();
});
