import { expectProblem } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  installOrgAuditInsertFailure,
  inviteeAddress,
  loginOrg,
  OrgsAPI,
  orgAuditEvents,
  orgInfo,
  orgSQL,
  orgUserID,
  signupOrg,
} from "../lib/orgs-api.ts";

test("company name editing is normalized, authorized, audited and atomic", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const member = await addOrgMember(
      api,
      owner,
      org.domain,
      inviteeAddress(org.domain),
      [],
    );
    await expectProblem(
      await api.post("/set-company-name", { display_name: "New" }),
      401,
      "vetchium-problem-details/org-authentication-required",
    );
    await expectProblem(
      await api.post(
        "/set-company-name",
        { display_name: "New" },
        { token: member.token },
      ),
      403,
      "vetchium-problem-details/org-permission-required",
    );
    for (const value of ["", " ", "界".repeat(201)])
      await expectProblem(
        await api.post(
          "/set-company-name",
          { display_name: value },
          { token: owner },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["display_name"],
      );
    await expectProblem(
      await request.post(`${api.origin}/api/orgs/set-company-name`, {
        data: "{",
        headers: {
          Authorization: `Bearer ${owner}`,
          "Content-Type": "application/json",
        },
      }),
      400,
      "vetchium-problem-details/invalid-json",
    );
    const saved = await api.post(
      "/set-company-name",
      { display_name: "  புதிய நிறுவனம்  " },
      { token: owner },
    );
    expect(saved.status()).toBe(204);
    expect(saved.headers()["cache-control"]).toBe("no-store");
    expect((await orgInfo(api, owner)).org.display_name).toBe("புதிய நிறுவனம்");
    const actorID = orgUserID(org.emailAddress);
    const changes = () =>
      orgAuditEvents([actorID]).filter(
        (event) => event.action === "org.company.name_changed",
      );
    expect(changes()).toHaveLength(1);
    expect(JSON.stringify(changes())).not.toContain("புதிய நிறுவனம்");
    expect(
      (
        await api.setCompanyName(owner, { display_name: "புதிய நிறுவனம்" })
      ).status(),
    ).toBe(204);
    expect(changes()).toHaveLength(1);
    const removeFault = installOrgAuditInsertFailure({
      action: "org.company.name_changed",
      actorID,
    });
    try {
      expect(
        (
          await api.post(
            "/set-company-name",
            { display_name: "Should roll back" },
            { token: owner },
          )
        ).status(),
      ).toBe(500);
    } finally {
      removeFault();
    }
    expect((await orgInfo(api, owner)).org.display_name).toBe("புதிய நிறுவனம்");
    orgSQL(
      `UPDATE vetchium.orgs SET org_state='suspended', suspended_at=now() WHERE org_did=(SELECT org_did FROM vetchium.org_domains WHERE domain='${org.domain}')`,
    );
    await expectProblem(
      await api.post(
        "/set-company-name",
        { display_name: "New" },
        { token: owner },
      ),
      403,
      "vetchium-problem-details/org-suspended",
    );
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
