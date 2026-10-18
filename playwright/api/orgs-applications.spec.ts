import { expect } from "@playwright/test";
import type {
  ApplicationCounts,
  ApplicationDetail,
  ApplicationHistoryEntry,
  ApplicationState,
  ListApplicationHistoryResponse,
  ListApplicationsRequest,
  ListApplicationsResponse,
  StageStatus,
} from "typespec/orgs/applications/applications";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { sqlLiteral } from "../lib/admin-db.ts";
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

type Api = OrgsAPI;

async function withOrg(
  request: ConstructorParameters<typeof OrgsAPI>[0],
  body: (
    api: Api,
    owner: string,
    org: Awaited<ReturnType<typeof signupOrg>>,
  ) => Promise<void>,
): Promise<void> {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    await body(api, await loginOrg(api, org), org);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
}

async function newOpening(api: Api, token: string): Promise<OrgOpening> {
  const response = await api.createOpening(token, {
    content: { title: "Engineer" },
    team_member_emails: [],
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as OrgOpening;
}

/** Replaces the default pipeline with Screen, Panel, and Final stages. */
async function threeStagePipeline(
  api: Api,
  token: string,
  opening: OrgOpening,
): Promise<PipelineStage[]> {
  const response = await api.replaceOpeningPipeline(token, {
    opening_number: opening.opening_number,
    version: opening.version,
    stages: [
      { name: "Screen", kind: "review" },
      { name: "Panel", kind: "interview" },
      { name: "Final", kind: "interview" },
    ],
  });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { stages: PipelineStage[] }).stages;
}

const orgDID = (domain: string) =>
  `(SELECT org_did FROM vetchium.org_domains WHERE domain = ${sqlLiteral(domain)})`;

/**
 * Inserts an application the way hub-apply would have, because the Hub side
 * that sends it is a later task. Returns its number.
 */
function seedApplication(
  domain: string,
  openingNumber: number,
  options: {
    name: string;
    state?: ApplicationState;
    stageId?: string;
    coverNote?: string;
    country?: string;
  },
): number {
  const state = options.state ?? "submitted";
  const stage = options.stageId ? sqlLiteral(options.stageId) : "NULL";
  const note = options.coverNote ? sqlLiteral(options.coverNote) : "NULL";
  return Number(
    orgSQL(`
    WITH o AS (
      SELECT org_opening_id, org_did, next_application_number
      FROM vetchium.org_openings
      WHERE org_did = ${orgDID(domain)} AND opening_number = ${openingNumber}
    ), applicant AS (
      INSERT INTO vetchium.org_applicants
        (org_applicant_id, org_did, applicant_kind, hub_user_did)
      SELECT gen_random_uuid(), o.org_did, 'hub_user', gen_random_uuid()
      FROM o RETURNING org_applicant_id
    ), application AS (
      INSERT INTO vetchium.org_applications (
        org_application_id, org_opening_id, application_number,
        org_applicant_id, application_state, snapshot, cover_note,
        current_stage_id
      )
      SELECT gen_random_uuid(), o.org_opening_id, o.next_application_number,
        applicant.org_applicant_id, ${sqlLiteral(state)},
        jsonb_build_object('display_name', ${sqlLiteral(options.name)}::text,
          'handle', 'abcd1234-0123456789a'::text,
          'resident_country', ${sqlLiteral(options.country ?? "GB")}::text,
          'biography', 'Wrote the first program'::text,
          'websites', '[]'::jsonb, 'work_experiences', '[]'::jsonb,
          'certifications', '[]'::jsonb, 'language_abilities', '[]'::jsonb,
          'educational_qualifications', '[]'::jsonb),
        ${note}, ${stage}::uuid
      FROM o, applicant
      RETURNING org_application_id, application_number
    ), counter AS (
      UPDATE vetchium.org_openings
      SET next_application_number = next_application_number + 1
      WHERE org_opening_id IN (SELECT org_opening_id FROM o)
      RETURNING org_opening_id
    ), history AS (
      INSERT INTO vetchium.org_application_history (
        org_application_history_id, org_application_id, action, actor_kind,
        application_state, application_version
      )
      SELECT gen_random_uuid(), org_application_id, 'applied', 'applicant',
        'submitted', 1
      FROM application RETURNING 1
    )
    SELECT application_number FROM application
      WHERE (SELECT count(*) FROM counter) = 1
        AND (SELECT count(*) FROM history) = 1`),
  );
}

function seedStageRecord(
  domain: string,
  openingNumber: number,
  applicationNumber: number,
  stageId: string,
  status: StageStatus,
): void {
  orgSQL(`INSERT INTO vetchium.org_application_stages
    (org_application_id, org_opening_stage_id, stage_status)
    SELECT a.org_application_id, ${sqlLiteral(stageId)}::uuid,
      ${sqlLiteral(status)}
    FROM vetchium.org_applications AS a
    JOIN vetchium.org_openings AS o USING (org_opening_id)
    WHERE o.org_did = ${orgDID(domain)} AND o.opening_number = ${openingNumber}
      AND a.application_number = ${applicationNumber}`);
}

function seedHistory(
  domain: string,
  openingNumber: number,
  applicationNumber: number,
  action: string,
  state: ApplicationState,
  version: number,
  secondsAfterApply: number,
  actorEmail?: string,
): void {
  const actor = actorEmail
    ? `(SELECT org_user_id FROM vetchium.org_users WHERE email_address = ${sqlLiteral(actorEmail)})`
    : "NULL";
  orgSQL(`INSERT INTO vetchium.org_application_history (
      org_application_history_id, org_application_id, action, actor_kind,
      actor_org_user_id, application_state, application_version, created_at
    )
    SELECT gen_random_uuid(), a.org_application_id, ${sqlLiteral(action)},
      ${actorEmail ? "'org_user'" : "'system'"}, ${actor},
      ${sqlLiteral(state)}, ${version},
      a.created_at + interval '${secondsAfterApply} seconds'
    FROM vetchium.org_applications AS a
    JOIN vetchium.org_openings AS o USING (org_opening_id)
    WHERE o.org_did = ${orgDID(domain)} AND o.opening_number = ${openingNumber}
      AND a.application_number = ${applicationNumber}`);
}

async function list(
  api: Api,
  token: string,
  request: ListApplicationsRequest,
): Promise<ListApplicationsResponse> {
  const response = await api.listApplications(token, request);
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ListApplicationsResponse;
}

const numbers = (page: ListApplicationsResponse) =>
  page.applications.map((item) => item.application_number);

test("the Applicants view lists submitted applications newest first", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const opening = await newOpening(api, owner);
    const stages = await threeStagePipeline(api, owner, opening);
    const n = opening.opening_number;
    const stage = stages[0]?.id;
    if (!stage) throw new Error("expected a stage");
    const first = seedApplication(org.domain, n, { name: "Ada Lovelace" });
    seedApplication(org.domain, n, { name: "Grace Hopper", country: "US" });
    seedApplication(org.domain, n, {
      name: "Alan Turing",
      state: "in_pipeline",
      stageId: stage,
    });
    expect(first).toBe(1);

    const page = await list(api, owner, {
      opening_number: n,
      view: "applicants",
    });
    expect(numbers(page)).toEqual([2, 1]);
    expect(page.applications[0]).toMatchObject({
      application_number: 2,
      state: "submitted",
      version: 1,
      display_name: "Grace Hopper",
      resident_country: "US",
    });
    expect(page.applications[0]?.current_stage).toBeUndefined();
    expect(page.applications[0]?.submitted_at).toMatch(/Z$/);
    expect(page.next_pagination_key).toBeUndefined();
  });
});

test("the Candidates view lists live candidacies and filters by state, stage, and name", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const opening = await newOpening(api, owner);
    const [screen, panel] = await threeStagePipeline(api, owner, opening);
    if (!screen || !panel) throw new Error("expected three stages");
    const n = opening.opening_number;
    seedApplication(org.domain, n, { name: "Ada Lovelace" }); // 1 submitted
    seedApplication(org.domain, n, {
      name: "Alan Turing",
      state: "in_pipeline",
      stageId: screen.id,
    }); // 2
    seedApplication(org.domain, n, {
      name: "Ada Byron",
      state: "in_pipeline",
      stageId: panel.id,
    }); // 3
    seedApplication(org.domain, n, {
      name: "Edsger Dijkstra",
      state: "joined",
      stageId: panel.id,
    }); // 4
    seedApplication(org.domain, n, {
      name: "Barbara Liskov",
      state: "withdrawn",
    }); // 5
    seedApplication(org.domain, n, {
      name: "Donald Knuth",
      state: "offered",
      stageId: panel.id,
    }); // 6

    const candidates = { opening_number: n, view: "candidates" as const };
    // Default: live candidacies only, never submitted or terminal ones.
    expect(numbers(await list(api, owner, candidates))).toEqual([6, 3, 2]);
    const first = (await list(api, owner, candidates)).applications.at(-1);
    expect(first).toMatchObject({
      state: "in_pipeline",
      current_stage: { id: screen.id, name: "Screen", kind: "review" },
    });

    expect(
      numbers(
        await list(api, owner, {
          ...candidates,
          states: ["joined", "withdrawn"],
        }),
      ),
    ).toEqual([5, 4]);
    expect(
      numbers(await list(api, owner, { ...candidates, stage_id: panel.id })),
    ).toEqual([6, 3]);
    expect(
      numbers(
        await list(api, owner, {
          ...candidates,
          stage_id: panel.id,
          states: ["joined", "in_pipeline"],
        }),
      ),
    ).toEqual([4, 3]);
    // A withdrawn applicant has no stage, so a stage filter never lists one.
    expect(
      numbers(
        await list(api, owner, {
          ...candidates,
          stage_id: screen.id,
          states: ["withdrawn"],
        }),
      ),
    ).toEqual([]);

    // The name search is a case-insensitive substring of the display name and
    // composes with the view's own state set.
    expect(
      numbers(await list(api, owner, { ...candidates, name_query: "ADA" })),
    ).toEqual([3]);
    expect(
      numbers(
        await list(api, owner, {
          opening_number: n,
          view: "applicants",
          name_query: "ada",
        }),
      ),
    ).toEqual([1]);
    expect(
      numbers(await list(api, owner, { ...candidates, name_query: "lov" })),
    ).toEqual([]);
    expect(
      numbers(
        await list(api, owner, { ...candidates, name_query: "  turing " }),
      ),
    ).toEqual([2]);
  });
});

test("application lists are keyset paginated and bind their filters", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const opening = await newOpening(api, owner);
    const n = opening.opening_number;
    for (const name of ["Ann", "Bob", "Cat", "Dee", "Eve"]) {
      seedApplication(org.domain, n, { name: `${name} Example` });
    }
    const base = { opening_number: n, view: "applicants" as const };
    const seen: number[] = [];
    let key: string | undefined;
    let pages = 0;
    do {
      const page = await list(api, owner, {
        ...base,
        limit: 2,
        ...(key ? { pagination_key: key } : {}),
      });
      seen.push(...numbers(page));
      key = page.next_pagination_key;
      pages += 1;
    } while (key && pages < 6);
    expect(pages).toBe(3);
    expect(seen).toEqual([5, 4, 3, 2, 1]);

    // A page that ends exactly at the limit has no further key.
    const exact = await list(api, owner, { ...base, limit: 5 });
    expect(numbers(exact)).toEqual([5, 4, 3, 2, 1]);
    expect(exact.next_pagination_key).toBeUndefined();

    const firstPage = await list(api, owner, { ...base, limit: 2 });
    const cursor = firstPage.next_pagination_key;
    if (!cursor) throw new Error("expected a pagination key");
    for (const [label, changed] of [
      [
        "another filter",
        { ...base, name_query: "Ann", pagination_key: cursor },
      ],
      [
        "another view",
        { ...base, view: "candidates" as const, pagination_key: cursor },
      ],
      [
        "another Opening",
        { ...base, opening_number: n + 1, pagination_key: cursor },
      ],
      ["a forged key", { ...base, pagination_key: `${cursor}x` }],
    ] as const) {
      const response = await api.listApplications(owner, changed);
      expect(response.status(), `${label}: ${await response.text()}`).toBe(400);
      expect((await response.json()).type).toContain("invalid-pagination-key");
    }
    // The key resumes after the last application of the first page.
    const second = await list(api, owner, {
      ...base,
      limit: 2,
      pagination_key: cursor,
    });
    expect(numbers(second)).toEqual([3, 2]);
  });
});

test("stage and state counts cover every state and stage", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const opening = await newOpening(api, owner);
    const [screen, panel, final] = await threeStagePipeline(
      api,
      owner,
      opening,
    );
    if (!screen || !panel || !final) throw new Error("expected three stages");
    const n = opening.opening_number;
    seedApplication(org.domain, n, { name: "One" });
    seedApplication(org.domain, n, { name: "Two" });
    seedApplication(org.domain, n, {
      name: "Three",
      state: "in_pipeline",
      stageId: screen.id,
    });
    seedApplication(org.domain, n, {
      name: "Four",
      state: "offered",
      stageId: panel.id,
    });
    seedApplication(org.domain, n, {
      name: "Five",
      state: "in_pipeline",
      stageId: panel.id,
    });
    seedApplication(org.domain, n, {
      name: "Six",
      state: "joined",
      stageId: panel.id,
    });

    const response = await api.getApplicationCounts(owner, {
      opening_number: n,
    });
    expect(response.status(), await response.text()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const counts = (await response.json()) as ApplicationCounts;
    expect(counts.opening_number).toBe(n);
    expect(counts.states).toEqual([
      { state: "submitted", count: 2 },
      { state: "in_pipeline", count: 2 },
      { state: "offered", count: 1 },
      { state: "offer_accepted", count: 0 },
      { state: "offer_declined", count: 0 },
      { state: "joined", count: 1 },
      { state: "did_not_join", count: 0 },
      { state: "not_progressing", count: 0 },
      { state: "withdrawn", count: 0 },
    ]);
    // A stage counts only the candidacies at it, in pipeline order; the
    // joined application no longer occupies Panel.
    expect(counts.stages).toEqual([
      { stage: screen, count: 1 },
      { stage: panel, count: 2 },
      { stage: final, count: 0 },
    ]);

    const empty = await newOpening(api, owner);
    const emptyCounts = (await (
      await api.getApplicationCounts(owner, {
        opening_number: empty.opening_number,
      })
    ).json()) as ApplicationCounts;
    expect(emptyCounts.states.every((item) => item.count === 0)).toBe(true);
    expect(emptyCounts.states).toHaveLength(9);
    expect(emptyCounts.stages).toHaveLength(1);
  });
});

test("an application shows its snapshot, cover note, stages, dates, and history", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const opening = await newOpening(api, owner);
    const [screen, panel, final] = await threeStagePipeline(
      api,
      owner,
      opening,
    );
    if (!screen || !panel || !final) throw new Error("expected three stages");
    const n = opening.opening_number;
    const number = seedApplication(org.domain, n, {
      name: "Ada Lovelace",
      state: "in_pipeline",
      stageId: panel.id,
      coverNote: "I would love to join.",
    });
    seedStageRecord(org.domain, n, number, screen.id, "skipped");
    seedStageRecord(org.domain, n, number, panel.id, "pending");
    seedStageRecord(org.domain, n, number, final.id, "pending");
    const plain = seedApplication(org.domain, n, { name: "No Note" });

    const response = await api.getApplication(owner, {
      opening_number: n,
      application_number: number,
    });
    expect(response.status(), await response.text()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const detail = (await response.json()) as ApplicationDetail;
    expect(detail).toMatchObject({
      opening_number: n,
      application_number: number,
      state: "in_pipeline",
      version: 1,
      cover_note: "I would love to join.",
      current_stage: panel,
      snapshot: {
        display_name: "Ada Lovelace",
        handle: "abcd1234-0123456789a",
        resident_country: "GB",
        biography: "Wrote the first program",
        websites: [],
        work_experiences: [],
        certifications: [],
        language_abilities: [],
        educational_qualifications: [],
      },
    });
    expect(detail.snapshot).not.toHaveProperty("profile_picture_url");
    expect(detail.stage_records).toEqual([
      { stage: screen, status: "skipped" },
      { stage: panel, status: "pending" },
      { stage: final, status: "pending" },
    ]);
    expect(detail.submitted_at).toMatch(/Z$/);
    expect(detail.updated_at).toMatch(/Z$/);

    const submitted = (await (
      await api.getApplication(owner, {
        opening_number: n,
        application_number: plain,
      })
    ).json()) as ApplicationDetail;
    expect(submitted.cover_note).toBeUndefined();
    expect(submitted.current_stage).toBeUndefined();
    expect(submitted.stage_records).toEqual([]);

    for (const absent of [
      { opening_number: n, application_number: 99 },
      { opening_number: n + 50, application_number: 1 },
    ]) {
      const missing = await api.getApplication(owner, absent);
      expect(missing.status(), await missing.text()).toBe(404);
      expect((await missing.json()).type).toContain(
        "org-application-not-found",
      );
    }
  });
});

test("application history is newest first, keyset paginated, and names Org actors", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const opening = await newOpening(api, owner);
    const n = opening.opening_number;
    const number = seedApplication(org.domain, n, { name: "Ada Lovelace" });
    seedHistory(
      org.domain,
      n,
      number,
      "shortlisted",
      "in_pipeline",
      2,
      10,
      org.emailAddress,
    );
    seedHistory(
      org.domain,
      n,
      number,
      "not_progressing",
      "not_progressing",
      3,
      20,
    );

    const first = await api.listApplicationHistory(owner, {
      opening_number: n,
      application_number: number,
      limit: 2,
    });
    expect(first.status(), await first.text()).toBe(200);
    expect(first.headers()["cache-control"]).toBe("no-store");
    const page = (await first.json()) as ListApplicationHistoryResponse;
    expect(page.entries).toMatchObject([
      {
        action: "not_progressing",
        actor: "system",
        state: "not_progressing",
        version: 3,
      },
      {
        action: "shortlisted",
        actor: "org_user",
        actor_email: org.emailAddress,
        state: "in_pipeline",
        version: 2,
      },
    ]);
    expect(page.entries[0]).not.toHaveProperty("actor_email");
    expect(page.entries[0]?.created_at).toMatch(/Z$/);
    const key = page.next_pagination_key;
    if (!key) throw new Error("expected a pagination key");

    const rest = await api.listApplicationHistory(owner, {
      opening_number: n,
      application_number: number,
      limit: 2,
      pagination_key: key,
    });
    const last = (await rest.json()) as ListApplicationHistoryResponse;
    expect(last.entries).toMatchObject([
      { action: "applied", actor: "applicant", state: "submitted", version: 1 },
    ] satisfies Partial<ApplicationHistoryEntry>[]);
    expect(last.next_pagination_key).toBeUndefined();

    const other = seedApplication(org.domain, n, { name: "Other" });
    const foreign = await api.listApplicationHistory(owner, {
      opening_number: n,
      application_number: other,
      pagination_key: key,
    });
    expect(foreign.status(), await foreign.text()).toBe(400);
    expect((await foreign.json()).type).toContain("invalid-pagination-key");

    const missing = await api.listApplicationHistory(owner, {
      opening_number: n,
      application_number: 99,
    });
    expect(missing.status(), await missing.text()).toBe(404);
    expect((await missing.json()).type).toContain("org-application-not-found");
  });
});

test("only the Opening's team and org:manage_candidacies read its applications", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    // The free plan holds five users; this test needs ten.
    const upgraded = await api.setSubscriptionPlan(owner, {
      plan_oid: "org-silver-tier",
      billing_interval: "month",
    });
    expect(upgraded.status(), await upgraded.text()).toBe(200);
    const opening = await newOpening(api, owner);
    const other = await newOpening(api, owner);
    const member = (local: string, permissions: string[] = []) =>
      addOrgMember(
        api,
        owner,
        org.domain,
        `${local}@${org.domain}`,
        permissions,
      );
    const hiringManager = await member("hiring-manager");
    const recruiter = await member("recruiter");
    const teammate = await member("teammate");
    const candidacies = await member("candidacies", ["org:manage_candidacies"]);
    const viewer = await member("viewer", ["org:view_openings"]);
    const openingsManager = await member("openings", ["org:manage_openings"]);
    const approver = await member("approver", ["org:approve_openings"]);
    const plain = await member("plain");
    const otherManager = await member("other-manager");

    const team = await api.setOpeningTeam(owner, {
      opening_number: opening.opening_number,
      version: opening.version,
      hiring_manager_email: hiringManager.emailAddress,
      recruiter_email: recruiter.emailAddress,
      team_member_emails: [teammate.emailAddress],
    });
    expect(team.status(), await team.text()).toBe(200);
    const otherTeam = await api.setOpeningTeam(owner, {
      opening_number: other.opening_number,
      version: other.version,
      hiring_manager_email: otherManager.emailAddress,
      team_member_emails: [],
    });
    expect(otherTeam.status(), await otherTeam.text()).toBe(200);

    const n = opening.opening_number;
    const number = seedApplication(org.domain, n, { name: "Ada Lovelace" });
    const calls = (token: string) => [
      api.listApplications(token, { opening_number: n, view: "applicants" }),
      api.listApplications(token, { opening_number: n, view: "candidates" }),
      api.getApplication(token, {
        opening_number: n,
        application_number: number,
      }),
      api.getApplicationCounts(token, { opening_number: n }),
      api.listApplicationHistory(token, {
        opening_number: n,
        application_number: number,
      }),
    ];
    const statuses = async (token: string) =>
      Promise.all(
        calls(token).map(async (response) => {
          const done = await response;
          return done.status() === 404
            ? `404 ${(await done.json()).type}`
            : String(done.status());
        }),
      );
    const readable = ["200", "200", "200", "200", "200"];
    const refused = Array(5).fill(
      "404 vetchium-problem-details/org-application-not-found",
    );

    for (const allowed of [
      { token: owner, name: "the superadmin" },
      { token: hiringManager.token, name: "the hiring manager" },
      { token: recruiter.token, name: "the recruiter" },
      { token: teammate.token, name: "a hiring-team member" },
      { token: candidacies.token, name: "an org:manage_candidacies holder" },
    ]) {
      expect(await statuses(allowed.token), allowed.name).toEqual(readable);
    }
    for (const denied of [
      { token: viewer.token, name: "an org:view_openings holder" },
      { token: openingsManager.token, name: "an org:manage_openings holder" },
      { token: approver.token, name: "an org:approve_openings holder" },
      { token: plain.token, name: "a member with no grant" },
      { token: otherManager.token, name: "another Opening's hiring manager" },
    ]) {
      expect(await statuses(denied.token), denied.name).toEqual(refused);
    }
    // Seeing the Opening grants no access to its applications.
    const seen = await api.getOpening(viewer.token, { opening_number: n });
    expect(seen.status(), await seen.text()).toBe(200);

    // The check is made on every call, so a revoked grant stops at once on
    // the same session.
    const revoked = await api.setUserPermissions(owner, {
      email_address: candidacies.emailAddress,
      permissions: [],
    });
    expect(revoked.status(), await revoked.text()).toBe(204);
    expect(await statuses(candidacies.token)).toEqual(refused);
    // Taking the hiring manager off the Opening removes their access too.
    const removed = await api.setOpeningTeam(owner, {
      opening_number: n,
      version: (
        await (await api.getOpening(owner, { opening_number: n })).json()
      ).version,
      recruiter_email: recruiter.emailAddress,
      team_member_emails: [teammate.emailAddress],
    });
    expect(removed.status(), await removed.text()).toBe(200);
    expect(await statuses(hiringManager.token)).toEqual(refused);
    expect(await statuses(recruiter.token)).toEqual(readable);
  });
});

test("application routes authenticate, validate, and refuse suspended Orgs", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const opening = await newOpening(api, owner);
    const n = opening.opening_number;
    const number = seedApplication(org.domain, n, { name: "Ada Lovelace" });
    const routes: { path: string; body: object }[] = [
      {
        path: "/list-applications",
        body: { opening_number: n, view: "applicants" },
      },
      {
        path: "/get-application",
        body: { opening_number: n, application_number: number },
      },
      { path: "/get-application-counts", body: { opening_number: n } },
      {
        path: "/list-application-history",
        body: { opening_number: n, application_number: number },
      },
    ];
    for (const route of routes) {
      const unauthenticated = await api.post(route.path, route.body);
      expect(unauthenticated.status(), route.path).toBe(401);
      const malformed = await api.postRaw(route.path, "{", { token: owner });
      expect(malformed.status(), route.path).toBe(400);
      expect((await malformed.json()).type).toContain("invalid-json");
    }
    const invalid: { path: string; body: object; fields: string[] }[] = [
      {
        path: "/list-applications",
        body: { opening_number: 0, view: "x", limit: 0, name_query: "a" },
        fields: ["opening_number", "view", "name_query", "limit"],
      },
      {
        path: "/list-applications",
        body: { opening_number: n },
        fields: ["view"],
      },
      {
        path: "/list-applications",
        body: { opening_number: n, view: "applicants", states: ["joined"] },
        fields: ["states"],
      },
      {
        path: "/list-applications",
        body: { opening_number: n, view: "candidates", states: ["submitted"] },
        fields: ["states"],
      },
      {
        path: "/list-applications",
        body: {
          opening_number: n,
          view: "candidates",
          states: ["joined", "joined"],
        },
        fields: ["states"],
      },
      {
        path: "/list-applications",
        body: {
          opening_number: n,
          view: "applicants",
          stage_id: "00000000-0000-4000-8000-000000000000",
        },
        fields: ["stage_id"],
      },
      {
        path: "/list-applications",
        body: { opening_number: n, view: "candidates", stage_id: "NOT-A-UUID" },
        fields: ["stage_id"],
      },
      {
        path: "/list-applications",
        body: { opening_number: n, view: "applicants", limit: 101 },
        fields: ["limit"],
      },
      {
        path: "/list-applications",
        body: { opening_number: n, view: "applicants", pagination_key: "" },
        fields: ["pagination_key"],
      },
      {
        path: "/get-application",
        body: { opening_number: 0, application_number: 0 },
        fields: ["opening_number", "application_number"],
      },
      {
        path: "/get-application-counts",
        body: { opening_number: 0 },
        fields: ["opening_number"],
      },
      {
        path: "/list-application-history",
        body: { opening_number: n, application_number: 0, limit: 0 },
        fields: ["application_number", "limit"],
      },
    ];
    for (const route of invalid) {
      const response = await api.post(route.path, route.body, { token: owner });
      expect(response.status(), `${route.path}: ${await response.text()}`).toBe(
        400,
      );
      const body = await response.json();
      expect(body.type).toContain("validation-failed");
      expect(body.fields).toEqual(route.fields);
    }
    const unknown = await api.listApplications(owner, {
      opening_number: n + 40,
      view: "applicants",
    });
    expect(unknown.status(), await unknown.text()).toBe(404);
    expect((await unknown.json()).type).toContain("org-application-not-found");
    const unknownCounts = await api.getApplicationCounts(owner, {
      opening_number: n + 40,
    });
    expect(unknownCounts.status()).toBe(404);

    orgSQL(`UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
      WHERE org_did = ${orgDID(org.domain)}`);
    for (const route of routes) {
      const blocked = await api.post(route.path, route.body, { token: owner });
      expect(blocked.status(), `${route.path}: ${await blocked.text()}`).toBe(
        403,
      );
      expect((await blocked.json()).type).toContain("org-suspended");
    }
  });
});

test("removing a pipeline stage that holds a candidacy is refused", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const opening = await newOpening(api, owner);
    const [screen, panel, final] = await threeStagePipeline(
      api,
      owner,
      opening,
    );
    if (!screen || !panel || !final) throw new Error("expected three stages");
    const n = opening.opening_number;
    seedApplication(org.domain, n, {
      name: "At Panel",
      state: "in_pipeline",
      stageId: panel.id,
    });
    seedApplication(org.domain, n, {
      name: "Done At Final",
      state: "joined",
      stageId: final.id,
    });
    seedApplication(org.domain, n, { name: "Left Screen", state: "withdrawn" });

    const pipeline = async () =>
      (await (
        await api.getOpeningPipeline(owner, { opening_number: n })
      ).json()) as {
        version: number;
        stages: PipelineStage[];
      };
    const before = await pipeline();
    const refused = await api.replaceOpeningPipeline(owner, {
      opening_number: n,
      version: before.version,
      stages: [
        { id: screen.id, name: screen.name, kind: screen.kind },
        { id: final.id, name: final.name, kind: final.kind },
      ],
    });
    expect(refused.status(), await refused.text()).toBe(409);
    expect((await refused.json()).type).toContain("org-pipeline-stage-in-use");
    // Nothing changed: not the stages, not the version.
    expect(await pipeline()).toEqual(before);

    // Renaming and reordering a stage that holds a candidacy is allowed, and
    // so is removing stages that hold none, even one a finished application
    // sat at.
    const allowed = await api.replaceOpeningPipeline(owner, {
      opening_number: n,
      version: before.version,
      stages: [
        { id: panel.id, name: "Panel renamed", kind: panel.kind },
        { id: screen.id, name: screen.name, kind: screen.kind },
      ],
    });
    expect(allowed.status(), await allowed.text()).toBe(200);
    const after = await pipeline();
    expect(after.stages.map((stage) => stage.name)).toEqual([
      "Panel renamed",
      "Screen",
    ]);
    expect(after.version).toBe(before.version + 1);
    const joined = await list(api, owner, {
      opening_number: n,
      view: "candidates",
      states: ["joined"],
    });
    expect(joined.applications[0]).toMatchObject({
      display_name: "Done At Final",
    });
    expect(joined.applications[0]?.current_stage).toBeUndefined();
    const atPanel = await list(api, owner, {
      opening_number: n,
      view: "candidates",
      stage_id: panel.id,
    });
    expect(atPanel.applications[0]?.current_stage?.name).toBe("Panel renamed");

    // An unknown stage id is still a validation failure, ahead of the
    // stage-in-use refusal.
    const unknown = await api.replaceOpeningPipeline(owner, {
      opening_number: n,
      version: after.version,
      stages: [
        {
          id: "00000000-0000-4000-8000-000000000000",
          name: "Ghost",
          kind: "review",
        },
      ],
    });
    expect(unknown.status(), await unknown.text()).toBe(400);
    expect((await unknown.json()).type).toContain("validation-failed");
  });
});
