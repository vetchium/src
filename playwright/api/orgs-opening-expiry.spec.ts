import { expect } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgSQL,
  signupOrg,
} from "../lib/orgs-api.ts";

const content: OpeningContent = {
  title: "Expiry test",
  description: "Build software",
  language: "en",
  employing_country: "SG",
  work_arrangement: "on_site",
  employment_type: "full_time",
  positions: 1,
};

test("the worker expires a suspended Org Opening and cancels its request", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const createdResponse = await api.createOpening(owner, {
      content,
      hiring_manager_email: manager.emailAddress,
      recruiter_email: manager.emailAddress,
      team_member_emails: [],
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const created = (await createdResponse.json()) as OrgOpening;
    const publishedResponse = await api.requestOpeningChange(owner, {
      opening_number: created.opening_number,
      version: created.version,
      kind: "publish",
    });
    expect(publishedResponse.status(), await publishedResponse.text()).toBe(
      200,
    );
    const published = (await publishedResponse.json()) as OrgOpening;
    expect(published.state).toBe("published");
    const savedResponse = await api.saveOpeningWorkingCopy(owner, {
      opening_number: created.opening_number,
      version: published.version,
      content: { ...published.live_content, title: "Unapproved revision" },
    });
    expect(savedResponse.status(), await savedResponse.text()).toBe(200);
    const saved = (await savedResponse.json()) as OrgOpening;
    const requestedResponse = await api.requestOpeningChange(manager.token, {
      opening_number: created.opening_number,
      version: saved.version,
      kind: "revise",
    });
    expect(requestedResponse.status(), await requestedResponse.text()).toBe(
      200,
    );
    const requested = (await requestedResponse.json()) as OrgOpening;
    expect(requested.pending_request?.kind).toBe("revise");

    const opening = `(SELECT o.org_opening_id FROM vetchium.org_openings AS o
      JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
      WHERE d.domain = '${org.domain}'
        AND o.opening_number = ${created.opening_number})`;
    orgSQL(`UPDATE vetchium.orgs SET org_state = 'suspended',
      suspended_at = now() WHERE org_did =
      (SELECT org_did FROM vetchium.org_domains
       WHERE domain = '${org.domain}')`);
    orgSQL(`UPDATE vetchium.org_openings SET
      created_at = now() - interval '182 days',
      first_published_at = now() - interval '181 days',
      expires_at = now() - interval '1 day'
      WHERE org_opening_id = ${opening}`);

    await expect
      .poll(() =>
        orgSQL(
          `SELECT opening_state::text FROM vetchium.org_openings
       WHERE org_opening_id = ${opening}`,
        ),
      )
      .toBe("expired");
    expect(
      orgSQL(`SELECT CONCAT_WS('|', version::text,
      ended_at IS NOT NULL) FROM vetchium.org_openings
      WHERE org_opening_id = ${opening}`),
    ).toBe(`${requested.version + 1}|t`);
    expect(
      orgSQL(`SELECT request_state::text
      FROM vetchium.org_opening_requests
      WHERE org_opening_id = ${opening}
        AND request_kind = 'revise'`),
    ).toBe("cancelled");
    expect(
      orgSQL(`SELECT count(*)::text FROM vetchium.org_opening_contents
      WHERE org_opening_id = ${opening} AND slot = 'working'`),
    ).toBe("0");
    expect(
      orgSQL(`SELECT string_agg(action::text, ',' ORDER BY action::text)
      FROM vetchium.org_opening_history
      WHERE org_opening_id = ${opening}
        AND action IN ('expired', 'cancelled')`),
    ).toBe("cancelled,expired");
    expect(
      orgSQL(`SELECT string_agg(action, ',' ORDER BY action)
      FROM vetchium.audit_events
      WHERE entity_id = (SELECT org_did::text || ':' || opening_number::text
        FROM vetchium.org_openings WHERE org_opening_id = ${opening})
        AND action IN ('org.opening.expired', 'org.opening.cancelled')
        AND actor_type = 'worker' AND actor_id = 'opening-expiry'`),
    ).toBe("org.opening.cancelled,org.opening.expired");
  } finally {
    cleanupOrg(org.domain);
    await deleteOrgVerificationRecord(org.domain);
  }
});
