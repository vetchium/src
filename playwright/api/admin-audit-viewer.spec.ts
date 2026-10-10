import { randomUUID } from "node:crypto";
import type {
  ListRequest,
  ListResponse,
} from "typespec/admin/audit-logs/events";
import { ViewAuditLogs } from "typespec/admin/authorization/types";
import { AdminAuthenticationRequiredError } from "typespec/problem/admin/authentication";
import { AdminPermissionRequiredError } from "typespec/problem/admin/authorization";
import { InvalidPaginationKeyError } from "typespec/problem/common";
import {
  InvalidJSONError,
  ValidationFailedError,
} from "typespec/problem/details";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import {
  cleanupHubUser,
  seedActiveHubUser,
  sqlLiteral,
  sqlScalar,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import {
  deleteOrgVerificationRecord,
  uniqueOrgDomain,
} from "../lib/dev-dns.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgDID,
  orgSQL,
  orgsIdempotencyKey,
  signupOrg,
} from "../lib/orgs-api.ts";
import { uniqueTestEmail } from "../lib/test-id.ts";

const range = {
  start_at: "2026-01-01T00:00:00Z",
  end_at: "2026-02-01T00:00:00Z",
};

test("audit viewer requires an explicit permission, identity, UTC dates, and at most 31 days", async ({
  adminAPI,
  managerToken,
  createAdmin,
}) => {
  const viewer = await createAdmin();
  const valid: ListRequest = {
    ...range,
    hub_email: uniqueTestEmail("audit-missing"),
  };
  let response = await adminAPI.listAuditEvents(valid);
  await expectProblem(response, 401, AdminAuthenticationRequiredError.type);
  expect(response.headers()["www-authenticate"]).toContain("Bearer");
  expect((await adminAPI.listAuditEvents(valid, managerToken)).status()).toBe(
    200,
  );
  await expectProblem(
    await adminAPI.listAuditEvents(valid, viewer.sessionToken),
    403,
    AdminPermissionRequiredError.type,
  );
  const grant = await adminAPI.post(
    "/set-user-permissions",
    { admin_user_id: viewer.adminUserID, permissions: [ViewAuditLogs] },
    { token: managerToken },
  );
  expect(grant.status(), await grant.text()).toBe(204);
  response = await adminAPI.listAuditEvents(valid, viewer.sessionToken);
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect((await responseJSON<ListResponse>(response)).events).toEqual([]);
  for (const invalid of [
    range,
    { ...valid, end_at: "2026-02-01T00:00:00.001Z" },
    { ...valid, end_at: "2025-12-31T00:00:00Z" },
    { ...valid, start_at: "2026-01-01T00:00:00+00:00" },
    { ...valid, hub_email: "invalid" },
    { ...valid, limit: 101 },
  ]) {
    await expectProblem(
      await adminAPI.listAuditEventsRaw(invalid, viewer.sessionToken),
      400,
      ValidationFailedError.type,
    );
  }
  await expectProblem(
    await adminAPI.listAuditEventsRaw(
      { ...valid, hub_user_id: randomUUID() },
      viewer.sessionToken,
    ),
    400,
    InvalidJSONError.type,
  );
  await expectProblem(
    await adminAPI.listAuditEvents(
      { ...valid, pagination_key: "tampered" },
      viewer.sessionToken,
    ),
    400,
    InvalidPaginationKeyError.type,
  );
});

test("audit viewer matches actor and subject, AND filters, dates, pagination and tenant while excluding sensitive fields", async ({
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
  const email = `e2e+${randomUUID()}@e2e-audit-${randomUUID()}.example.test`;
  const eventIDs = Array.from({ length: 7 }, () => randomUUID());
  try {
    const user = seedActiveHubUser("sgp", email, "Audit Person");
    for (let i = 0; i < eventIDs.length; i++) {
      sqlScalar(`INSERT INTO vetchium.audit_events (audit_event_id,tenant_id,action,entity_type,entity_id,actor_type,actor_id,source,payload,created_at,subject_hub_user_did)
    VALUES (${sqlLiteral(eventIDs[i] as string)}::uuid,${sqlLiteral(i === 3 ? "usa1" : "sgp")},${sqlLiteral(i === 4 ? "admin.user.changed" : i === 6 ? "hub.email.sent" : "hub.profile.changed")},${sqlLiteral(i === 6 ? "hub_email" : "hub_user")},${sqlLiteral(user.hubUserDID)},${sqlLiteral(i === 1 ? "worker" : "hub_user")},${i === 1 ? "NULL" : sqlLiteral(user.hubUserDID)},'hub-api',${sqlLiteral(JSON.stringify({ display_name: "Audit Person", email_address: email, date_of_birth: "1990-01-01", password: "secret", profile_version: 2 }))}::jsonb,${sqlLiteral(i === 5 ? "2025-12-31T23:59:59Z" : "2026-01-15T12:00:00Z")}::timestamptz,${sqlLiteral(user.hubUserDID)}::uuid);`);
    }
    const request: ListRequest = {
      ...range,
      hub_handle: user.handle,
      hub_email: email,
      limit: 1,
    };
    const found: string[] = [];
    let key: string | undefined;
    do {
      const response = await adminAPI.listAuditEvents(
        { ...request, ...(key === undefined ? {} : { pagination_key: key }) },
        viewer.sessionToken,
      );
      expect(response.status(), await response.text()).toBe(200);
      const body = await responseJSON<ListResponse>(response);
      expect(body.events).toHaveLength(1);
      for (const event of body.events) {
        found.push(event.audit_event_id);
        expect(event.created_at.endsWith("Z")).toBe(true);
        expect(event.details).toContainEqual({
          field: "display_name",
          value: "Audit Person",
        });
      }
      const text = JSON.stringify(body.events);
      for (const excluded of [email, user.hubUserDID, "1990-01-01", "secret"])
        expect(text).not.toContain(excluded);
      if (body.next_pagination_key) {
        await expectProblem(
          await adminAPI.listAuditEvents(
            {
              ...request,
              hub_email: uniqueTestEmail("other"),
              pagination_key: body.next_pagination_key,
            },
            viewer.sessionToken,
          ),
          400,
          InvalidPaginationKeyError.type,
        );
      }
      key = body.next_pagination_key;
    } while (key);
    expect(new Set(found).size).toBe(3);
    expect(found.sort()).toEqual(eventIDs.slice(0, 3).sort());
    const mismatch = await responseJSON<ListResponse>(
      await adminAPI.listAuditEvents(
        { ...request, hub_email: uniqueTestEmail("other") },
        viewer.sessionToken,
      ),
    );
    expect(mismatch.events).toEqual([]);
  } finally {
    sqlScalar(
      `DELETE FROM vetchium.audit_events WHERE audit_event_id = ANY(ARRAY[${eventIDs.map(sqlLiteral).join(",")}]::uuid[]);`,
    );
    cleanupHubUser(email);
  }
});

test("audit viewer finds Org domain, acting user, affected bulk user and anonymous password reset events", async ({
  request,
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
  const api = new OrgsAPI(request);
  const domain = uniqueOrgDomain();
  try {
    const org = await signupOrg(api, domain);
    const token = await loginOrg(api, org);
    const name = await api.setCompanyName(token, {
      display_name: "Audit Company",
    });
    expect(name.status(), await name.text()).toBe(204);
    const otherEmail = `member@${domain}`;
    const otherID = randomUUID();
    orgSQL(
      `INSERT INTO vetchium.org_users (org_user_id,org_did,email_address,org_user_state,preferred_language) VALUES (${sqlLiteral(otherID)}::uuid,${sqlLiteral(orgDID(domain))}::uuid,${sqlLiteral(otherEmail)},'active','en-US');`,
    );
    const disabled = await api.post(
      "/bulk-disable-users",
      { email_addresses: [otherEmail] },
      { token },
    );
    expect(disabled.status(), await disabled.text()).toBe(204);
    const reset = await api.post(
      "/request-password-reset",
      { domain, email_address: org.emailAddress },
      { idempotencyKey: orgsIdempotencyKey() },
    );
    expect(reset.status(), await reset.text()).toBe(202);
    const dates = {
      start_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      end_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    const listed = await adminAPI.listAuditEvents(
      { ...dates, org_domain: domain, org_user_email: otherEmail },
      viewer.sessionToken,
    );
    expect(listed.status(), await listed.text()).toBe(200);
    const events = (await responseJSON<ListResponse>(listed)).events;
    expect(events.map((event) => event.action)).toContain("org.users.disabled");
    expect(events.map((event) => event.action)).not.toContain(
      "org.company.name_changed",
    );
    const actor = await responseJSON<ListResponse>(
      await adminAPI.listAuditEvents(
        { ...dates, org_domain: domain, org_user_email: org.emailAddress },
        viewer.sessionToken,
      ),
    );
    expect(actor.events.map((event) => event.action)).toContain(
      "org.company.name_changed",
    );
    expect(actor.events.map((event) => event.action)).toContain(
      "org.users.disabled",
    );
    expect(actor.events.map((event) => event.action)).toContain(
      "org.password-reset.requested",
    );
    const byDomain = await responseJSON<ListResponse>(
      await adminAPI.listAuditEvents(
        { ...dates, org_domain: domain },
        viewer.sessionToken,
      ),
    );
    expect(byDomain.events.map((event) => event.action)).toContain(
      "org.created",
    );
    const mismatch = await responseJSON<ListResponse>(
      await adminAPI.listAuditEvents(
        {
          ...dates,
          org_domain: uniqueOrgDomain(),
          org_user_email: org.emailAddress,
        },
        viewer.sessionToken,
      ),
    );
    expect(mismatch.events).toEqual([]);
    for (const email of [org.emailAddress, otherEmail])
      expect(JSON.stringify(byDomain)).not.toContain(email);
  } finally {
    await deleteOrgVerificationRecord(domain);
    cleanupOrg(domain);
  }
});
