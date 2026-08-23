import type { Page } from "@playwright/test";
import {
  expect,
  SEEDED_ADMIN_EMAIL,
  SEEDED_ADMIN_PASSWORD,
  test,
} from "../lib/admin-fixtures.ts";

async function signIn(
  page: Page,
  emailAddress: string,
  password: string,
  returnTo = "/hub-signup-domains",
  expectedPath = returnTo,
): Promise<void> {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByRole("textbox", { name: "Email address" }).fill(emailAddress);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(
    new RegExp(`${expectedPath.replaceAll("/", "\\/")}$`),
  );
}

test("a domain manager can add, search, edit, disable with a comment, and reactivate entries", async ({
  ownedDomain,
  page,
}) => {
  const original = ownedDomain("ui-crud");
  const replacement = ownedDomain("ui-replacement");
  await signIn(page, SEEDED_ADMIN_EMAIL, SEEDED_ADMIN_PASSWORD);
  await expect(
    page.getByRole("heading", { name: "Hub signup domains" }),
  ).toBeVisible();
  await expect(
    page.getByText("This controls future signups only"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add domain" }).click();
  let editor = page.getByRole("dialog", {
    name: "Add a Hub signup domain",
  });
  await editor.getByLabel("Domain").fill("*.example.com");
  await editor.getByRole("button", { name: "Add domain" }).click();
  await expect(
    editor.getByText(/Enter an exact domain such as example.com/),
  ).toBeVisible();
  await editor.getByRole("button", { name: "Cancel" }).click();
  await expect(editor).not.toBeVisible();

  await page.getByRole("button", { name: "Add domain" }).click();
  editor = page.getByRole("dialog", { name: "Add a Hub signup domain" });
  await editor.getByLabel("Domain").fill(` ${original.toUpperCase()}. `);
  await editor.getByRole("button", { name: "Add domain" }).click();
  await expect(page.getByText("Hub signup domain added.")).toBeVisible();
  await expect(editor).not.toBeVisible();
  let row = page.getByRole("row").filter({ hasText: original });
  await expect(row).toBeVisible();
  await expect(row.getByText("Active", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add domain" }).click();
  editor = page.getByRole("dialog", { name: "Add a Hub signup domain" });
  await editor.getByLabel("Domain").fill(original);
  await editor.getByRole("button", { name: "Add domain" }).click();
  await expect(
    page.getByText("That domain is already in this tenant's allowlist."),
  ).toBeVisible();
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Cancel" }).click();

  await row.getByRole("button", { name: `Edit ${original}` }).click();
  editor = page.getByRole("dialog", { name: "Edit Hub signup domain" });
  await editor.getByLabel("Domain").fill(replacement.toUpperCase());
  await editor.getByRole("combobox", { name: "State" }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("Disabled", { exact: true })
    .click();
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(editor.getByText("This field is required.")).toBeVisible();
  await editor
    .getByLabel("Disable comment")
    .fill("Corporate domain ownership is under review");
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Hub signup domain updated.").last(),
  ).toBeVisible();
  row = page.getByRole("row").filter({ hasText: replacement });
  await expect(row).toBeVisible();
  await expect(row.getByText("Disabled", { exact: true })).toBeVisible();
  await expect(
    row.getByText("Corporate domain ownership is under review"),
  ).toBeVisible();
  await expect(
    row.getByRole("button", { name: `Remove ${replacement}` }),
  ).toHaveCount(0);

  const search = page.getByRole("searchbox", { name: "Search domains" });
  await search.fill("no-domain-can-match-this");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(
    page.getByText("No Hub signup domains match these filters."),
  ).toBeVisible();
  await search.fill(replacement);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: `Edit ${replacement}` }).click();
  editor = page.getByRole("dialog", { name: "Edit Hub signup domain" });
  await editor.getByRole("combobox", { name: "State" }).click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("Active", { exact: true })
    .click();
  await expect(editor.getByLabel("Disable comment")).toHaveCount(0);
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Hub signup domain updated.").last(),
  ).toBeVisible();
  await expect(row.getByText("Active", { exact: true })).toBeVisible();
  await expect(
    row.getByText("Corporate domain ownership is under review"),
  ).toHaveCount(0);
});

test("view-only and unassigned administrators see the correct route boundary", async ({
  adminAPI,
  createAdmin,
  managerToken,
  page,
}) => {
  const viewer = await createAdmin();
  expect(
    (
      await adminAPI.post(
        "/set-user-permissions",
        {
          admin_user_id: viewer.adminUserID,
          permissions: ["admin:view_hub_signup_domains"],
        },
        { token: managerToken },
      )
    ).status(),
  ).toBe(204);
  await signIn(page, viewer.emailAddress, viewer.password);
  await expect(
    page.getByRole("heading", { name: "Hub signup domains" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add domain" })).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  const unassigned = await createAdmin();
  await page.goto("/login");
  await signIn(
    page,
    unassigned.emailAddress,
    unassigned.password,
    "/hub-signup-domains",
    "/",
  );
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("menuitem", { name: "Hub signup domains" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Hub signup domains" }),
  ).toHaveCount(0);
});

test("the page presents a recoverable list failure", async ({ page }) => {
  await page.route("**/api/admin/list-hub-signup-domains", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "vetchium-problem-details/internal-server-error",
        title: "Internal server error",
        status: 500,
        detail: "The server could not complete the request",
      }),
    });
  });
  await signIn(page, SEEDED_ADMIN_EMAIL, SEEDED_ADMIN_PASSWORD);
  await expect(
    page.getByText("We could not load this information."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
