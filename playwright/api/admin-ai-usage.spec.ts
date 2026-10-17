import type { ListOrgAIUsageResponse } from "typespec/admin/ai-usage/usage";
import { ViewAIUsage } from "typespec/admin/authorization/types";
import { OrgAITermsVersion } from "typespec/orgs/ai/ai";
import type { AIUsageText } from "typespec/orgs/ai/types";
import {
  AIUsageNotFoundError,
  OrgNotFoundError,
} from "typespec/problem/admin/ai-usage";
import { AdminAuthenticationRequiredError } from "typespec/problem/admin/authentication";
import { AdminPermissionRequiredError } from "typespec/problem/admin/authorization";
import { InvalidPaginationKeyError } from "typespec/problem/common";
import {
  InvalidJSONError,
  ValidationFailedError,
} from "typespec/problem/details";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
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

test("an administrator with admin:view_ai_usage reviews an Org's usage, and every text read is audited", async ({
  adminAPI,
  managerToken,
  createAdmin,
  request,
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
    const usageIDs: string[] = [];
    for (const instruction of ["Support engineer", "Sales lead"]) {
      const response = await api.draftOpeningWithAI(owner, { instruction });
      expect(response.status(), await response.text()).toBe(200);
      usageIDs.push(
        ((await response.json()) as { usage: { usage_id: string } }).usage
          .usage_id,
      );
    }

    const viewer = await createAdmin();
    const listRequest = { org_domain: org.domain };
    let response = await adminAPI.post("/list-org-ai-usage", listRequest);
    await expectProblem(response, 401, AdminAuthenticationRequiredError.type);
    await expectProblem(
      await adminAPI.post("/list-org-ai-usage", listRequest, {
        token: viewer.sessionToken,
      }),
      403,
      AdminPermissionRequiredError.type,
    );
    await expectProblem(
      await adminAPI.post(
        "/get-org-ai-usage-text",
        { org_domain: org.domain, usage_id: usageIDs[0] },
        { token: viewer.sessionToken },
      ),
      403,
      AdminPermissionRequiredError.type,
    );
    await expectProblem(
      await adminAPI.post("/get-org-ai-usage-text", {
        org_domain: org.domain,
        usage_id: usageIDs[0],
      }),
      401,
      AdminAuthenticationRequiredError.type,
    );
    const grant = await adminAPI.post(
      "/set-user-permissions",
      { admin_user_id: viewer.adminUserID, permissions: [ViewAIUsage] },
      { token: managerToken },
    );
    expect(grant.status(), await grant.text()).toBe(204);
    const token = viewer.sessionToken;

    response = await adminAPI.post(
      "/list-org-ai-usage",
      { ...listRequest, limit: 1 },
      { token },
    );
    expect(response.status(), await response.text()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const page = await responseJSON<ListOrgAIUsageResponse>(response);
    expect(page.entries).toEqual([
      expect.objectContaining({
        usage_id: usageIDs[1],
        operation: "org-opening-draft",
        actor_email: org.emailAddress,
        state: "settled",
        text_available: true,
      }),
    ]);
    response = await adminAPI.post(
      "/list-org-ai-usage",
      { ...listRequest, limit: 1, pagination_key: page.next_pagination_key },
      { token },
    );
    const next = await responseJSON<ListOrgAIUsageResponse>(response);
    expect(next.entries.map((entry) => entry.usage_id)).toEqual([usageIDs[0]]);
    expect(next.next_pagination_key).toBeUndefined();
    // A domain no Org of this tenant holds is not found.
    await expectProblem(
      await adminAPI.post(
        "/list-org-ai-usage",
        {
          org_domain: uniqueOrgDomain(),
          pagination_key: page.next_pagination_key,
        },
        { token },
      ),
      404,
      OrgNotFoundError.type,
    );
    await expectProblem(
      await adminAPI.post(
        "/list-org-ai-usage",
        { ...listRequest, pagination_key: "forged" },
        { token },
      ),
      400,
      InvalidPaginationKeyError.type,
    );
    await expectProblem(
      await adminAPI.post(
        "/list-org-ai-usage",
        { org_domain: "not a domain" },
        { token },
      ),
      400,
      ValidationFailedError.type,
      ["org_domain"],
    );
    await expectProblem(
      await adminAPI.post(
        "/list-org-ai-usage",
        { ...listRequest, unknown: true },
        { token },
      ),
      400,
      InvalidJSONError.type,
    );

    response = await adminAPI.post(
      "/get-org-ai-usage-text",
      { org_domain: org.domain, usage_id: usageIDs[0] },
      { token },
    );
    expect(response.status(), await response.text()).toBe(200);
    const text = await responseJSON<AIUsageText>(response);
    expect(text.request_messages[1]?.content).toContain(
      "Request:\nSupport engineer",
    );
    expect(text.response_text).toContain("Draft: Support engineer");
    const viewed = orgAuditEvents([usageIDs[0] ?? ""]).filter(
      (event) => event.action === "admin.org_ai_usage_text.viewed",
    );
    expect(viewed).toEqual([
      expect.objectContaining({
        actor_type: "admin",
        actor_id: viewer.adminUserID,
        source: "admin-api",
      }),
    ]);

    await expectProblem(
      await adminAPI.post(
        "/get-org-ai-usage-text",
        {
          org_domain: org.domain,
          usage_id: "0192f0c2-6a1e-7c3d-8e4f-0123456789ab",
        },
        { token },
      ),
      404,
      AIUsageNotFoundError.type,
    );
    await expectProblem(
      await adminAPI.post(
        "/get-org-ai-usage-text",
        { org_domain: uniqueOrgDomain(), usage_id: usageIDs[0] },
        { token },
      ),
      404,
      AIUsageNotFoundError.type,
    );
    await expectProblem(
      await adminAPI.post(
        "/get-org-ai-usage-text",
        { org_domain: org.domain, usage_id: "x" },
        { token },
      ),
      400,
      ValidationFailedError.type,
      ["usage_id"],
    );
    await expectProblem(
      await adminAPI.post("/get-org-ai-usage-text", [], { token }),
      400,
      InvalidJSONError.type,
    );
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
