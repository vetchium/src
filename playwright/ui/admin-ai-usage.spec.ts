import { ViewAIUsage } from "typespec/admin/authorization/types";
import { OrgAITermsVersion } from "typespec/orgs/ai/ai";
import { expect, test } from "../lib/admin-fixtures.ts";
import {
  deleteOrgVerificationRecord,
  uniqueOrgDomain,
} from "../lib/dev-dns.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgAuditEvents,
  signupOrg,
} from "../lib/orgs-api.ts";

test("an administrator with admin:view_ai_usage reads an Org's prompts, and each read is audited", async ({
  page,
  request,
  adminAPI,
  managerToken,
  createAdmin,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    expect(
      (
        await api.setSubscriptionPlan(owner, {
          plan_oid: "org-gold-tier",
          billing_interval: "month",
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await api.setAISettings(owner, {
          enabled: true,
          accept_terms_version: OrgAITermsVersion,
          policies: [],
        })
      ).status(),
    ).toBe(200);
    await expect
      .poll(
        async () =>
          (
            (await (await api.aiCredits(owner)).json()) as {
              balance: { available: number };
            }
          ).balance.available,
        { timeout: 15000 },
      )
      .toBeGreaterThan(0);
    const drafted = await api.draftOpeningWithAI(owner, {
      instruction: "Field technician",
    });
    expect(drafted.status(), await drafted.text()).toBe(200);
    const usageID = ((await drafted.json()) as { usage: { usage_id: string } })
      .usage.usage_id;

    const viewer = await createAdmin();
    await page.goto("/login");
    await page
      .getByRole("textbox", { name: "Email address" })
      .fill(viewer.emailAddress);
    await page.getByLabel("Password", { exact: true }).fill(viewer.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("menuitem", { name: "Overview" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Org AI usage" }),
    ).toHaveCount(0);
    expect(
      (
        await adminAPI.post(
          "/set-user-permissions",
          { admin_user_id: viewer.adminUserID, permissions: [ViewAIUsage] },
          { token: managerToken },
        )
      ).status(),
    ).toBe(204);
    await page.reload();
    await page.getByRole("menuitem", { name: "Org AI usage" }).click();
    await expect(
      page.getByRole("heading", { name: "Org AI usage" }),
    ).toBeVisible();

    await page.getByLabel("Org domain").fill("not a domain");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("Enter the Org's exact domain.")).toBeVisible();
    await page.getByLabel("Org domain").fill(uniqueOrgDomain());
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      page.getByText("No Org of this instance holds that domain."),
    ).toBeVisible();

    await page.getByLabel("Org domain").fill(org.domain);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: org.emailAddress }),
    ).toBeVisible();
    await page.getByRole("button", { name: "View" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Request:\nField technician")).toBeVisible();
    expect(
      orgAuditEvents([usageID]).filter(
        (event) => event.action === "admin.org_ai_usage_text.viewed",
      ),
    ).toHaveLength(1);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
