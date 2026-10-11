import { expect } from "@playwright/test";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgAuditEventsByKey,
  orgSQL,
  orgsIdempotencyKey,
  signupOrg,
} from "../lib/orgs-api.ts";

test("create-opening returns a numbered draft and its reads stay consistent", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const createdResponse = await api.createOpening(owner, {
      content: { title: "Engineer" },
      hiring_manager_email: org.emailAddress,
      recruiter_email: org.emailAddress,
      team_member_emails: [],
    });
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const created = (await createdResponse.json()) as OrgOpening;
    expect(created).toMatchObject({
      opening_number: 1,
      state: "draft",
      version: 1,
      revision: 0,
      working_content: { title: "Engineer" },
      hiring_manager: { email: org.emailAddress, active: true },
      recruiter: { email: org.emailAddress, active: true },
      team_members: [],
    });
    expect(created.live_content).toBeUndefined();

    const detail = await api.getOpening(owner, {
      opening_number: created.opening_number,
    });
    expect(detail.status(), await detail.text()).toBe(200);
    expect(await detail.json()).toEqual(created);

    const list = await api.listOpenings(owner);
    expect(list.status(), await list.text()).toBe(200);
    expect((await list.json()).openings).toMatchObject([
      { opening_number: 1, state: "draft", title: "Engineer" },
    ]);

    const summary = await api.openingSummary(owner);
    expect(summary.status(), await summary.text()).toBe(200);
    expect((await summary.json()).quota).toMatchObject({ limit: 25, used: 1 });

    const history = await api.listOpeningHistory(owner, { opening_number: 1 });
    expect(history.status(), await history.text()).toBe(200);
    expect((await history.json()).entries).toMatchObject([
      { action: "created", version: 1, actor_email: org.emailAddress },
    ]);

    const duplicateKey = orgsIdempotencyKey();
    const duplicateResponse = await api.duplicateOpening(
      owner,
      {
        opening_number: 1,
      },
      duplicateKey,
    );
    expect(duplicateResponse.status(), await duplicateResponse.text()).toBe(
      201,
    );
    const duplicate = (await duplicateResponse.json()) as OrgOpening;
    expect(duplicate).toMatchObject({
      opening_number: 2,
      state: "draft",
      version: 1,
      working_content: { title: "Engineer" },
      hiring_manager: { email: org.emailAddress, active: true },
      recruiter: { email: org.emailAddress, active: true },
    });
    const duplicateKeyConflict = await api.duplicateOpening(
      owner,
      {
        opening_number: 2,
      },
      duplicateKey,
    );
    expect(
      duplicateKeyConflict.status(),
      await duplicateKeyConflict.text(),
    ).toBe(409);
    expect((await duplicateKeyConflict.json()).type).toContain(
      "idempotency-key-conflict",
    );

    const invalidCreate = await api.createOpening(owner, {
      content: { title: "Invalid team" },
      team_member_emails: [`unknown@${org.domain}`],
    });
    expect(invalidCreate.status(), await invalidCreate.text()).toBe(422);
    expect((await invalidCreate.json()).type).toContain(
      "org-opening-hiring-team-invalid",
    );

    const saveKey = orgsIdempotencyKey();
    const savedResponse = await api.saveOpeningWorkingCopy(
      owner,
      {
        opening_number: 1,
        version: 1,
        content: { title: "Senior Engineer", description: "Build the product" },
      },
      saveKey,
    );
    expect(savedResponse.status(), await savedResponse.text()).toBe(200);
    const saved = (await savedResponse.json()) as OrgOpening;
    expect(saved).toMatchObject({
      version: 2,
      working_content: { title: "Senior Engineer" },
    });
    const saveKeyConflict = await api.saveOpeningWorkingCopy(
      owner,
      {
        opening_number: 1,
        version: 1,
        content: { title: "Different" },
      },
      saveKey,
    );
    expect(saveKeyConflict.status(), await saveKeyConflict.text()).toBe(409);
    expect((await saveKeyConflict.json()).type).toContain(
      "idempotency-key-conflict",
    );

    const staleResponse = await api.saveOpeningWorkingCopy(owner, {
      opening_number: 1,
      version: 1,
      content: { title: "Stale" },
    });
    expect(staleResponse.status(), await staleResponse.text()).toBe(409);
    expect((await staleResponse.json()).type).toContain(
      "org-opening-version-conflict",
    );

    const teamKey = orgsIdempotencyKey();
    const teamResponse = await api.setOpeningTeam(
      owner,
      {
        opening_number: 1,
        version: 2,
        hiring_manager_email: org.emailAddress,
        recruiter_email: org.emailAddress,
        team_member_emails: [org.emailAddress],
        internal_notes: "Private planning note",
      },
      teamKey,
    );
    expect(teamResponse.status(), await teamResponse.text()).toBe(200);
    const teamed = (await teamResponse.json()) as OrgOpening;
    expect(teamed).toMatchObject({
      version: 3,
      internal_notes: "Private planning note",
      team_members: [{ email: org.emailAddress, active: true }],
    });
    const teamKeyConflict = await api.setOpeningTeam(
      owner,
      {
        opening_number: 1,
        version: 2,
        team_member_emails: [],
      },
      teamKey,
    );
    expect(teamKeyConflict.status(), await teamKeyConflict.text()).toBe(409);
    expect((await teamKeyConflict.json()).type).toContain(
      "idempotency-key-conflict",
    );

    const staleTeam = await api.setOpeningTeam(owner, {
      opening_number: 1,
      version: 2,
      team_member_emails: [],
    });
    expect(staleTeam.status(), await staleTeam.text()).toBe(409);
    expect((await staleTeam.json()).type).toContain(
      "org-opening-version-conflict",
    );
    const staleDiscard = await api.discardOpening(owner, {
      opening_number: 1,
      version: 2,
    });
    expect(staleDiscard.status(), await staleDiscard.text()).toBe(409);
    expect((await staleDiscard.json()).type).toContain(
      "org-opening-version-conflict",
    );
    orgSQL(`INSERT INTO vetchium.org_opening_requests
      (org_opening_request_id, org_opening_id, request_kind, requested_by)
      SELECT gen_random_uuid(), org_opening_id, 'publish', created_by
      FROM vetchium.org_openings
      WHERE org_did = (SELECT org_did FROM vetchium.org_domains
        WHERE domain = '${org.domain}') AND opening_number = 1`);
    const pendingDiscard = await api.discardOpening(owner, {
      opening_number: 1,
      version: 3,
    });
    expect(pendingDiscard.status(), await pendingDiscard.text()).toBe(409);
    expect((await pendingDiscard.json()).type).toContain(
      "org-opening-request-pending",
    );
    orgSQL(`DELETE FROM vetchium.org_opening_requests
      WHERE org_opening_id = (SELECT org_opening_id FROM vetchium.org_openings
        WHERE org_did = (SELECT org_did FROM vetchium.org_domains
          WHERE domain = '${org.domain}') AND opening_number = 1)`);

    const discardKey = orgsIdempotencyKey();
    const discardedResponse = await api.discardOpening(
      owner,
      {
        opening_number: 1,
        version: 3,
      },
      discardKey,
    );
    expect(discardedResponse.status(), await discardedResponse.text()).toBe(
      200,
    );
    const discarded = (await discardedResponse.json()) as OrgOpening;
    expect(discarded).toMatchObject({
      opening_number: 1,
      state: "discarded",
      version: 4,
      team_members: [],
    });
    expect(discarded.working_content).toBeUndefined();
    expect(discarded.internal_notes).toBeUndefined();
    const discardKeyConflict = await api.discardOpening(
      owner,
      {
        opening_number: 1,
        version: 4,
      },
      discardKey,
    );
    expect(discardKeyConflict.status(), await discardKeyConflict.text()).toBe(
      409,
    );
    expect((await discardKeyConflict.json()).type).toContain(
      "idempotency-key-conflict",
    );
    const discardAgain = await api.discardOpening(owner, {
      opening_number: 1,
      version: 4,
    });
    expect(discardAgain.status(), await discardAgain.text()).toBe(409);
    expect((await discardAgain.json()).type).toContain(
      "org-opening-state-conflict",
    );
    const teamAfterDiscard = await api.setOpeningTeam(owner, {
      opening_number: 1,
      version: 4,
      team_member_emails: [],
    });
    expect(teamAfterDiscard.status(), await teamAfterDiscard.text()).toBe(409);
    expect((await teamAfterDiscard.json()).type).toContain(
      "org-opening-state-conflict",
    );

    const afterDiscard = await api.openingSummary(owner);
    expect(afterDiscard.status(), await afterDiscard.text()).toBe(200);
    expect((await afterDiscard.json()).quota).toMatchObject({
      limit: 25,
      used: 2,
    });

    const discardedList = await api.listOpenings(owner);
    expect(discardedList.status(), await discardedList.text()).toBe(200);
    expect((await discardedList.json()).openings).toMatchObject([
      { opening_number: 2 },
    ]);
    const filtered = await api.listOpenings(owner, { title_query: "ENGINEER" });
    expect(filtered.status(), await filtered.text()).toBe(200);
    expect((await filtered.json()).openings).toMatchObject([
      { opening_number: 2 },
    ]);

    const fullHistory = await api.listOpeningHistory(owner, {
      opening_number: 1,
    });
    expect(fullHistory.status(), await fullHistory.text()).toBe(200);
    expect(
      (await fullHistory.json()).entries.map(
        (entry: { action: string }) => entry.action,
      ),
    ).toEqual(["discarded", "team_changed", "working_copy_saved", "created"]);
    const duplicateDiscarded = await api.duplicateOpening(owner, {
      opening_number: 1,
    });
    expect(duplicateDiscarded.status(), await duplicateDiscarded.text()).toBe(
      409,
    );
    expect((await duplicateDiscarded.json()).type).toContain(
      "org-opening-state-conflict",
    );
    const saveDiscarded = await api.saveOpeningWorkingCopy(owner, {
      opening_number: 1,
      version: 4,
      content: { title: "Cannot edit" },
    });
    expect(saveDiscarded.status(), await saveDiscarded.text()).toBe(409);
    const missing = await api.getOpening(owner, { opening_number: 999 });
    expect(missing.status(), await missing.text()).toBe(404);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("revision copies can be saved and discarded without changing live content", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const created = await api.createOpening(owner, {
      content: {
        title: "Live job",
        description: "Build software",
        employing_country: "SG",
        work_arrangement: "on_site",
        employment_type: "full_time",
        positions: 1,
      },
      team_member_emails: [],
    });
    expect(created.status(), await created.text()).toBe(201);
    // A later task implements publication. Set up its committed database state
    // here to exercise this endpoint in isolation.
    orgSQL(`UPDATE vetchium.org_opening_contents SET slot = 'live'
      WHERE org_opening_id = (SELECT org_opening_id FROM vetchium.org_openings
        WHERE org_did = (SELECT org_did FROM vetchium.org_domains
          WHERE domain = '${org.domain}') AND opening_number = 1)`);
    orgSQL(`UPDATE vetchium.org_openings SET opening_state = 'published',
      first_published_at = now(), expires_at = now() + interval '180 days'
      WHERE org_did = (SELECT org_did FROM vetchium.org_domains
        WHERE domain = '${org.domain}') AND opening_number = 1`);
    const key = orgsIdempotencyKey();
    const savedResponse = await api.saveOpeningWorkingCopy(
      owner,
      {
        opening_number: 1,
        version: 1,
        content: { title: "Revision", description: "Private salary $123" },
      },
      key,
    );
    expect(savedResponse.status(), await savedResponse.text()).toBe(200);
    const saved = (await savedResponse.json()) as OrgOpening;
    expect(saved).toMatchObject({
      state: "published",
      version: 2,
      live_content: { title: "Live job" },
      working_content: {
        title: "Revision",
        employing_country: "SG",
        work_arrangement: "on_site",
        employment_type: "full_time",
        positions: 1,
      },
    });
    expect(orgAuditEventsByKey(key)).toHaveLength(1);
    expect(JSON.stringify(orgAuditEventsByKey(key))).not.toContain(
      "Private salary",
    );
    const staleDiscard = await api.discardOpeningWorkingCopy(owner, {
      opening_number: 1,
      version: 1,
    });
    expect(staleDiscard.status(), await staleDiscard.text()).toBe(409);
    expect((await staleDiscard.json()).type).toContain(
      "org-opening-version-conflict",
    );

    orgSQL(`INSERT INTO vetchium.org_opening_requests
      (org_opening_request_id, org_opening_id, request_kind, requested_by)
      SELECT gen_random_uuid(), org_opening_id, 'revise', created_by
      FROM vetchium.org_openings
      WHERE org_did = (SELECT org_did FROM vetchium.org_domains
        WHERE domain = '${org.domain}') AND opening_number = 1`);
    const frozenSave = await api.saveOpeningWorkingCopy(owner, {
      opening_number: 1,
      version: 2,
      content: { title: "Frozen" },
    });
    expect(frozenSave.status(), await frozenSave.text()).toBe(409);
    expect((await frozenSave.json()).type).toContain(
      "org-opening-request-pending",
    );
    const frozenDiscard = await api.discardOpeningWorkingCopy(owner, {
      opening_number: 1,
      version: 2,
    });
    expect(frozenDiscard.status(), await frozenDiscard.text()).toBe(409);
    orgSQL(`DELETE FROM vetchium.org_opening_requests
      WHERE org_opening_id = (SELECT org_opening_id FROM vetchium.org_openings
        WHERE org_did = (SELECT org_did FROM vetchium.org_domains
          WHERE domain = '${org.domain}') AND opening_number = 1)`);

    const discardKey = orgsIdempotencyKey();
    const discardedResponse = await api.discardOpeningWorkingCopy(
      owner,
      {
        opening_number: 1,
        version: 2,
      },
      discardKey,
    );
    expect(discardedResponse.status(), await discardedResponse.text()).toBe(
      200,
    );
    const discarded = (await discardedResponse.json()) as OrgOpening;
    expect(discarded).toMatchObject({
      state: "published",
      version: 3,
      live_content: { title: "Live job" },
    });
    expect(discarded.working_content).toBeUndefined();
    const discardKeyConflict = await api.discardOpeningWorkingCopy(
      owner,
      {
        opening_number: 1,
        version: 3,
      },
      discardKey,
    );
    expect(discardKeyConflict.status(), await discardKeyConflict.text()).toBe(
      409,
    );
    expect((await discardKeyConflict.json()).type).toContain(
      "idempotency-key-conflict",
    );
    const noWorkingCopy = await api.discardOpeningWorkingCopy(owner, {
      opening_number: 1,
      version: 3,
    });
    expect(noWorkingCopy.status(), await noWorkingCopy.text()).toBe(409);
    expect((await noWorkingCopy.json()).type).toContain(
      "org-opening-state-conflict",
    );
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("Opening reads and writes enforce visibility and permissions", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const created = await api.createOpening(owner, {
      content: { title: "Private role" },
      team_member_emails: [],
    });
    expect(created.status(), await created.text()).toBe(201);
    const reader = await addOrgMember(
      api,
      owner,
      org.domain,
      `reader@${org.domain}`,
    );
    const hidden = await api.getOpening(reader.token, { opening_number: 1 });
    expect(hidden.status(), await hidden.text()).toBe(404);
    const hiddenSummary = await api.openingSummary(reader.token);
    expect(hiddenSummary.status(), await hiddenSummary.text()).toBe(404);
    const denied = await api.setOpeningTeam(reader.token, {
      opening_number: 1,
      version: 1,
      team_member_emails: [],
    });
    expect(denied.status(), await denied.text()).toBe(403);
    expect((await denied.json()).type).toContain("org-permission-required");
    for (const [path, body] of [
      [
        "/create-opening",
        { content: { title: "Denied" }, team_member_emails: [] },
      ],
      ["/duplicate-opening", { opening_number: 1 }],
      [
        "/save-opening-working-copy",
        { opening_number: 1, version: 1, content: {} },
      ],
      ["/discard-opening-working-copy", { opening_number: 1, version: 1 }],
      ["/discard-opening", { opening_number: 1, version: 1 }],
    ] as const) {
      const forbidden = await api.post(path, body, {
        token: reader.token,
        idempotencyKey: orgsIdempotencyKey(),
      });
      expect(forbidden.status(), `${path}: ${await forbidden.text()}`).toBe(
        403,
      );
      expect((await forbidden.json()).type).toContain(
        "org-permission-required",
      );
    }

    const assigned = await api.setOpeningTeam(owner, {
      opening_number: 1,
      version: 1,
      team_member_emails: [reader.emailAddress],
    });
    expect(assigned.status(), await assigned.text()).toBe(200);
    const visible = await api.getOpening(reader.token, { opening_number: 1 });
    expect(visible.status(), await visible.text()).toBe(200);
    const invalid = await api.setOpeningTeam(owner, {
      opening_number: 1,
      version: 2,
      team_member_emails: [`missing@${org.domain}`],
    });
    expect(invalid.status(), await invalid.text()).toBe(422);
    expect((await invalid.json()).type).toContain(
      "org-opening-hiring-team-invalid",
    );
    const unknownWithInvalidTeam = await api.setOpeningTeam(owner, {
      opening_number: 999,
      version: 1,
      team_member_emails: [`missing@${org.domain}`],
    });
    expect(
      unknownWithInvalidTeam.status(),
      await unknownWithInvalidTeam.text(),
    ).toBe(404);

    const viewOnly = await addOrgMember(
      api,
      owner,
      org.domain,
      `viewer@${org.domain}`,
      ["org:view_openings"],
    );
    const allVisible = await api.listOpenings(viewOnly.token);
    expect(allVisible.status(), await allVisible.text()).toBe(200);
    expect((await allVisible.json()).openings).toMatchObject([
      { opening_number: 1 },
    ]);
    const viewWrite = await api.setOpeningTeam(viewOnly.token, {
      opening_number: 1,
      version: 2,
      team_member_emails: [],
    });
    expect(viewWrite.status(), await viewWrite.text()).toBe(403);

    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const managed = await api.setOpeningTeam(manager.token, {
      opening_number: 1,
      version: 2,
      team_member_emails: [reader.emailAddress],
    });
    expect(managed.status(), await managed.text()).toBe(200);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("the Free quota admits one concurrent final draft and replays use no slot", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    orgSQL(`INSERT INTO vetchium.org_openings
      (org_opening_id, org_did, opening_number, created_by)
      SELECT gen_random_uuid(), o.org_did, n, u.org_user_id
      FROM vetchium.orgs AS o
      JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
      JOIN vetchium.org_users AS u ON u.org_did = o.org_did
      CROSS JOIN generate_series(1, 24) AS n
      WHERE d.domain = '${org.domain}' AND u.email_address = '${org.emailAddress}'`);
    orgSQL(`UPDATE vetchium.orgs SET next_opening_number = 25
      WHERE org_did = (SELECT org_did FROM vetchium.org_domains
        WHERE domain = '${org.domain}')`);
    const body = { content: { title: "Final slot" }, team_member_emails: [] };
    const keyA = orgsIdempotencyKey();
    const keyB = orgsIdempotencyKey();
    const [a, b] = await Promise.all([
      api.createOpening(owner, body, keyA),
      api.createOpening(owner, body, keyB),
    ]);
    expect([a.status(), b.status()].sort()).toEqual([201, 409]);
    const winnerKey = a.status() === 201 ? keyA : keyB;
    const winner = a.status() === 201 ? a : b;
    const loser = a.status() === 409 ? a : b;
    expect((await loser.json()).type).toContain("org-openings-quota-exceeded");
    const opening = (await winner.json()) as OrgOpening;
    expect(opening.opening_number).toBe(25);
    const replay = await api.createOpening(owner, body, winnerKey);
    expect(replay.status(), await replay.text()).toBe(201);
    expect(await replay.json()).toEqual(opening);
    expect(orgAuditEventsByKey(winnerKey)).toHaveLength(1);
    const duplicateAtQuota = await api.duplicateOpening(owner, {
      opening_number: 25,
    });
    expect(duplicateAtQuota.status(), await duplicateAtQuota.text()).toBe(409);
    expect((await duplicateAtQuota.json()).type).toContain(
      "org-openings-quota-exceeded",
    );
    const discarded = await api.discardOpening(owner, {
      opening_number: 25,
      version: 1,
    });
    expect(discarded.status(), await discarded.text()).toBe(200);
    const afterDiscard = await api.createOpening(owner, body);
    expect(afterDiscard.status(), await afterDiscard.text()).toBe(409);
    const summary = await api.openingSummary(owner);
    expect((await summary.json()).quota).toMatchObject({ limit: 25, used: 25 });
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("writes bind idempotency keys and suspended Orgs cannot read or write", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const key = orgsIdempotencyKey();
    const created = await api.createOpening(
      owner,
      {
        content: { title: "First" },
        team_member_emails: [],
      },
      key,
    );
    expect(created.status(), await created.text()).toBe(201);
    const conflict = await api.createOpening(
      owner,
      {
        content: { title: "Changed" },
        team_member_emails: [],
      },
      key,
    );
    expect(conflict.status(), await conflict.text()).toBe(409);
    expect((await conflict.json()).type).toContain("idempotency-key-conflict");

    const routes: { path: string; body: object; write: boolean }[] = [
      {
        path: "/create-opening",
        body: { content: { title: "New" }, team_member_emails: [] },
        write: true,
      },
      { path: "/duplicate-opening", body: { opening_number: 1 }, write: true },
      { path: "/get-opening", body: { opening_number: 1 }, write: false },
      { path: "/list-openings", body: {}, write: false },
      { path: "/opening-summary", body: {}, write: false },
      {
        path: "/save-opening-working-copy",
        body: { opening_number: 1, version: 1, content: {} },
        write: true,
      },
      {
        path: "/discard-opening-working-copy",
        body: { opening_number: 1, version: 1 },
        write: true,
      },
      {
        path: "/set-opening-team",
        body: { opening_number: 1, version: 1, team_member_emails: [] },
        write: true,
      },
      {
        path: "/discard-opening",
        body: { opening_number: 1, version: 1 },
        write: true,
      },
      {
        path: "/request-opening-change",
        body: { opening_number: 1, version: 1, kind: "publish" },
        write: true,
      },
      {
        path: "/decide-opening-request",
        body: { opening_number: 1, version: 1, decision: "approve" },
        write: true,
      },
      {
        path: "/withdraw-opening-request",
        body: { opening_number: 1, version: 1 },
        write: true,
      },
      {
        path: "/list-opening-history",
        body: { opening_number: 1 },
        write: false,
      },
    ];
    for (const route of routes) {
      const unauthenticated = await api.post(route.path, route.body, {
        ...(route.write ? { idempotencyKey: orgsIdempotencyKey() } : {}),
      });
      expect(
        unauthenticated.status(),
        `${route.path}: ${await unauthenticated.text()}`,
      ).toBe(401);
      const malformed = await request.post(
        `${api.origin}/api/orgs${route.path}`,
        {
          data: "{",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${owner}`,
            ...(route.write ? { "Idempotency-Key": orgsIdempotencyKey() } : {}),
          },
        },
      );
      expect(
        malformed.status(),
        `${route.path}: ${await malformed.text()}`,
      ).toBe(400);
    }
    const invalidBodies: { path: string; body: object; write: boolean }[] = [
      {
        path: "/create-opening",
        body: { content: null, team_member_emails: [] },
        write: true,
      },
      { path: "/duplicate-opening", body: { opening_number: 0 }, write: true },
      { path: "/get-opening", body: { opening_number: 0 }, write: false },
      { path: "/list-openings", body: { title_query: "x" }, write: false },
      {
        path: "/save-opening-working-copy",
        body: { opening_number: 1, version: 0, content: {} },
        write: true,
      },
      {
        path: "/discard-opening-working-copy",
        body: { opening_number: 1, version: 0 },
        write: true,
      },
      {
        path: "/set-opening-team",
        body: { opening_number: 0, version: 1, team_member_emails: [] },
        write: true,
      },
      {
        path: "/discard-opening",
        body: { opening_number: 1, version: 0 },
        write: true,
      },
      {
        path: "/request-opening-change",
        body: { opening_number: 1, version: 1, kind: "unknown" },
        write: true,
      },
      {
        path: "/decide-opening-request",
        body: { opening_number: 1, version: 1, decision: "reject" },
        write: true,
      },
      {
        path: "/withdraw-opening-request",
        body: { opening_number: 1, version: 0 },
        write: true,
      },
      {
        path: "/list-opening-history",
        body: { opening_number: 0 },
        write: false,
      },
    ];
    for (const route of invalidBodies) {
      const invalid = await api.post(route.path, route.body, {
        token: owner,
        ...(route.write ? { idempotencyKey: orgsIdempotencyKey() } : {}),
      });
      expect(invalid.status(), `${route.path}: ${await invalid.text()}`).toBe(
        400,
      );
      expect((await invalid.json()).type).toContain("validation-failed");
    }
    for (const path of ["/list-openings", "/list-opening-history"]) {
      const invalidCursor = await api.post(
        path,
        path === "/list-openings"
          ? { pagination_key: "not-signed" }
          : { opening_number: 1, pagination_key: "not-signed" },
        { token: owner },
      );
      expect(invalidCursor.status(), await invalidCursor.text()).toBe(400);
      expect((await invalidCursor.json()).type).toContain(
        "invalid-pagination-key",
      );
    }
    for (const route of routes.filter((item) =>
      [
        "/duplicate-opening",
        "/get-opening",
        "/save-opening-working-copy",
        "/discard-opening-working-copy",
        "/set-opening-team",
        "/discard-opening",
        "/request-opening-change",
        "/decide-opening-request",
        "/withdraw-opening-request",
        "/list-opening-history",
      ].includes(item.path),
    )) {
      const absent = await api.post(
        route.path,
        { ...route.body, opening_number: 999 },
        {
          token: owner,
          ...(route.write ? { idempotencyKey: orgsIdempotencyKey() } : {}),
        },
      );
      expect(absent.status(), `${route.path}: ${await absent.text()}`).toBe(
        404,
      );
    }

    orgSQL(`UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
      WHERE org_did = (SELECT org_did FROM vetchium.org_domains
        WHERE domain = '${org.domain}')`);
    const read = await api.getOpening(owner, { opening_number: 1 });
    expect(read.status(), await read.text()).toBe(403);
    expect((await read.json()).type).toContain("org-suspended");
    for (const route of routes) {
      const blocked = await api.post(route.path, route.body, {
        token: owner,
        ...(route.write ? { idempotencyKey: orgsIdempotencyKey() } : {}),
      });
      expect(blocked.status(), `${route.path}: ${await blocked.text()}`).toBe(
        403,
      );
    }
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
