import type { SetCompanyDetailsRequest } from "typespec/orgs/settings/company";
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

const details = {
  display_name: "New",
  country: "SG",
  default_language: "en-US",
};

test("company details editing is normalized, authorized, audited and atomic", async ({
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
      await api.post("/set-company-details", details),
      401,
      "vetchium-problem-details/org-authentication-required",
    );
    await expectProblem(
      await api.post("/set-company-details", details, {
        token: member.token,
      }),
      403,
      "vetchium-problem-details/org-permission-required",
    );
    for (const value of ["", " ", "界".repeat(201)])
      await expectProblem(
        await api.post(
          "/set-company-details",
          { ...details, display_name: value },
          { token: owner },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["display_name"],
      );
    for (const country of ["sg", "ZZ", ""])
      await expectProblem(
        await api.post(
          "/set-company-details",
          { ...details, country },
          { token: owner },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["country"],
      );
    for (const language of ["fr-FR", "en", ""])
      await expectProblem(
        await api.post(
          "/set-company-details",
          { ...details, default_language: language },
          { token: owner },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["default_language"],
      );
    await expectProblem(
      await api.post(
        "/set-company-details",
        { display_name: "New" },
        { token: owner },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["country", "default_language"],
    );
    await expectProblem(
      await request.post(`${api.origin}/api/orgs/set-company-details`, {
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
      "/set-company-details",
      {
        display_name: "  புதிய நிறுவனம்  ",
        country: "IN",
        default_language: "ta",
      },
      { token: owner },
    );
    expect(saved.status()).toBe(204);
    expect(saved.headers()["cache-control"]).toBe("no-store");
    expect((await orgInfo(api, owner)).org).toMatchObject({
      display_name: "புதிய நிறுவனம்",
      country: "IN",
      default_language: "ta",
    });
    const actorID = orgUserID(org.emailAddress);
    const changes = () =>
      orgAuditEvents([actorID]).filter(
        (event) => event.action === "org.company.details_changed",
      );
    expect(changes()).toHaveLength(1);
    expect(changes()[0]?.payload).toEqual({
      changed_fields: ["display_name", "country", "default_language"],
    });
    expect(JSON.stringify(changes())).not.toContain("புதிய நிறுவனம்");
    const unchanged: SetCompanyDetailsRequest = {
      display_name: "புதிய நிறுவனம்",
      country: "IN",
      default_language: "ta",
    };
    expect((await api.setCompanyDetails(owner, unchanged)).status()).toBe(204);
    expect(changes()).toHaveLength(1);
    expect(
      (
        await api.setCompanyDetails(owner, { ...unchanged, country: "LK" })
      ).status(),
    ).toBe(204);
    expect(changes()).toHaveLength(2);
    expect(changes()[1]?.payload).toEqual({ changed_fields: ["country"] });

    // Invitations go out in the Org's language, not the inviter's.
    const invitee = inviteeAddress(org.domain);
    const invited = await api.inviteUsers(owner, {
      email_addresses: [invitee],
      permissions: [],
    });
    expect(invited.status(), await invited.text()).toBe(200);
    expect(
      orgSQL(
        `SELECT preferred_language FROM vetchium.org_email_outbox
         WHERE kind = 'invitation' AND recipient_email_address = '${invitee}'`,
      ),
    ).toBe("ta");
    expect(
      (await api.resendInvitation(owner, { email_address: invitee })).status(),
    ).toBe(200);
    expect(
      orgSQL(
        `SELECT string_agg(DISTINCT preferred_language, ',')
         FROM vetchium.org_email_outbox
         WHERE kind = 'invitation' AND recipient_email_address = '${invitee}'`,
      ),
    ).toBe("ta");

    const removeFault = installOrgAuditInsertFailure({
      action: "org.company.details_changed",
      actorID,
    });
    try {
      expect(
        (
          await api.post(
            "/set-company-details",
            { ...unchanged, display_name: "Should roll back" },
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
      await api.post("/set-company-details", details, { token: owner }),
      403,
      "vetchium-problem-details/org-suspended",
    );
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
