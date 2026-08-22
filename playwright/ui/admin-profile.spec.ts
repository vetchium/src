import { randomUUID } from "node:crypto";
import type { MyInfoResponse } from "typespec/admin/users/profile";
import { idempotencyKey, responseJSON } from "../lib/admin-api.ts";
import { emailCredential } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";

test("account setup asks for one Unicode professional name", async ({
  adminAPI,
  managerToken,
  ownedEmail,
  page,
}) => {
  const emailAddress = ownedEmail();
  const invitation = await adminAPI.post(
    "/invite-user",
    { email_address: emailAddress, permissions: [] },
    { token: managerToken, idempotencyKey: idempotencyKey() },
  );
  expect(invitation.status(), await invitation.text()).toBe(201);
  const token = emailCredential(emailAddress, "invitation", "invitation_token");
  await page.goto(`/complete-setup?token=${encodeURIComponent(token)}`);

  await expect(
    page.getByRole("textbox", { name: "Language code" }),
  ).toHaveCount(0);
  await page.getByRole("textbox", { name: "Name" }).fill("நிர்வாகி");
  const password = `Vetchium!${randomUUID()}-password`;
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(
    page.getByText("Your administrator account is ready."),
  ).toBeVisible();
});

test("an administrator updates the name shown throughout the portal", async ({
  adminAPI,
  createAdmin,
  page,
}) => {
  const admin = await createAdmin({ displayName: "Original Name" });
  await page.addInitScript((sessionToken) => {
    sessionStorage.setItem("vetchium.admin.session-token", sessionToken);
  }, admin.sessionToken);
  await page.goto("/settings/profile");

  const name = page.getByRole("textbox", { name: "Name" });
  await expect(name).toHaveValue("Original Name");
  await expect(
    page.getByText(
      "Enter the name you use professionally. You can use any language or writing system.",
    ),
  ).toBeVisible();

  await name.fill("  நிர்வாகி  ");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile updated.")).toBeVisible();
  await expect(name).toHaveValue("நிர்வாகி");
  await expect
    .poll(async () => {
      const response = await adminAPI.get("/my-info", admin.sessionToken);
      return (await responseJSON<MyInfoResponse>(response)).display_name;
    })
    .toBe("நிர்வாகி");

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome, நிர்வாகி" }),
  ).toBeVisible();
});

test("the profile form rejects a blank name", async ({ createAdmin, page }) => {
  const admin = await createAdmin();
  await page.addInitScript((sessionToken) => {
    sessionStorage.setItem("vetchium.admin.session-token", sessionToken);
  }, admin.sessionToken);
  await page.goto("/settings/profile");

  await page.getByRole("textbox", { name: "Name" }).fill(" ");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Use a name between 1 and 200 characters."),
  ).toBeVisible();
});

test("the profile form reports a server failure", async ({
  createAdmin,
  page,
}) => {
  const admin = await createAdmin();
  await page.addInitScript((sessionToken) => {
    sessionStorage.setItem("vetchium.admin.session-token", sessionToken);
  }, admin.sessionToken);
  await page.route("**/api/admin/set-display-name", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "vetchium-problem-details/internal-server-error",
        title: "Internal server error",
        status: 500,
      }),
    });
  });
  await page.goto("/settings/profile");

  await page.getByRole("textbox", { name: "Name" }).fill("Updated Name");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText(
      "Your profile could not be updated. Check the values and try again.",
    ),
  ).toBeVisible();
});
