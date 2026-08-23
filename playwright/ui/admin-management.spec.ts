import type { Page } from "@playwright/test";
import type { ListUsersResponse } from "typespec/admin/users/management";
import { responseJSON } from "../lib/admin-api.ts";
import {
  ageSession,
  currentTOTP,
  ISOLATED_TENANT,
  isolatedTenantBaseURL,
  seededManagerGrants,
} from "../lib/admin-db.ts";
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
  returnTo = "/",
  twoFactorExpected = false,
): Promise<void> {
  await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByRole("textbox", { name: "Email address" }).fill(emailAddress);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(
    twoFactorExpected
      ? /\/login\/two-factor/
      : new RegExp(`${returnTo.replaceAll("/", "\\/")}$`),
  );
}

test("an authorized administrator can open the users deep link", async ({
  adminAPI,
  createAdmin,
  page,
  managerToken,
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

  await signIn(page, admin.emailAddress, admin.password, "/users");
  await expect(
    page.getByRole("heading", { name: "Administrators" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: admin.emailAddress }),
  ).toBeVisible();
});

test("a manager can find, secure, and manage administrators", async ({
  adminAPI,
  createAdmin,
  ownedEmail,
  page,
  managerToken,
}) => {
  const target = await createAdmin({ displayName: "UI managed administrator" });
  const invitationEmail = ownedEmail();
  await signIn(page, SEEDED_ADMIN_EMAIL, SEEDED_ADMIN_PASSWORD, "/users");

  await page
    .getByRole("searchbox", { name: "Search by name or email address" })
    .fill(target.emailAddress);
  await page.getByRole("button", { name: "Search" }).click();
  const targetRow = page
    .getByRole("row")
    .filter({ hasText: target.emailAddress });
  await expect(targetRow).toBeVisible();

  await targetRow
    .getByRole("button", { name: "Actions for UI managed administrator" })
    .click();
  await page.getByRole("menuitem", { name: "Manage access" }).click();
  const accessDialog = page.getByRole("dialog", { name: "Manage access" });
  const viewPermission = accessDialog.getByRole("switch", {
    name: "VIEW_ADMINISTRATORS",
  });
  const managePermission = accessDialog.getByRole("switch", {
    name: "MANAGE_ADMINISTRATORS",
  });
  const saveAccess = accessDialog.getByRole("button", { name: "Save changes" });
  await expect(saveAccess).toBeDisabled();
  await viewPermission.click();
  await expect(viewPermission).toBeChecked();
  await expect(saveAccess).toBeEnabled();

  await managePermission.click();
  await expect(managePermission).toBeChecked();
  await expect(viewPermission).toBeChecked();
  await expect(viewPermission).toBeDisabled();
  await expect(accessDialog.getByText("Included by")).toBeVisible();
  await saveAccess.click();
  await expect(page.getByText("Administrator access updated.")).toBeVisible();
  await expect(accessDialog).not.toBeVisible();
  await expect(
    targetRow.getByText("MANAGE_ADMINISTRATORS", { exact: true }),
  ).toBeVisible();

  await targetRow
    .getByRole("button", { name: "Actions for UI managed administrator" })
    .click();
  await page.getByRole("menuitem", { name: "Disable" }).click();
  await page.getByRole("button", { name: "Disable" }).last().click();
  await expect(targetRow.getByText("Disabled", { exact: true })).toBeVisible();
  await targetRow
    .getByRole("button", { name: "Actions for UI managed administrator" })
    .click();
  await page.getByRole("menuitem", { name: "Enable" }).click();
  await page.getByRole("button", { name: "Enable" }).last().click();
  await expect(targetRow.getByText("Active", { exact: true })).toBeVisible();

  const listed = await adminAPI.post(
    "/list-users",
    { filter_search: target.emailAddress },
    { token: managerToken },
  );
  expect(listed.status(), await listed.text()).toBe(200);
  expect((await responseJSON<ListUsersResponse>(listed)).users).toMatchObject([
    {
      admin_user_id: target.adminUserID,
      permissions: ["admin:manage_users", "admin:view_users"],
      state: "active",
    },
  ]);

  await page.getByRole("button", { name: "Invite administrator" }).click();
  const inviteDialog = page.getByRole("dialog", {
    name: "Invite an administrator",
  });
  await inviteDialog
    .getByRole("textbox", { name: "Email address" })
    .fill(invitationEmail);
  await inviteDialog
    .getByRole("switch", { name: "MANAGE_ADMINISTRATORS" })
    .click();
  await inviteDialog
    .getByRole("button", { name: "Invite administrator" })
    .click();
  await expect(
    page.getByText(`Invitation sent to ${invitationEmail}`),
  ).toBeVisible();
});

test("an administrator can manage two-factor authentication and use a recovery code", async ({
  createAdmin,
  page,
}) => {
  const admin = await createAdmin();
  const replacementPassword = `${admin.password}-replacement`;
  await signIn(page, admin.emailAddress, admin.password, "/settings/security");

  await page
    .getByLabel("New password", { exact: true })
    .fill(replacementPassword);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill(replacementPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Your password has been changed.")).toBeVisible();

  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const manualKey = await page
    .getByText(/^[A-Z2-7]{32}$/, { exact: true })
    .innerText();
  await page
    .getByRole("textbox", { name: "Six-digit code" })
    .fill(currentTOTP(manualKey));
  await page.getByRole("button", { name: "Confirm and enable" }).click();

  const recoveryDialog = page.getByRole("dialog", { name: "Recovery codes" });
  await expect(recoveryDialog.locator("code")).toHaveCount(10);
  const recoveryCode = await recoveryDialog.locator("code").first().innerText();
  await recoveryDialog.press("Escape");
  await expect(recoveryDialog).toBeVisible();
  await recoveryDialog
    .getByRole("button", { name: "I have saved these codes" })
    .click();

  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, admin.emailAddress, replacementPassword, "/", true);
  await page
    .getByRole("radiogroup")
    .getByText("Recovery code", { exact: true })
    .click();
  await page.getByRole("textbox", { name: "Recovery code" }).fill(recoveryCode);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("menuitem", { name: "Security" }).click();
  await expect(page.getByTestId("recovery-codes-remaining")).toHaveText("9");
  await page.getByRole("button", { name: "Regenerate recovery codes" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await page
    .getByRole("dialog", { name: "Recovery codes" })
    .getByRole("button", { name: "I have saved these codes" })
    .click();
  await page
    .getByRole("button", { name: "Turn off two-factor authentication" })
    .click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Disabled", { exact: true })).toBeVisible();
});

test("the security page asks for a fresh sign in before showing sensitive settings", async ({
  createAdmin,
  page,
}) => {
  const admin = await createAdmin();
  await page.addInitScript(
    ({ sessionToken, timeOffsetMilliseconds }) => {
      const actualDateNow = Date.now.bind(Date);
      sessionStorage.setItem("vetchium.admin.session-token", sessionToken);
      if (sessionStorage.getItem("vetchium.test.time-offset-ms") === null) {
        sessionStorage.setItem(
          "vetchium.test.time-offset-ms",
          String(timeOffsetMilliseconds),
        );
      }
      Date.now = () =>
        actualDateNow() +
        Number(sessionStorage.getItem("vetchium.test.time-offset-ms") ?? "0");
    },
    {
      sessionToken: admin.sessionToken,
      timeOffsetMilliseconds: 3 * 60 * 1000 + 30 * 1000,
    },
  );

  await page.goto("/settings/security");
  await expect(page).toHaveURL(/\/settings\/security$/);
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();

  await page.evaluate(() => {
    sessionStorage.setItem(
      "vetchium.test.time-offset-ms",
      String(4 * 60 * 1000 + 10 * 1000),
    );
  });
  await page.reload();
  await expect(page).toHaveURL(
    /\/reauthenticate\?returnTo=%2Fsettings%2Fsecurity$/,
  );
  await expect(
    page.getByRole("heading", { name: "Security" }),
  ).not.toBeVisible();
  await expect(
    page.getByText(`Signed in as ${admin.emailAddress}`),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.getByRole("menuitem", { name: "Security" }).click();
  await expect(page).toHaveURL(
    /\/reauthenticate\?returnTo=%2Fsettings%2Fsecurity$/,
  );
  await page.getByRole("button", { name: "Confirm access" }).click();
  await expect(page.getByText("This field is required.")).toBeVisible();
  await expect(page).toHaveURL(/\/reauthenticate/);

  await page.getByLabel("Password", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Confirm access" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "password was not accepted" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/reauthenticate/);

  await page.evaluate(() => {
    sessionStorage.removeItem("vetchium.test.time-offset-ms");
  });
  await page.getByLabel("Password", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Confirm access" }).click();
  await expect(page).toHaveURL(/\/settings\/security$/);
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
});

test("access confirmation rejects an external return location", async ({
  createAdmin,
  page,
}) => {
  const admin = await createAdmin();
  await page.addInitScript((sessionToken) => {
    sessionStorage.setItem("vetchium.admin.session-token", sessionToken);
  }, admin.sessionToken);

  await page.goto(
    "/reauthenticate?returnTo=https%3A%2F%2Fattacker.example%2Fsecurity",
  );
  await page.getByLabel("Password", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Confirm access" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("a server freshness rejection offers confirmation without signing out", async ({
  createAdmin,
  page,
  managerToken,
}) => {
  const target = await createAdmin();
  await page.addInitScript((sessionToken) => {
    sessionStorage.setItem("vetchium.admin.session-token", sessionToken);
  }, managerToken);
  await page.goto("/users");
  await page
    .getByRole("searchbox", { name: "Search by name or email address" })
    .fill(target.emailAddress);
  await page.getByRole("button", { name: "Search" }).click();
  const targetRow = page
    .getByRole("row")
    .filter({ hasText: target.emailAddress });
  await targetRow.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Manage access" }).click();

  ageSession(managerToken);
  const accessDialog = page.getByRole("dialog", { name: "Manage access" });
  await accessDialog
    .getByRole("switch", { name: "MANAGE_ADMINISTRATORS" })
    .click();
  await accessDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(
    accessDialog
      .getByRole("alert")
      .filter({ hasText: "Sign in again to continue" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await accessDialog.getByRole("button", { name: "Sign in again" }).click();
  await expect(page).toHaveURL(/\/reauthenticate\?returnTo=%2Fusers$/);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

// Runs against a tenant no other test touches, and only attempts refused
// changes, so the tenant-wide invariant stays observable under fullyParallel.
test("the last manager is warned about, and stopped from, removing their own access", async ({
  page,
}) => {
  // That tenant's portal defaults to German, and this test locates controls by
  // their English names.
  await page.addInitScript(() => {
    localStorage.setItem("vetchium.language", "en-US");
  });
  await page.goto(`${isolatedTenantBaseURL()}/login`);
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill(`admin@${ISOLATED_TENANT}.example`);
  await page
    .getByLabel("Password", { exact: true })
    .fill(SEEDED_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("menuitem", { name: "Administrators" }).click();

  const ownRow = page
    .getByRole("row")
    .filter({ hasText: `admin@${ISOLATED_TENANT}.example` });
  await ownRow.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Manage access" }).click();

  const accessDialog = page.getByRole("dialog", { name: "Manage access" });
  await expect(
    accessDialog
      .getByRole("alert")
      .filter({ hasText: "You are changing your own access" }),
  ).toBeVisible();
  await accessDialog
    .getByRole("switch", { name: "MANAGE_ADMINISTRATORS" })
    .click();
  await accessDialog.getByRole("button", { name: "Save changes" }).click();

  await expect(
    page.getByText(
      "At least one active administrator has to keep the permission to manage administrators.",
    ),
  ).toBeVisible();
  expect(seededManagerGrants(ISOLATED_TENANT)).toEqual([
    "admin:manage_hub_signup_domains",
    "admin:manage_users",
  ]);

  await accessDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(accessDialog).not.toBeVisible();
  await expect(
    ownRow.getByText("MANAGE_ADMINISTRATORS", { exact: true }),
  ).toBeVisible();
});
