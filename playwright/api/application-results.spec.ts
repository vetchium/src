import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type {
  ApplicationReference,
  MyApplicationDetail,
  MyApplicationSummary,
} from "typespec/hub/applications/applications";
import type {
  ApplicationDetail,
  ApplicationHistoryEntry,
  ApplicationState,
  ListApplicationHistoryResponse,
  ListApplicationsResponse,
} from "typespec/orgs/applications/applications";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { expectProblem } from "../lib/admin-api.ts";
import {
  globalSQLScalar,
  sqlLiteral,
  type TestTenant,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  offerLetter,
  type SeededApplication,
  seedApplication,
} from "../lib/hiring-seed.ts";
import { hubIdempotencyKey } from "../lib/hub-api.ts";
import {
  type Applicant,
  cleanupApplicant,
  seedApplicant,
} from "../lib/hub-applicant.ts";
import {
  addOrgMember,
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgDID,
  orgSQL,
  orgsIdempotencyKey,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";

const PREFIX = "vetchium-problem-details/";
const NOT_FOUND = `${PREFIX}org-application-not-found`;
const VERSION_CONFLICT = `${PREFIX}org-application-version-conflict`;
const STATE_CONFLICT = `${PREFIX}org-application-state-conflict`;
const PERMISSION_REQUIRED = `${PREFIX}org-permission-required`;
const KEY_CONFLICT = `${PREFIX}idempotency-key-conflict`;
const VALIDATION = `${PREFIX}validation-failed`;
const HUB_STATE_CONFLICT = `${PREFIX}hub-application-state-conflict`;
const HUB_NOT_FOUND = `${PREFIX}hub-application-not-found`;

function content(title: string): OpeningContent {
  return {
    title,
    description: "Build reliable services",
    language: "en",
    employing_country: "SG",
    work_arrangement: "hybrid",
    employment_type: "full_time",
    positions: 1,
  };
}

function inFuture(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function cleanupOutbox(domain: string, tenant: TestTenant = "sgp"): void {
  const did = orgDID(domain, tenant);
  if (did === "") return;
  orgSQL(
    `DELETE FROM vetchium.federation_outbox
     WHERE aggregate_type = 'org_application'
       AND aggregate_id LIKE ${sqlLiteral(`${did}:%`)}`,
    tenant,
  );
}

interface World {
  request: APIRequestContext;
  tenant: TestTenant;
  api: OrgsAPI;
  org: SignedUpOrg;
  owner: string;
  did: string;
  applicants: Applicant[];
}

async function newOrg(
  request: APIRequestContext,
  tenant: TestTenant = "sgp",
): Promise<World> {
  const api = new OrgsAPI(request, tenant);
  const org = await signupOrg(api);
  const owner = await loginOrg(api, org);
  return {
    request,
    tenant,
    api,
    org,
    owner,
    did: orgDID(org.domain, tenant),
    applicants: [],
  };
}

async function removeOrg(world: World): Promise<void> {
  for (const applicant of world.applicants.splice(0)) {
    cleanupApplicant(applicant, [world]);
  }
  cleanupOutbox(world.org.domain, world.tenant);
  await deleteOrgVerificationRecord(world.org.domain);
  cleanupOrg(world.org.domain, world.tenant);
}

async function withOrg(
  request: APIRequestContext,
  body: (world: World) => Promise<void>,
): Promise<void> {
  const world = await newOrg(request);
  try {
    await body(world);
  } finally {
    await removeOrg(world);
  }
}

async function upgrade(world: World): Promise<void> {
  const upgraded = await world.api.setSubscriptionPlan(world.owner, {
    plan_oid: "org-silver-tier",
    billing_interval: "month",
  });
  expect(upgraded.status(), await upgraded.text()).toBe(200);
}

/** Applies through the Hub as a new applicant and walks the application to
 * state, at stageID for a candidacy; returns its number. */
async function seedAt(
  world: World,
  openingNumber: number,
  state: ApplicationState,
  stageID?: string,
): Promise<number> {
  return (await seedFor(world, openingNumber, state, stageID)).number;
}

async function seedFor(
  world: World,
  openingNumber: number,
  state: ApplicationState,
  stageID?: string,
): Promise<SeededApplication> {
  return seedApplication(
    {
      request: world.request,
      tenant: world.tenant,
      api: world.api,
      owner: world.owner,
      domain: world.org.domain,
      did: world.did,
      applicants: world.applicants,
    },
    openingNumber,
    { name: "Ada Lovelace", state, ...(stageID ? { stageId: stageID } : {}) },
  );
}

/** Runs sql against one interview of an application, as the table owner. */
async function detail(
  world: World,
  opening: number,
  application: number,
  token = world.owner,
): Promise<ApplicationDetail> {
  const response = await world.api.getApplication(token, {
    opening_number: opening,
    application_number: application,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as ApplicationDetail;
}

async function history(
  world: World,
  opening: number,
  application: number,
  token = world.owner,
): Promise<ApplicationHistoryEntry[]> {
  const response = await world.api.listApplicationHistory(token, {
    opening_number: opening,
    application_number: application,
  });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as ListApplicationHistoryResponse).entries;
}

// The Hub side: a real applicant, so commands and projection events travel
// between tenants.

async function withApplicant(
  request: APIRequestContext,
  applicantTenant: TestTenant,
  orgTenant: TestTenant,
  body: (applicant: Applicant, world: World) => Promise<void>,
): Promise<void> {
  const applicant = seedApplicant(request, applicantTenant);
  let world: World | undefined;
  try {
    world = await newOrg(request, orgTenant);
    await body(applicant, world);
  } finally {
    cleanupApplicant(applicant, world ? [world] : []);
    if (world) await removeOrg(world);
  }
}

/** Applies through the Hub and shortlists to the stage at index. */
async function shortlisted(
  applicant: Applicant,
  world: World,
  index = CHECKS,
): Promise<{
  reference: ApplicationReference;
  opening: number;
  stages: PipelineStage[];
}> {
  const { opening, stages } = await publishedOpening(world);
  const applied = await applicant.hub.applyToOpening(
    { domain: world.org.domain, opening_number: opening.opening_number },
    { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
  );
  expect(applied.status(), await applied.text()).toBe(201);
  const reference = (await applied.json()) as ApplicationReference;
  const shortlist = await world.api.shortlistApplication(world.owner, {
    opening_number: opening.opening_number,
    application_number: reference.application_number,
    version: 1,
    stage_id: stageOf(stages, index).id,
  });
  expect(shortlist.status(), await shortlist.text()).toBe(200);
  return { reference, opening: opening.opening_number, stages };
}

async function myApplication(
  applicant: Applicant,
  reference: ApplicationReference,
): Promise<MyApplicationDetail> {
  const response = await applicant.hub.getMyApplication(
    reference,
    applicant.token,
  );
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as MyApplicationDetail;
}

async function expectProjected(
  applicant: Applicant,
  reference: ApplicationReference,
  status: string,
  pendingActions: string[],
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await applicant.hub.findMyOpeningApplication(
          {
            domain: reference.domain,
            opening_number: reference.opening_number,
          },
          applicant.token,
        );
        if (response.status() !== 200) return undefined;
        const listed = (await response.json()) as MyApplicationSummary;
        return [listed.status, listed.pending_actions];
      },
      { timeout: 15_000 },
    )
    .toEqual([status, pendingActions]);
}

const STAGES = [
  { name: "Screen", kind: "review" },
  { name: "Assess", kind: "assessment" },
  { name: "Panel", kind: "interview" },
  { name: "Checks", kind: "background_check" },
] as const;

/** A published Opening whose pipeline is Screen (review), Assess
 * (assessment), Panel (interview), and Checks (background_check). */
async function publishedOpening(
  world: World,
  team: string[] = [],
): Promise<{ opening: OrgOpening; stages: PipelineStage[] }> {
  const { api, owner, org } = world;
  const created = await api.createOpening(owner, {
    content: content("Engineer"),
    hiring_manager_email: org.emailAddress,
    recruiter_email: org.emailAddress,
    team_member_emails: team,
  });
  expect(created.status(), await created.text()).toBe(201);
  const draft = (await created.json()) as OrgOpening;
  const published = await api.requestOpeningChange(owner, {
    opening_number: draft.opening_number,
    version: draft.version,
    kind: "publish",
  });
  expect(published.status(), await published.text()).toBe(200);
  const opening = (await published.json()) as OrgOpening;
  const replaced = await api.replaceOpeningPipeline(owner, {
    opening_number: opening.opening_number,
    version: opening.version,
    stages: STAGES.map((stage) => ({ ...stage })),
  });
  expect(replaced.status(), await replaced.text()).toBe(200);
  const stages = ((await replaced.json()) as { stages: PipelineStage[] })
    .stages;
  const reread = await api.getOpening(owner, {
    opening_number: opening.opening_number,
  });
  return { opening: (await reread.json()) as OrgOpening, stages };
}

function stageOf(stages: PipelineStage[], index: number): PipelineStage {
  const stage = stages[index];
  if (!stage) throw new Error(`expected stage ${index}`);
  return stage;
}

const ASSESS = 1;
const CHECKS = 3;

const REFERENCE = (opening: number, application: number, version: number) => ({
  opening_number: opening,
  application_number: application,
  version,
});

async function version(
  world: World,
  opening: number,
  application: number,
): Promise<number> {
  return (await detail(world, opening, application)).version;
}

/** Seeds an application from an unreachable applicant and shortlists it to
 * the stage, so it holds a pending record there. */
async function candidacyAt(
  world: World,
  opening: number,
  stages: PipelineStage[],
  index: number,
): Promise<number> {
  return (await candidacyFor(world, opening, stages, index)).number;
}

/** A candidacy shortlisted to the stage at index, with its applicant. */
async function candidacyFor(
  world: World,
  opening: number,
  stages: PipelineStage[],
  index: number,
): Promise<SeededApplication> {
  return seedFor(world, opening, "in_pipeline", stageOf(stages, index).id);
}

function stageStatus(application: ApplicationDetail, index: number): string {
  return (
    application.stage_records.find(
      (record) => record.stage.name === STAGES[index]?.name,
    )?.status ?? "missing"
  );
}

async function assess(
  world: World,
  opening: number,
  application: number,
  fields: Record<string, unknown>,
  token = world.owner,
) {
  return world.api.resultWriteRaw("record-assessment-result", token, {
    ...REFERENCE(
      opening,
      application,
      await version(world, opening, application),
    ),
    outcome: "pass",
    ...fields,
  });
}

async function askConsent(
  world: World,
  opening: number,
  application: number,
  types: string[] = ["identity", "drug"],
) {
  return world.api.requestBackgroundCheckConsent(world.owner, {
    ...REFERENCE(
      opening,
      application,
      await version(world, opening, application),
    ),
    check_types: types as never,
  });
}

async function recordCheck(
  world: World,
  opening: number,
  application: number,
  fields: Record<string, unknown>,
) {
  return world.api.resultWriteRaw(
    "record-background-check-result",
    world.owner,
    {
      ...REFERENCE(
        opening,
        application,
        await version(world, opening, application),
      ),
      check_type: "identity",
      outcome: "clear",
      ...fields,
    },
  );
}

test("an assessment result is recorded once, completes the stage, and honours its bounds", async ({
  request,
}) => {
  test.setTimeout(180_000);
  await withOrg(request, async (world) => {
    const { opening: published, stages } = await publishedOpening(world);
    const opening = published.opening_number;
    const application = await candidacyAt(world, opening, stages, ASSESS);
    const before = await detail(world, opening, application);
    expect(stageStatus(before, ASSESS)).toBe("pending");

    // Bounds and shapes are refused before anything is stored.
    for (const [fields, invalid] of [
      [{ outcome: "maybe" }, ["outcome"]],
      [{ score: 101 }, ["score"]],
      [{ score: -1 }, ["score"]],
      [{ notes: "x".repeat(2001) }, ["notes"]],
      [{ report_url: "http://reports.example.com/a" }, ["report_url"]],
    ] as const) {
      await expectProblem(
        await assess(world, opening, application, fields),
        400,
        VALIDATION,
        [...invalid],
      );
    }
    expect((await detail(world, opening, application)).assessments).toEqual([]);

    const key = orgsIdempotencyKey();
    const body = {
      ...REFERENCE(opening, application, before.version),
      outcome: "pass",
      score: 100,
      notes: "  Strong systems design ",
      report_url: "HTTPS://Reports.Example.com/a/",
    };
    const done = await world.api.resultWriteRaw(
      "record-assessment-result",
      world.owner,
      body,
      key,
    );
    expect(done.status(), await done.text()).toBe(200);
    expect(done.headers()["cache-control"]).toBe("no-store");
    const recorded = (await done.json()) as ApplicationDetail;
    expect(recorded.version).toBe(before.version + 1);
    expect(stageStatus(recorded, ASSESS)).toBe("completed");
    expect(recorded.assessments).toHaveLength(1);
    expect(recorded.assessments[0]).toMatchObject({
      stage: { name: "Assess", kind: "assessment" },
      outcome: "pass",
      score: 100,
      notes: "Strong systems design",
      report_url: "https://reports.example.com/a",
      recorded_by_email: world.org.emailAddress,
    });
    const replay = await world.api.resultWriteRaw(
      "record-assessment-result",
      world.owner,
      body,
      key,
    );
    expect(replay.status(), await replay.text()).toBe(200);
    expect((await replay.json()) as ApplicationDetail).toEqual(recorded);
    await expectProblem(
      await world.api.resultWriteRaw(
        "record-assessment-result",
        world.owner,
        { ...body, outcome: "fail" },
        key,
      ),
      409,
      KEY_CONFLICT,
    );

    // The stage is done, so a second result is refused.
    await expectProblem(
      await assess(world, opening, application, { outcome: "fail" }),
      409,
      STATE_CONFLICT,
    );
    const entries = await history(world, opening, application);
    expect(entries[0]).toMatchObject({
      action: "assessment_recorded",
      actor: "org_user",
      stage: { name: "Assess" },
    });
    expect(JSON.stringify(entries)).not.toContain("Strong systems");

    // Score 0, no notes, no link, and a blank note are all valid.
    for (const [fields, notes] of [
      [{ score: 0, outcome: "inconclusive" }, undefined],
      [{ notes: "   ", outcome: "fail" }, undefined],
    ] as const) {
      const other = await candidacyAt(world, opening, stages, ASSESS);
      const result = await assess(world, opening, other, fields);
      expect(result.status(), await result.text()).toBe(200);
      const stored = ((await result.json()) as ApplicationDetail)
        .assessments[0];
      expect(stored?.notes).toBe(notes);
    }
  });
});

test("result writes refuse the wrong stage, state, version, reader, and caller", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withOrg(request, async (world) => {
    const { api, owner, org } = world;
    await upgrade(world);
    const teammate = await addOrgMember(
      api,
      owner,
      org.domain,
      `teammate@${org.domain}`,
    );
    const outsider = await addOrgMember(
      api,
      owner,
      org.domain,
      `outsider@${org.domain}`,
    );
    const { opening: published, stages } = await publishedOpening(world, [
      teammate.emailAddress,
    ]);
    const opening = published.opening_number;
    const atAssess = await candidacyAt(world, opening, stages, ASSESS);
    const atChecks = await candidacyAt(world, opening, stages, CHECKS);
    const atPanel = await candidacyAt(world, opening, stages, 2);
    const submitted = await seedAt(world, opening, "submitted");

    // The wrong stage kind or state.
    await expectProblem(
      await assess(world, opening, atChecks, {}),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await assess(world, opening, atPanel, {}),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await assess(world, opening, submitted, {}),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await askConsent(world, opening, atAssess),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await askConsent(world, opening, atPanel),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await askConsent(world, opening, submitted),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await recordCheck(world, opening, atAssess, {}),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await recordCheck(world, opening, submitted, {}),
      409,
      STATE_CONFLICT,
    );

    // Version, unknown number, reader, and caller.
    const stale = { ...REFERENCE(opening, atAssess, 99), outcome: "pass" };
    await expectProblem(
      await api.resultWriteRaw("record-assessment-result", owner, stale),
      409,
      VERSION_CONFLICT,
    );
    await expectProblem(
      await api.resultWriteRaw("request-background-check-consent", owner, {
        ...REFERENCE(opening, atChecks, 99),
        check_types: ["identity"],
      }),
      409,
      VERSION_CONFLICT,
    );
    await expectProblem(
      await api.resultWriteRaw("record-background-check-result", owner, {
        ...REFERENCE(opening, atChecks, 99),
        check_type: "identity",
        outcome: "clear",
      }),
      409,
      VERSION_CONFLICT,
    );
    const cases = [
      [
        "record-assessment-result",
        { ...REFERENCE(opening, atAssess, 2), outcome: "pass" },
      ],
      [
        "request-background-check-consent",
        { ...REFERENCE(opening, atChecks, 2), check_types: ["identity"] },
      ],
      [
        "record-background-check-result",
        {
          ...REFERENCE(opening, atChecks, 2),
          check_type: "identity",
          outcome: "clear",
        },
      ],
    ] as const;
    for (const [operation, body] of cases) {
      await expectProblem(
        await api.resultWriteRaw(operation, owner, {
          ...body,
          application_number: atAssess + 100,
        }),
        404,
        NOT_FOUND,
      );
      await expectProblem(
        await api.resultWriteRaw(operation, teammate.token, body),
        403,
        PERMISSION_REQUIRED,
      );
      await expectProblem(
        await api.resultWriteRaw(operation, outsider.token, body),
        404,
        NOT_FOUND,
      );
      await expectProblem(
        await api.resultWriteRaw(operation, "not-a-token", body),
        401,
        `${PREFIX}org-authentication-required`,
      );
      await expectProblem(
        await api.postRaw(`/${operation}`, "{not json", {
          token: owner,
          idempotencyKey: orgsIdempotencyKey(),
        }),
        400,
        `${PREFIX}invalid-json`,
      );
      await expectProblem(
        await api.resultWriteRaw(operation, owner, { ...body, version: 0 }),
        400,
        VALIDATION,
        ["version"],
      );
    }
    // Nothing changed.
    expect((await detail(world, opening, atAssess)).assessments).toEqual([]);

    orgSQL(
      `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
       WHERE org_did = ${sqlLiteral(world.did)}::uuid`,
    );
    for (const [operation, body] of cases) {
      await expectProblem(
        await api.resultWriteRaw(operation, owner, body),
        403,
        `${PREFIX}org-suspended`,
      );
    }
  });
});

test("consent requests name valid check types, one active per stage, and gate recording", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withOrg(request, async (world) => {
    const { opening: published, stages } = await publishedOpening(world);
    const opening = published.opening_number;
    const { number: application, applicant } = await candidacyFor(
      world,
      opening,
      stages,
      CHECKS,
    );
    const reference = {
      domain: world.org.domain,
      opening_number: opening,
      application_number: application,
    };

    for (const types of [[], ["astrology"], ["identity", "identity"]]) {
      await expectProblem(
        await askConsent(world, opening, application, types),
        400,
        VALIDATION,
        ["check_types"],
      );
    }
    const key = orgsIdempotencyKey();
    const asked = await world.api.requestBackgroundCheckConsent(
      world.owner,
      {
        ...REFERENCE(
          opening,
          application,
          await version(world, opening, application),
        ),
        check_types: ["identity", "criminal"],
      },
      key,
    );
    expect(asked.status(), await asked.text()).toBe(200);
    const requested = (await asked.json()) as ApplicationDetail;
    expect(requested.background_checks).toHaveLength(1);
    expect(requested.background_checks[0]).toMatchObject({
      check_number: 1,
      stage: { name: "Checks", kind: "background_check" },
      consent_state: "requested",
      check_types: ["identity", "criminal"],
      performer: "org",
      results: [],
    });
    expect(requested.background_checks[0]?.responded_at).toBeUndefined();
    expect((await history(world, opening, application))[0]).toMatchObject({
      action: "background_check_consent_requested",
      stage: { name: "Checks" },
    });

    // One request is active at a time; nothing is recorded before consent.
    await expectProblem(
      await askConsent(world, opening, application),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await recordCheck(world, opening, application, {}),
      409,
      STATE_CONFLICT,
    );
    expect(
      (await detail(world, opening, application)).background_checks[0]?.results,
    ).toEqual([]);

    // The applicant declined: nothing completes and the Org may ask again.
    const declined = await decline(applicant, reference, 1);
    expect(declined.status(), await declined.text()).toBe(200);
    await expectProblem(
      await recordCheck(world, opening, application, {}),
      409,
      STATE_CONFLICT,
    );
    const again = await askConsent(world, opening, application, ["drug"]);
    expect(again.status(), await again.text()).toBe(200);
    const second = (await again.json()) as ApplicationDetail;
    expect(second.background_checks.map((check) => check.check_number)).toEqual(
      [1, 2],
    );
    expect(stageStatus(second, CHECKS)).toBe("pending");

    // Only consented types are recorded, each once; the last completes.
    const given = await give(applicant, reference, 2);
    expect(given.status(), await given.text()).toBe(200);
    await expectProblem(
      await recordCheck(world, opening, application, {
        check_type: "identity",
      }),
      400,
      VALIDATION,
      ["check_type"],
    );
    for (const [fields, invalid] of [
      [{ check_type: "astrology" }, ["check_type"]],
      [{ outcome: "fine" }, ["outcome"]],
      [{ notes: "x".repeat(2001) }, ["notes"]],
      [{ report_url: "ftp://x.example.com" }, ["report_url"]],
    ] as const) {
      await expectProblem(
        await recordCheck(world, opening, application, {
          check_type: "drug",
          ...fields,
        }),
        400,
        VALIDATION,
        [...invalid],
      );
    }
    const done = await recordCheck(world, opening, application, {
      check_type: "drug",
      outcome: "discrepancy",
      notes: " Positive ",
      report_url: "https://checks.example.com/r/1",
    });
    expect(done.status(), await done.text()).toBe(200);
    const finished = (await done.json()) as ApplicationDetail;
    expect(stageStatus(finished, CHECKS)).toBe("completed");
    expect(finished.background_checks[1]?.results[0]).toMatchObject({
      check_type: "drug",
      outcome: "discrepancy",
      notes: "Positive",
      report_url: "https://checks.example.com/r/1",
      recorded_by_email: world.org.emailAddress,
    });
    expect((await history(world, opening, application))[0]).toMatchObject({
      action: "background_check_result_recorded",
    });
    await expectProblem(
      await recordCheck(world, opening, application, { check_type: "drug" }),
      409,
      STATE_CONFLICT,
    );
  });
});

test("an interviewer who only interviews sees no assessment or check results", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withOrg(request, async (world) => {
    const { api, owner, org } = world;
    await upgrade(world);
    const ada = await addOrgMember(api, owner, org.domain, `ada@${org.domain}`);
    const { opening: published, stages } = await publishedOpening(world);
    const opening = published.opening_number;
    const application = await candidacyAt(world, opening, stages, ASSESS);
    const result = await assess(world, opening, application, {});
    expect(result.status(), await result.text()).toBe(200);
    const move = await api.moveApplicationStage(owner, {
      ...REFERENCE(
        opening,
        application,
        await version(world, opening, application),
      ),
      stage_id: stageOf(stages, 2).id,
    });
    expect(move.status(), await move.text()).toBe(200);
    const scheduled = await api.scheduleInterview(owner, {
      ...REFERENCE(
        opening,
        application,
        await version(world, opening, application),
      ),
      start_time: inFuture(120),
      duration_minutes: 30,
      mode: "video",
      video_url: "https://meet.example.com/room",
      interviewer_emails: [ada.emailAddress],
    });
    expect(scheduled.status(), await scheduled.text()).toBe(200);
    expect(
      (await detail(world, opening, application)).assessments,
    ).toHaveLength(1);
    const seen = await detail(world, opening, application, ada.token);
    expect(seen.assessments).toEqual([]);
    expect(seen.background_checks).toEqual([]);
  });
});

test("leaving a stage or the pipeline ends a consent request awaiting an answer", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withOrg(request, async (world) => {
    const { opening: published, stages } = await publishedOpening(world);
    const opening = published.opening_number;
    const states = async (application: number) =>
      (await detail(world, opening, application)).background_checks.map(
        (check) => check.consent_state,
      );
    const moved = await candidacyAt(world, opening, stages, CHECKS);
    const notProgressing = await candidacyAt(world, opening, stages, CHECKS);
    const offered = await candidacyAt(world, opening, stages, CHECKS);
    for (const application of [moved, notProgressing, offered]) {
      const asked = await askConsent(world, opening, application);
      expect(asked.status(), await asked.text()).toBe(200);
    }
    // An offer is extended from any stage and leaves the request open.
    const letter = await world.api.uploadOfferLetter(
      world.owner,
      offerLetter(),
    );
    expect(letter.status(), await letter.text()).toBe(201);
    const offer = await world.api.extendApplicationOffer(world.owner, {
      ...REFERENCE(opening, offered, await version(world, opening, offered)),
      letter_id: ((await letter.json()) as { letter_id: string }).letter_id,
      respond_within_days: 14,
    });
    expect(offer.status(), await offer.text()).toBe(200);
    expect(await states(offered)).toEqual(["requested"]);

    // Add a stage after Checks and move forward.
    const extended = await world.api.replaceOpeningPipeline(world.owner, {
      opening_number: opening,
      version: (
        await (
          await world.api.getOpening(world.owner, { opening_number: opening })
        ).json()
      ).version,
      stages: [
        ...stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          kind: stage.kind,
        })),
        { name: "Final", kind: "review" },
      ],
    } as never);
    expect(extended.status(), await extended.text()).toBe(200);
    const final = ((await extended.json()) as { stages: PipelineStage[] })
      .stages;
    const move = await world.api.moveApplicationStage(world.owner, {
      ...REFERENCE(opening, moved, await version(world, opening, moved)),
      stage_id: stageOf(final, 4).id,
    });
    expect(move.status(), await move.text()).toBe(200);
    expect(await states(moved)).toEqual(["ended"]);

    const out = await world.api.markApplicationNotProgressing(world.owner, {
      ...REFERENCE(
        opening,
        notProgressing,
        await version(world, opening, notProgressing),
      ),
    });
    expect(out.status(), await out.text()).toBe(200);
    expect(await states(notProgressing)).toEqual(["ended"]);
  });
});

// The Hub side: a real applicant, so commands and projection events travel
// between tenants.

function consentReference(reference: ApplicationReference, check: number) {
  return { ...reference, check_number: check };
}

function give(
  applicant: Applicant,
  reference: ApplicationReference,
  check: number,
  key = hubIdempotencyKey(),
) {
  return applicant.hub.giveApplicationBackgroundCheckConsent(
    consentReference(reference, check),
    { token: applicant.token, idempotencyKey: key },
  );
}

function decline(
  applicant: Applicant,
  reference: ApplicationReference,
  check: number,
  key = hubIdempotencyKey(),
) {
  return applicant.hub.declineApplicationBackgroundCheckConsent(
    consentReference(reference, check),
    { token: applicant.token, idempotencyKey: key },
  );
}

for (const [applicantTenant, label] of [
  ["sgp", "a local"],
  ["usa1", "a remote"],
] as const) {
  test(`${label} applicant reads, declines, and gives consent, and results never reach the Hub`, async ({
    request,
  }) => {
    test.setTimeout(240_000);
    await withApplicant(
      request,
      applicantTenant,
      "sgp",
      async (applicant, world) => {
        const { reference, opening } = await shortlisted(applicant, world);
        const number = reference.application_number;
        await expectProjected(applicant, reference, "in_review", []);

        const asked = await askConsent(world, opening, number);
        expect(asked.status(), await asked.text()).toBe(200);
        await expectProjected(applicant, reference, "in_review", [
          "background_check_consent",
        ]);
        const read = await myApplication(applicant, reference);
        expect(read.pending_actions).toEqual(["background_check_consent"]);
        expect(read.background_check_consent).toMatchObject({
          check_number: 1,
          check_types: ["identity", "drug"],
          performer: "org",
        });
        expect(Object.keys(read.background_check_consent ?? {}).sort()).toEqual(
          ["check_number", "check_types", "performer", "requested_at"],
        );
        expect(JSON.stringify(read)).not.toContain("Checks");

        // The Org filters its candidates by the awaited consent.
        const listed = await world.api.listApplications(world.owner, {
          opening_number: opening,
          view: "candidates",
          pending_applicant_action: "background_check_consent",
        });
        expect(listed.status(), await listed.text()).toBe(200);
        expect(
          ((await listed.json()) as ListApplicationsResponse).applications.map(
            (entry) => entry.application_number,
          ),
        ).toEqual([number]);

        // Nothing is recorded before consent.
        await expectProblem(
          await recordCheck(world, opening, number, {}),
          409,
          STATE_CONFLICT,
        );

        // Unknown requests and applications.
        await expectProblem(
          await give(applicant, reference, 9),
          404,
          HUB_NOT_FOUND,
        );
        await expectProblem(
          await decline(
            applicant,
            { ...reference, application_number: number + 5 },
            1,
          ),
          404,
          HUB_NOT_FOUND,
        );

        // Declining completes nothing and clears the pending action.
        const declineKey = hubIdempotencyKey();
        const declined = await decline(applicant, reference, 1, declineKey);
        expect(declined.status(), await declined.text()).toBe(200);
        expect(declined.headers()["cache-control"]).toBe("no-store");
        expect(await declined.json()).toEqual(reference);
        expect(
          (await decline(applicant, reference, 1, declineKey)).status(),
        ).toBe(200);
        await expectProblem(
          await decline(applicant, reference, 2, declineKey),
          409,
          KEY_CONFLICT,
        );
        await expectProblem(
          await give(applicant, reference, 1),
          409,
          HUB_STATE_CONFLICT,
        );
        await expectProblem(
          await decline(applicant, reference, 1),
          409,
          HUB_STATE_CONFLICT,
        );
        const afterDecline = await detail(world, opening, number);
        expect(afterDecline.background_checks[0]).toMatchObject({
          consent_state: "declined",
        });
        expect(afterDecline.background_checks[0]?.responded_at).toBeDefined();
        expect(stageStatus(afterDecline, CHECKS)).toBe("pending");
        expect((await history(world, opening, number))[0]).toMatchObject({
          action: "background_check_consent_declined",
          actor: "applicant",
        });
        await expectProjected(applicant, reference, "in_review", []);
        expect(
          (await myApplication(applicant, reference)).background_check_consent,
        ).toBeUndefined();
        await expectProblem(
          await recordCheck(world, opening, number, {}),
          409,
          STATE_CONFLICT,
        );

        // The Org asks again; the applicant consents.
        const asksAgain = await askConsent(world, opening, number, [
          "identity",
          "drug",
        ]);
        expect(asksAgain.status(), await asksAgain.text()).toBe(200);
        await expectProjected(applicant, reference, "in_review", [
          "background_check_consent",
        ]);
        expect(
          (await myApplication(applicant, reference)).background_check_consent
            ?.check_number,
        ).toBe(2);
        await expectProblem(
          await give(applicant, reference, 1),
          409,
          HUB_STATE_CONFLICT,
        );
        const given = await give(applicant, reference, 2);
        expect(given.status(), await given.text()).toBe(200);
        expect((await history(world, opening, number))[0]).toMatchObject({
          action: "background_check_consent_given",
          actor: "applicant",
        });
        await expectProjected(applicant, reference, "in_review", []);

        // Recording now works; the last result completes the stage.
        const first = await recordCheck(world, opening, number, {
          check_type: "identity",
          notes: "Secret finding",
        });
        expect(first.status(), await first.text()).toBe(200);
        expect(
          stageStatus((await first.json()) as ApplicationDetail, CHECKS),
        ).toBe("pending");
        const last = await recordCheck(world, opening, number, {
          check_type: "drug",
          outcome: "unable_to_verify",
        });
        expect(last.status(), await last.text()).toBe(200);
        const completed = (await last.json()) as ApplicationDetail;
        expect(stageStatus(completed, CHECKS)).toBe("completed");
        expect(completed.background_checks[1]).toMatchObject({
          consent_state: "given",
          results: [
            {
              check_type: "identity",
              outcome: "clear",
              notes: "Secret finding",
            },
            { check_type: "drug", outcome: "unable_to_verify" },
          ],
        });

        // No result reaches the Hub, live or projected.
        const afterwards = JSON.stringify(
          await myApplication(applicant, reference),
        );
        for (const hidden of [
          "Secret finding",
          "unable_to_verify",
          "discrepancy",
          "Checks",
        ]) {
          expect(afterwards).not.toContain(hidden);
        }
        const projection = await applicant.hub.findMyOpeningApplication(
          {
            domain: reference.domain,
            opening_number: reference.opening_number,
          },
          applicant.token,
        );
        expect(projection.status()).toBe(200);
        expect(JSON.stringify(await projection.json())).not.toContain(
          "Secret finding",
        );
      },
    );
  });
}

test("withdrawing ends the consent request and the applicant can no longer answer", async ({
  request,
}) => {
  test.setTimeout(180_000);
  await withApplicant(request, "sgp", "sgp", async (applicant, world) => {
    const { reference, opening } = await shortlisted(applicant, world);
    const asked = await askConsent(
      world,
      opening,
      reference.application_number,
    );
    expect(asked.status(), await asked.text()).toBe(200);
    const withdrawn = await applicant.hub.withdrawApplication(reference, {
      token: applicant.token,
      idempotencyKey: hubIdempotencyKey(),
    });
    expect(withdrawn.status(), await withdrawn.text()).toBe(200);
    expect(
      (await detail(world, opening, reference.application_number))
        .background_checks[0]?.consent_state,
    ).toBe("ended");
    await expectProblem(
      await give(applicant, reference, 1),
      409,
      HUB_STATE_CONFLICT,
    );
    await expectProjected(applicant, reference, "withdrawn", []);
  });
});

for (const verb of ["give", "decline"] as const) {
  test(`an uncertain consent ${verb} is 202 and its replay returns the outcome`, async ({
    request,
  }) => {
    test.setTimeout(180_000);
    await withApplicant(request, "usa1", "sgp", async (applicant, world) => {
      const { reference, opening } = await shortlisted(applicant, world);
      const asked = await askConsent(
        world,
        opening,
        reference.application_number,
      );
      expect(asked.status(), await asked.text()).toBe(200);
      const setHome = (tenant: TestTenant) =>
        globalSQLScalar(
          `UPDATE vetchium.org_principals
         SET home_tenant_id = ${sqlLiteral(tenant)},
           routing_version = routing_version + 1
         WHERE org_did = ${sqlLiteral(world.did)}::uuid`,
        );
      const key = hubIdempotencyKey();
      setHome("deu");
      try {
        const answer = verb === "give" ? give : decline;
        const pending = await answer(applicant, reference, 1, key);
        expect(pending.status(), await pending.text()).toBe(202);
        expect(pending.headers()["cache-control"]).toBe("no-store");
      } finally {
        setHome("sgp");
      }
      const answered = await (verb === "give" ? give : decline)(
        applicant,
        reference,
        1,
        key,
      );
      expect(answered.status(), await answered.text()).toBe(200);
      expect(
        (await detail(world, opening, reference.application_number))
          .background_checks[0]?.consent_state,
      ).toBe(verb === "give" ? "given" : "declined");
    });
  });
}

test("an applicant whose region cannot reach the directory gets hub-org-unavailable", async ({
  request,
}) => {
  await withApplicant(request, "ind1", "usa1", async (applicant, world) => {
    const reference = {
      domain: world.org.domain,
      opening_number: 1,
      application_number: 1,
    };
    await expectProblem(
      await give(applicant, reference, 1),
      503,
      `${PREFIX}hub-org-unavailable`,
    );
    await expectProblem(
      await decline(applicant, reference, 1),
      503,
      `${PREFIX}hub-org-unavailable`,
    );
  });
});

test("consent answers reject malformed, unauthenticated, and unknown requests", async ({
  request,
}) => {
  await withApplicant(request, "sgp", "sgp", async (applicant, world) => {
    const hub = applicant.hub;
    const reference = {
      domain: world.org.domain,
      opening_number: 1,
      application_number: 1,
      check_number: 1,
    };
    for (const path of [
      "/give-application-background-check-consent",
      "/decline-application-background-check-consent",
    ]) {
      await expectProblem(
        await hub.post(path, reference, {
          idempotencyKey: hubIdempotencyKey(),
        }),
        401,
        `${PREFIX}hub-authentication-required`,
      );
      await expectProblem(
        await hub.postRaw(path, "{not json", {
          token: applicant.token,
          idempotencyKey: hubIdempotencyKey(),
        }),
        400,
        `${PREFIX}invalid-json`,
      );
      await expectProblem(
        await hub.post(
          path,
          { ...reference, check_number: 0 },
          { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
        ),
        400,
        VALIDATION,
        ["check_number"],
      );
      await expectProblem(
        await hub.post(path, reference, { token: applicant.token }),
        400,
        VALIDATION,
        ["Idempotency-Key"],
      );
      await expectProblem(
        await hub.post(
          path,
          { ...reference, domain: `unknown-${randomUUID()}.example.test` },
          { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
        ),
        404,
        HUB_NOT_FOUND,
      );
    }
    await expectProblem(
      await give(applicant, reference, 1),
      404,
      HUB_NOT_FOUND,
    );
  });
});
