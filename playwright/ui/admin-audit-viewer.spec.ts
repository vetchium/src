import { randomUUID } from "node:crypto";
import { ViewAuditLogs } from "typespec/admin/authorization/types";
import { InternalServerError } from "typespec/problem/details";
import {
  cleanupHubUser,
  seedActiveHubUser,
  sqlLiteral,
  sqlScalar,
} from "../lib/admin-db.ts";
import {
  expect,
  SEEDED_ADMIN_EMAIL,
  SEEDED_ADMIN_PASSWORD,
  test,
} from "../lib/admin-fixtures.ts";
import { uniqueTestEmail } from "../lib/test-id.ts";

test.use({ timezoneId: "Asia/Kolkata" });

test("seeded administrator can open audit logs from the normal navigation", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill(SEEDED_ADMIN_EMAIL);
  await page
    .getByLabel("Password", { exact: true })
    .fill(SEEDED_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("menuitem", { name: "Audit logs" }).click();
  await expect(page).toHaveURL(/\/audit-logs$/);
  await expect(page.getByRole("heading", { name: "Audit logs" })).toBeVisible();
});

test("audit viewer enforces route permission, mandatory filters and date range, and handles empty and failed searches", async ({
  page,
  adminAPI,
  managerToken,
  createAdmin,
}) => {
  const viewer = await createAdmin();
  await page.goto("/login?returnTo=%2Faudit-logs");
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill(viewer.emailAddress);
  await page.getByLabel("Password", { exact: true }).fill(viewer.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("menuitem", { name: "Audit logs" })).toHaveCount(
    0,
  );
  expect(
    (
      await adminAPI.post(
        "/set-user-permissions",
        { admin_user_id: viewer.adminUserID, permissions: [ViewAuditLogs] },
        { token: managerToken },
      )
    ).status(),
  ).toBe(204);
  await page.goto("/audit-logs");
  await expect(page.getByRole("heading", { name: "Audit logs" })).toBeVisible();
  await page.getByLabel("Start date and time").fill("2026-01-01T00:00");
  await page.getByLabel("End date and time").fill("2026-02-01T00:00");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter at least one" }),
  ).toBeVisible();
  await page.getByLabel("Hub account email").fill("invalid");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter a valid exact" }),
  ).toBeVisible();
  await page.getByLabel("Hub account email").fill(uniqueTestEmail("audit-ui"));
  await page.getByLabel("End date and time").fill("2026-02-01T00:00:01");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "no longer than 31 days" }),
  ).toBeVisible();
  await page.getByLabel("End date and time").fill("2025-12-31T00:00");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "no longer than 31 days" }),
  ).toBeVisible();
  await page.getByLabel("End date and time").fill("2026-02-01T00:00");
  const completed = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/list-audit-events"),
  );
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const body = (await completed).request().postDataJSON() as {
    start_at: string;
    end_at: string;
  };
  expect(body.start_at.endsWith("Z")).toBe(true);
  expect(body.end_at.endsWith("Z")).toBe(true);
  await expect(page.getByText("No matching events.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Search", exact: true }),
  ).toBeVisible();
  await page.route("**/api/admin/list-audit-events", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify(InternalServerError),
    }),
  );
  await page
    .getByLabel("Hub account email")
    .fill(uniqueTestEmail("audit-error"));
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.unroute("**/api/admin/list-audit-events");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("No matching events.")).toBeVisible();
  expect(
    (
      await adminAPI.post(
        "/set-user-permissions",
        { admin_user_id: viewer.adminUserID, permissions: [] },
        { token: managerToken },
      )
    ).status(),
  ).toBe(204);
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
});

test("audit viewer displays local times and safe details with next and previous pages", async ({
  page,
  adminAPI,
  managerToken,
  createAdmin,
}) => {
  const viewer = await createAdmin();
  expect(
    (
      await adminAPI.post(
        "/set-user-permissions",
        { admin_user_id: viewer.adminUserID, permissions: [ViewAuditLogs] },
        { token: managerToken },
      )
    ).status(),
  ).toBe(204);
  const email = `e2e+${randomUUID()}@e2e-audit-ui-${randomUUID()}.example.test`;
  const ids = Array.from({ length: 26 }, () => randomUUID());
  try {
    const hub = seedActiveHubUser("sgp", email, "Audit Display Name");
    sqlScalar(`INSERT INTO vetchium.audit_events (audit_event_id,tenant_id,action,entity_type,entity_id,actor_type,actor_id,source,payload,created_at)
    SELECT id,'sgp','hub.profile.public-fields-set','hub_user',${sqlLiteral(hub.hubUserDID)},'hub_user',${sqlLiteral(hub.hubUserDID)},'hub-api','{"display_name":"Visible Name","email_address":"hidden@example.test","date_of_birth":"1990-01-01"}'::jsonb,'2026-01-15T12:00:00Z'::timestamptz FROM unnest(ARRAY[${ids.map(sqlLiteral).join(",")}]::uuid[]) AS id;`);
    await page.goto("/login?returnTo=%2Faudit-logs");
    await page
      .getByRole("textbox", { name: "Email address" })
      .fill(viewer.emailAddress);
    await page.getByLabel("Password", { exact: true }).fill(viewer.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByRole("heading", { name: "Audit logs" }),
    ).toBeVisible();
    await page.getByLabel("Hub handle").fill(hub.handle);
    await page.getByLabel("Start date and time").fill("2026-01-14T00:00");
    await page.getByLabel("End date and time").fill("2026-01-16T00:00");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      page.getByRole("cell", {
        name: "hub.profile.public-fields-set",
        exact: true,
      }),
    ).toHaveCount(25);
    await expect(page.getByRole("cell", { name: /5:30:00 PM/ })).toHaveCount(
      25,
    );
    await page
      .getByRole("button", { name: "Event details", exact: true })
      .first()
      .click();
    await expect(page.getByText("display_name: Visible Name")).toBeVisible();
    await expect(page.getByText("hidden@example.test")).toHaveCount(0);
    await expect(page.getByText("1990-01-01")).toHaveCount(0);
    await expect(
      page.getByText("Audit Display Name (hub_user)").first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      page.getByRole("cell", {
        name: "hub.profile.public-fields-set",
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Next", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(
      page.getByRole("cell", {
        name: "hub.profile.public-fields-set",
        exact: true,
      }),
    ).toHaveCount(25);
  } finally {
    sqlScalar(
      `DELETE FROM vetchium.audit_events WHERE audit_event_id = ANY(ARRAY[${ids.map(sqlLiteral).join(",")}]::uuid[]);`,
    );
    cleanupHubUser(email);
  }
});
