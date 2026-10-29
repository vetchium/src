import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type {
  ApplicationReference,
  ListMyApplicationsResponse,
  MyApplicationDetail,
} from "typespec/hub/applications/applications";
import type {
  ApplicationCounts,
  ApplicationDetail,
  ApplicationHistoryEntry,
  ApplicationState,
  Interview,
  InterviewDetails,
  ListApplicationHistoryResponse,
  ListApplicationsResponse,
  ListMyInterviewsResponse,
  OfferLetterUploaded,
} from "typespec/orgs/applications/applications";
import type {
  FeedbackCriterion,
  PipelineStage,
} from "typespec/orgs/hiring/pipelines";
import type { OpeningPipeline } from "typespec/orgs/openings/pipeline";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { expectProblem } from "../lib/admin-api.ts";
import {
  globalSQLScalar,
  sqlLiteral,
  type TestTenant,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import { type SeededApplication, seedApplication } from "../lib/hiring-seed.ts";
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
const INTERVIEW_NOT_FOUND = `${PREFIX}org-interview-not-found`;
const INTERVIEW_STATE = `${PREFIX}org-interview-state-conflict`;
const INTERVIEW_LIMIT = `${PREFIX}org-interview-limit-reached`;
const INTERVIEW_FEEDBACK_EXISTS = `${PREFIX}org-interview-feedback-exists`;
const FEEDBACK_ANSWERS_INVALID = `${PREFIX}org-interview-feedback-answers-invalid`;
const INTERVIEWERS_INVALID = `${PREFIX}org-interview-interviewers-invalid`;
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

function pdf(note = randomUUID()): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${note}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`,
  );
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

/** A published Opening whose pipeline is Screen (review), Panel and Final
 * (interview). The owner is its hiring manager and recruiter. */
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
    stages: [
      { name: "Screen", kind: "review" },
      { name: "Panel", kind: "interview" },
      { name: "Final", kind: "interview" },
    ],
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
function interviewSQL(
  world: World,
  opening: number,
  application: number,
  interview: number,
  set: string,
): void {
  orgSQL(
    `UPDATE vetchium.org_interviews AS i SET ${set}
     FROM vetchium.org_applications AS a
     JOIN vetchium.org_openings AS o USING (org_opening_id)
     WHERE a.org_application_id = i.org_application_id
       AND o.org_did = ${sqlLiteral(world.did)}::uuid
       AND o.opening_number = ${opening}
       AND a.application_number = ${application}
       AND i.interview_number = ${interview}`,
    world.tenant,
  );
}

/** As if the interview's start time had passed. */
function startInterview(
  world: World,
  opening: number,
  application: number,
  interview: number,
): void {
  interviewSQL(
    world,
    opening,
    application,
    interview,
    "starts_at = now() - interval '1 hour'",
  );
}

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

/** Overrides may name a field as undefined to leave it out. */
type Overrides = {
  [K in keyof InterviewDetails]?: InterviewDetails[K] | undefined;
};

function interviewDetails(
  world: World,
  overrides: Overrides = {},
): InterviewDetails {
  const merged: Record<string, unknown> = {
    start_time: inFuture(120),
    duration_minutes: 45,
    mode: "video",
    video_url: "https://meet.example.com/room",
    interviewer_emails: [world.org.emailAddress],
    ...overrides,
  };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  return merged as unknown as InterviewDetails;
}

function interviewOf(
  application: ApplicationDetail,
  number: number,
): Interview {
  const interview = application.interviews.find(
    (candidate) => candidate.interview_number === number,
  );
  if (!interview) throw new Error(`expected interview ${number}`);
  return interview;
}

/** Schedules an interview and returns the application as the caller reads
 * it. */
async function schedule(
  world: World,
  opening: number,
  application: number,
  overrides: Overrides = {},
  token = world.owner,
): Promise<ApplicationDetail> {
  const before = await detail(world, opening, application);
  const response = await world.api.scheduleInterview(token, {
    opening_number: opening,
    application_number: application,
    version: before.version,
    ...interviewDetails(world, overrides),
  });
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ApplicationDetail;
}

async function version(
  world: World,
  opening: number,
  application: number,
): Promise<number> {
  return (await detail(world, opening, application)).version;
}

/** A shortlisted-looking candidacy at the Panel stage with no Hub user. */
async function panelCandidacy(
  world: World,
  team: string[] = [],
): Promise<{
  opening: number;
  application: number;
  /** The version seeding left; v(k) in a test counts it as version 1. */
  seeded: number;
  applicant: Applicant;
  stages: PipelineStage[];
}> {
  const { opening, stages } = await publishedOpening(world, team);
  const { number, version, applicant } = await seedFor(
    world,
    opening.opening_number,
    "in_pipeline",
    stageOf(stages, 1).id,
  );
  return {
    opening: opening.opening_number,
    application: number,
    seeded: version,
    applicant,
    stages,
  };
}

test("scheduling stores the interview, bumps the version, and records history without notes", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withOrg(request, async (world) => {
    await upgrade(world);
    const peer = await addOrgMember(
      world.api,
      world.owner,
      world.org.domain,
      `peer@${world.org.domain}`,
    );
    const { opening, application, seeded } = await panelCandidacy(world);
    const v = (k: number) => seeded + k - 1;
    const start = inFuture(180);
    const key = orgsIdempotencyKey();
    const details = interviewDetails(world, {
      start_time: start,
      duration_minutes: 30,
      interviewer_emails: [world.org.emailAddress, peer.emailAddress],
    });
    const body = {
      opening_number: opening,
      application_number: application,
      version: v(1),
      ...details,
    };
    const first = await world.api.scheduleInterview(world.owner, body, key);
    expect(first.status(), await first.text()).toBe(200);
    expect(first.headers()["cache-control"]).toBe("no-store");
    const scheduled = (await first.json()) as ApplicationDetail;
    expect(scheduled.version).toBe(v(2));
    expect(scheduled.interviews).toHaveLength(1);
    const interview = interviewOf(scheduled, 1);
    expect(interview).toMatchObject({
      interview_number: 1,
      stage: { name: "Panel", kind: "interview" },
      duration_minutes: 30,
      mode: "video",
      video_url: "https://meet.example.com/room",
      state: "scheduled",
      applicant_response: "pending",
      feedback: [],
    });
    expect(new Date(interview.starts_at).getTime()).toBe(
      new Date(start).getTime(),
    );
    expect(interview.location).toBeUndefined();
    expect(interview.reschedule_note).toBeUndefined();
    expect(interview.interviewers).toEqual(
      [world.org.emailAddress, peer.emailAddress]
        .sort()
        .map((email) => ({ email, feedback_submitted: false })),
    );

    const replay = await world.api.scheduleInterview(world.owner, body, key);
    expect(replay.status(), await replay.text()).toBe(200);
    expect(
      ((await replay.json()) as ApplicationDetail).interviews,
    ).toHaveLength(1);
    await expectProblem(
      await world.api.scheduleInterview(
        world.owner,
        { ...body, duration_minutes: 31 },
        key,
      ),
      409,
      KEY_CONFLICT,
    );
    expect((await detail(world, opening, application)).interviews).toHaveLength(
      1,
    );

    const entry = (await history(world, opening, application))[0];
    expect(entry).toMatchObject({
      action: "interview_scheduled",
      actor: "org_user",
      actor_email: world.org.emailAddress,
      state: "in_pipeline",
      version: v(2),
      interview_number: 1,
    });
    expect(JSON.stringify(entry)).not.toContain("meet.example.com");

    // An in-person interview carries a location, and numbers keep counting.
    const second = await world.api.scheduleInterview(world.owner, {
      opening_number: opening,
      application_number: application,
      version: v(2),
      ...interviewDetails(world, {
        mode: "in_person",
        video_url: undefined,
        location: "Room 4, Level 2",
      }),
    });
    expect(second.status(), await second.text()).toBe(200);
    const twice = (await second.json()) as ApplicationDetail;
    expect(interviewOf(twice, 2)).toMatchObject({
      mode: "in_person",
      location: "Room 4, Level 2",
    });
    expect(interviewOf(twice, 2).video_url).toBeUndefined();
  });
});

test("schedule-interview validates the details and names unavailable interviewers", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withOrg(request, async (world) => {
    const { api, owner } = world;
    const { opening, application, seeded } = await panelCandidacy(world);
    const v = (k: number) => seeded + k - 1;
    const send = (overrides: Record<string, unknown>) =>
      api.interviewWriteRaw("schedule-interview", owner, {
        opening_number: opening,
        application_number: application,
        version: v(1),
        ...interviewDetails(world),
        ...overrides,
      });
    const rejected: Array<[Record<string, unknown>, string]> = [
      [{ duration_minutes: 14 }, "duration_minutes"],
      [{ duration_minutes: 481 }, "duration_minutes"],
      [{ mode: "phone" }, "mode"],
      [{ video_url: "http://meet.example.com/room" }, "video_url"],
      [{ video_url: "https://meet.example.com/room#frag" }, "video_url"],
      [{ video_url: undefined }, "video_url"],
      [{ location: "Room 4" }, "location"],
      [
        { mode: "in_person", video_url: undefined, location: undefined },
        "location",
      ],
      [
        { mode: "in_person", video_url: undefined, location: "é".repeat(501) },
        "location",
      ],
      [{ start_time: undefined }, "start_time"],
      [{ interviewer_emails: [] }, "interviewer_emails"],
      [
        {
          interviewer_emails: Array.from(
            { length: 11 },
            (_, index) => `person${index}@${world.org.domain}`,
          ),
        },
        "interviewer_emails",
      ],
      [
        {
          interviewer_emails: [world.org.emailAddress, world.org.emailAddress],
        },
        "interviewer_emails",
      ],
      [{ interviewer_emails: ["not-an-address"] }, "interviewer_emails"],
    ];
    for (const [overrides, field] of rejected) {
      await expectProblem(await send(overrides), 400, VALIDATION, [field]);
    }
    // A start that is not a time never decodes.
    await expectProblem(
      await send({ start_time: "tomorrow" }),
      400,
      `${PREFIX}invalid-json`,
    );
    // A start that is not in the future is the API's rule.
    await expectProblem(
      await send({ start_time: inFuture(-5) }),
      400,
      VALIDATION,
      ["start_time"],
    );
    const unknown = `nobody@${world.org.domain}`;
    const missing = await send({
      interviewer_emails: [world.org.emailAddress, unknown],
    });
    await expectProblem(missing, 422, INTERVIEWERS_INVALID);
    expect(await missing.json()).toMatchObject({ email_addresses: [unknown] });
    expect((await detail(world, opening, application)).interviews).toEqual([]);

    // The bounds are inclusive and a location counts code points.
    for (const [index, overrides] of [
      { duration_minutes: 15 },
      { duration_minutes: 480 },
      {
        mode: "in_person",
        video_url: undefined,
        location: "é".repeat(500),
      },
    ].entries()) {
      const ok = await api.interviewWriteRaw("schedule-interview", owner, {
        opening_number: opening,
        application_number: application,
        version: v(index + 1),
        ...interviewDetails(world),
        ...overrides,
      });
      expect(ok.status(), await ok.text()).toBe(200);
    }

    // Malformed JSON and unknown fields never reach the handler.
    await expectProblem(
      await api.postRaw("/schedule-interview", "{not json", {
        token: owner,
        idempotencyKey: orgsIdempotencyKey(),
      }),
      400,
      `${PREFIX}invalid-json`,
    );
    await expectProblem(
      await api.interviewWriteRaw("schedule-interview", owner, {
        ...interviewDetails(world),
        opening_number: opening,
        application_number: application,
        version: v(4),
        stage_name: "Panel",
      }),
      400,
      `${PREFIX}invalid-json`,
    );
  });
});

test("an interview is limited to ten per stage, cancelled ones excepted, and needs an interview stage", async ({
  request,
}) => {
  test.setTimeout(180_000);
  await withOrg(request, async (world) => {
    const { api, owner } = world;
    const { opening, application, stages } = await panelCandidacy(world);
    for (let count = 1; count <= 10; count++) {
      await schedule(world, opening, application, {
        start_time: inFuture(60 + count),
      });
    }
    const request11 = async () =>
      api.scheduleInterview(owner, {
        opening_number: opening,
        application_number: application,
        version: await version(world, opening, application),
        ...interviewDetails(world),
      });
    const refused = await request11();
    await expectProblem(refused, 409, INTERVIEW_LIMIT);
    expect(await refused.json()).toMatchObject({ limit: 10 });

    const cancelled = await api.cancelInterview(owner, {
      opening_number: opening,
      application_number: application,
      version: await version(world, opening, application),
      interview_number: 3,
    });
    expect(cancelled.status(), await cancelled.text()).toBe(200);
    const eleventh = await request11();
    expect(eleventh.status(), await eleventh.text()).toBe(200);
    expect(
      ((await eleventh.json()) as ApplicationDetail).interviews,
    ).toHaveLength(11);

    // The limit is per stage: the next interview stage has room.
    const moved = await api.moveApplicationStage(owner, {
      opening_number: opening,
      application_number: application,
      version: await version(world, opening, application),
      stage_id: stageOf(stages, 2).id,
    });
    expect(moved.status(), await moved.text()).toBe(200);
    const final = await schedule(world, opening, application);
    expect(interviewOf(final, 12).stage.name).toBe("Final");

    // A review stage cannot hold interviews.
    const screen = await seedFor(
      world,
      opening,
      "in_pipeline",
      stageOf(stages, 0).id,
    );
    await expectProblem(
      await api.scheduleInterview(owner, {
        opening_number: opening,
        application_number: screen.number,
        version: screen.version,
        ...interviewDetails(world),
      }),
      409,
      STATE_CONFLICT,
    );
  });
});

test("interview writes refuse the wrong state, version, reader, and caller", async ({
  request,
}) => {
  test.setTimeout(150_000);
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
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_candidacies"],
    );
    const { opening, application, seeded } = await panelCandidacy(world, [
      teammate.emailAddress,
    ]);
    const v = (k: number) => seeded + k - 1;
    const submitted = await seedAt(world, opening, "submitted");
    const base = (number: number, version: number) => ({
      opening_number: opening,
      application_number: number,
      version,
      ...interviewDetails(world),
    });

    await expectProblem(
      await api.scheduleInterview(owner, base(submitted, 1)),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await api.scheduleInterview(owner, base(application, v(9))),
      409,
      VERSION_CONFLICT,
    );
    await expectProblem(
      await api.scheduleInterview(owner, base(application + 100, 1)),
      404,
      NOT_FOUND,
    );
    await expectProblem(
      await api.scheduleInterview(teammate.token, base(application, v(1))),
      403,
      PERMISSION_REQUIRED,
    );
    await expectProblem(
      await api.scheduleInterview(outsider.token, base(application, v(1))),
      404,
      NOT_FOUND,
    );
    await expectProblem(
      await api.interviewWriteRaw(
        "schedule-interview",
        "not-a-token",
        base(application, v(1)),
      ),
      401,
      `${PREFIX}org-authentication-required`,
    );
    const noKey = await api.post(
      "/schedule-interview",
      base(application, v(1)),
      {
        token: owner,
      },
    );
    await expectProblem(noKey, 400, VALIDATION, ["Idempotency-Key"]);
    expect((await detail(world, opening, application)).interviews).toEqual([]);

    // Anyone who may act on the Opening's applications may schedule.
    const scheduled = await api.scheduleInterview(
      manager.token,
      base(application, v(1)),
    );
    expect(scheduled.status(), await scheduled.text()).toBe(200);

    const reference = (number: number) => ({
      opening_number: opening,
      application_number: application,
      version: v(2),
      interview_number: number,
    });
    for (const call of [
      (token: string, number: number) =>
        api.changeInterview(token, {
          ...reference(number),
          ...interviewDetails(world),
        }),
      (token: string, number: number) =>
        api.cancelInterview(token, reference(number)),
    ]) {
      await expectProblem(await call(owner, 9), 404, INTERVIEW_NOT_FOUND);
      await expectProblem(
        await call(teammate.token, 1),
        403,
        PERMISSION_REQUIRED,
      );
      await expectProblem(await call(outsider.token, 1), 404, NOT_FOUND);
    }
    await expectProblem(
      await api.changeInterview(owner, {
        ...reference(1),
        version: v(1),
        ...interviewDetails(world),
      }),
      409,
      VERSION_CONFLICT,
    );

    // Once the application leaves in_pipeline-or-later states nothing changes.
    const notProgressing = await api.markApplicationNotProgressing(owner, {
      opening_number: opening,
      application_number: application,
      version: v(2),
    });
    expect(notProgressing.status(), await notProgressing.text()).toBe(200);
    await expectProblem(
      await api.cancelInterview(owner, {
        ...reference(1),
        version: v(3),
      }),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await api.scheduleInterview(owner, base(application, v(3))),
      409,
      STATE_CONFLICT,
    );

    // A suspended Org writes nothing.
    orgSQL(
      `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
       WHERE org_did = ${sqlLiteral(world.did)}::uuid`,
    );
    await expectProblem(
      await api.scheduleInterview(owner, base(application, v(3))),
      403,
      `${PREFIX}org-suspended`,
    );
  });
});

test("changing an interview resets the response only when time or mode change", async ({
  request,
}) => {
  test.setTimeout(150_000);
  await withOrg(request, async (world) => {
    const { api, owner, org } = world;
    await upgrade(world);
    const peer = await addOrgMember(
      api,
      owner,
      org.domain,
      `peer@${org.domain}`,
    );
    const { opening, application, applicant } = await panelCandidacy(world);
    const start = inFuture(240);
    await schedule(world, opening, application, { start_time: start });
    const reference = {
      domain: org.domain,
      opening_number: opening,
      application_number: application,
    };
    // The applicant answers through the Hub, as in production.
    const answer = async (response: "accepted" | "reschedule", note = "") => {
      const answered =
        response === "accepted"
          ? await accept(applicant, reference, 1)
          : await reschedule(applicant, reference, 1, note);
      expect(answered.status(), await answered.text()).toBe(200);
    };
    const change = async (overrides: Overrides) => {
      const response = await api.changeInterview(owner, {
        opening_number: opening,
        application_number: application,
        version: await version(world, opening, application),
        interview_number: 1,
        ...interviewDetails(world, { start_time: start, ...overrides }),
      });
      expect(response.status(), await response.text()).toBe(200);
      return interviewOf((await response.json()) as ApplicationDetail, 1);
    };

    // The same details keep the response, and so does a change of
    // interviewers alone.
    await answer("accepted");
    expect((await change({})).applicant_response).toBe("accepted");
    const kept = await change({
      interviewer_emails: [org.emailAddress, peer.emailAddress],
    });
    expect(kept.applicant_response).toBe("accepted");
    expect(kept.interviewers.map((entry) => entry.email).sort()).toEqual(
      [org.emailAddress, peer.emailAddress].sort(),
    );
    const trimmed = await change({ interviewer_emails: [peer.emailAddress] });
    expect(trimmed.interviewers.map((entry) => entry.email)).toEqual([
      peer.emailAddress,
    ]);
    expect(trimmed.applicant_response).toBe("accepted");

    // A new time, duration, or mode resets it and drops the applicant's note.
    await answer("reschedule", "Can we move it?");
    expect(
      interviewOf(await detail(world, opening, application), 1),
    ).toMatchObject({
      applicant_response: "reschedule_requested",
      reschedule_note: "Can we move it?",
    });
    const moved = await change({ start_time: inFuture(300) });
    expect(moved.applicant_response).toBe("pending");
    expect(moved.reschedule_note).toBeUndefined();
    await answer("accepted");
    expect(
      (await change({ start_time: moved.starts_at, duration_minutes: 50 }))
        .applicant_response,
    ).toBe("pending");
    await answer("accepted");
    const inPerson = await change({
      start_time: moved.starts_at,
      duration_minutes: 50,
      mode: "in_person",
      video_url: undefined,
      location: "Room 9",
    });
    expect(inPerson).toMatchObject({
      applicant_response: "pending",
      mode: "in_person",
      location: "Room 9",
    });
    expect(inPerson.video_url).toBeUndefined();
    await answer("accepted");
    expect(
      (
        await change({
          start_time: moved.starts_at,
          duration_minutes: 50,
          mode: "in_person",
          video_url: undefined,
          location: "Room 10",
        })
      ).applicant_response,
    ).toBe("pending");

    const entries = await history(world, opening, application);
    expect(
      entries.filter((entry) => entry.action === "interview_changed"),
    ).toHaveLength(7);

    // Changes validate like scheduling, and an unknown interviewer names it.
    const stale = await version(world, opening, application);
    const attempt = (overrides: Record<string, unknown>) =>
      api.interviewWriteRaw("change-interview", owner, {
        opening_number: opening,
        application_number: application,
        version: stale,
        interview_number: 1,
        ...interviewDetails(world),
        ...overrides,
      });
    await expectProblem(
      await attempt({ start_time: inFuture(-1) }),
      400,
      VALIDATION,
      ["start_time"],
    );
    await expectProblem(
      await attempt({ interview_number: 0 }),
      400,
      VALIDATION,
      ["interview_number"],
    );
    const unknown = `ghost@${org.domain}`;
    const invalid = await attempt({ interviewer_emails: [unknown] });
    await expectProblem(invalid, 422, INTERVIEWERS_INVALID);
    expect(await invalid.json()).toMatchObject({ email_addresses: [unknown] });
    // A disabled user is unavailable too.
    const disabled = await api.disableUser(owner, {
      email_address: peer.emailAddress,
    });
    expect(disabled.status(), await disabled.text()).toBe(204);
    await expectProblem(
      await attempt({ interviewer_emails: [peer.emailAddress] }),
      422,
      INTERVIEWERS_INVALID,
    );
  });
});

test("an interview is cancelled once and then cannot change", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withOrg(request, async (world) => {
    const { api, owner } = world;
    const { opening, application } = await panelCandidacy(world);
    await schedule(world, opening, application);
    const reference = async () => ({
      opening_number: opening,
      application_number: application,
      version: await version(world, opening, application),
      interview_number: 1,
    });
    const key = orgsIdempotencyKey();
    const body = await reference();
    const cancelled = await api.cancelInterview(owner, body, key);
    expect(cancelled.status(), await cancelled.text()).toBe(200);
    expect(
      interviewOf((await cancelled.json()) as ApplicationDetail, 1),
    ).toMatchObject({ state: "cancelled" });
    const replay = await api.cancelInterview(owner, body, key);
    expect(replay.status(), await replay.text()).toBe(200);
    expect(
      (await history(world, opening, application)).filter(
        (entry) => entry.action === "interview_cancelled",
      ),
    ).toHaveLength(1);
    await expectProblem(
      await api.cancelInterview(owner, await reference()),
      409,
      INTERVIEW_STATE,
    );
    await expectProblem(
      await api.changeInterview(owner, {
        ...(await reference()),
        ...interviewDetails(world),
      }),
      409,
      INTERVIEW_STATE,
    );
    await expectProblem(
      await api.recordInterviewOutcome(owner, {
        ...(await reference()),
        outcome: "completed",
      }),
      409,
      INTERVIEW_STATE,
    );

    // A started interview is recorded, not cancelled.
    await schedule(world, opening, application);
    startInterview(world, opening, application, 2);
    await expectProblem(
      await api.cancelInterview(owner, {
        ...(await reference()),
        interview_number: 2,
      }),
      409,
      INTERVIEW_STATE,
    );
    await expectProblem(
      await api.changeInterview(owner, {
        ...(await reference()),
        interview_number: 2,
        ...interviewDetails(world),
      }),
      409,
      INTERVIEW_STATE,
    );
  });
});

test("an outcome is recorded only after the start, by an interviewer or someone who acts", async ({
  request,
}) => {
  test.setTimeout(150_000);
  await withOrg(request, async (world) => {
    const { api, owner, org } = world;
    await upgrade(world);
    const interviewer = await addOrgMember(
      api,
      owner,
      org.domain,
      `interviewer@${org.domain}`,
    );
    const stranger = await addOrgMember(
      api,
      owner,
      org.domain,
      `stranger@${org.domain}`,
    );
    const teammate = await addOrgMember(
      api,
      owner,
      org.domain,
      `teammate@${org.domain}`,
    );
    const { opening, application } = await panelCandidacy(world, [
      teammate.emailAddress,
    ]);
    await schedule(world, opening, application, {
      interviewer_emails: [interviewer.emailAddress],
    });
    await schedule(world, opening, application, {
      interviewer_emails: [stranger.emailAddress],
    });
    const record = async (
      token: string,
      number: number,
      outcome: "completed" | "no_show",
    ) =>
      api.recordInterviewOutcome(token, {
        opening_number: opening,
        application_number: application,
        version: await version(world, opening, application),
        interview_number: number,
        outcome,
      });

    // Before the start there is nothing to record.
    await expectProblem(
      await record(interviewer.token, 1, "completed"),
      409,
      INTERVIEW_STATE,
    );
    await expectProblem(
      await record(owner, 1, "no_show"),
      409,
      INTERVIEW_STATE,
    );
    startInterview(world, opening, application, 1);
    startInterview(world, opening, application, 2);

    await expectProblem(
      await api.interviewWriteRaw("record-interview-outcome", owner, {
        opening_number: opening,
        application_number: application,
        version: 1,
        interview_number: 1,
        outcome: "cancelled",
      }),
      400,
      VALIDATION,
      ["outcome"],
    );
    await expectProblem(
      await record(owner, 9, "completed"),
      404,
      INTERVIEW_NOT_FOUND,
    );
    // A hiring-team reader and another interview's interviewer may not.
    await expectProblem(
      await record(teammate.token, 1, "completed"),
      403,
      PERMISSION_REQUIRED,
    );
    await expectProblem(
      await record(stranger.token, 1, "completed"),
      403,
      PERMISSION_REQUIRED,
    );
    await expectProblem(
      await api.recordInterviewOutcome(owner, {
        opening_number: opening,
        application_number: application,
        version: 1,
        interview_number: 1,
        outcome: "completed",
      }),
      409,
      VERSION_CONFLICT,
    );

    const completed = await record(interviewer.token, 1, "completed");
    expect(completed.status(), await completed.text()).toBe(200);
    expect(
      interviewOf((await completed.json()) as ApplicationDetail, 1).state,
    ).toBe("completed");
    const noShow = await record(owner, 2, "no_show");
    expect(noShow.status(), await noShow.text()).toBe(200);
    expect(
      interviewOf((await noShow.json()) as ApplicationDetail, 2).state,
    ).toBe("no_show");
    await expectProblem(
      await record(owner, 1, "no_show"),
      409,
      INTERVIEW_STATE,
    );
    const actions = (await history(world, opening, application)).map(
      (entry) => entry.action,
    );
    expect(actions).toContain("interview_completed");
    expect(actions).toContain("interview_no_show");
  });
});

test("feedback is stored once per interviewer and stays hidden until the reader submits their own", async ({
  request,
}) => {
  test.setTimeout(180_000);
  await withOrg(request, async (world) => {
    const { api, owner, org } = world;
    await upgrade(world);
    const ada = await addOrgMember(api, owner, org.domain, `ada@${org.domain}`);
    const bob = await addOrgMember(api, owner, org.domain, `bob@${org.domain}`);
    const { opening, application } = await panelCandidacy(world);
    await schedule(world, opening, application, {
      interviewer_emails: [ada.emailAddress, bob.emailAddress],
    });
    const submit = async (
      token: string,
      overrides: Record<string, unknown> = {},
    ) =>
      api.interviewWriteRaw("submit-interview-feedback", token, {
        opening_number: opening,
        application_number: application,
        version: await version(world, opening, application),
        interview_number: 1,
        recommendation: "yes",
        notes: "Solid systems depth",
        ...overrides,
      });

    // Feedback waits for the interview to be recorded as completed.
    await expectProblem(await submit(ada.token), 409, INTERVIEW_STATE);
    startInterview(world, opening, application, 1);
    await expectProblem(await submit(ada.token), 409, INTERVIEW_STATE);
    const completed = await api.recordInterviewOutcome(owner, {
      opening_number: opening,
      application_number: application,
      version: await version(world, opening, application),
      interview_number: 1,
      outcome: "completed",
    });
    expect(completed.status(), await completed.text()).toBe(200);

    // Only an interviewer submits.
    await expectProblem(await submit(owner), 403, PERMISSION_REQUIRED);
    await expectProblem(
      await submit(ada.token, { recommendation: "maybe" }),
      400,
      VALIDATION,
      ["recommendation"],
    );
    await expectProblem(
      await submit(ada.token, { notes: "   " }),
      400,
      VALIDATION,
      ["notes"],
    );
    await expectProblem(
      await submit(ada.token, { notes: "é".repeat(10_001) }),
      400,
      VALIDATION,
      ["notes"],
    );
    await expectProblem(
      await submit(ada.token, { interview_number: 7 }),
      404,
      INTERVIEW_NOT_FOUND,
    );

    const bobs = await submit(bob.token, {
      recommendation: "strong_no",
      notes: "é".repeat(10_000),
    });
    expect(bobs.status(), await bobs.text()).toBe(200);
    // Bob sees only his own; Ada, who has not submitted, sees none; the
    // recruiter, who does not interview, sees everyone's.
    const bobView = interviewOf((await bobs.json()) as ApplicationDetail, 1);
    expect(bobView.feedback).toHaveLength(1);
    expect(bobView.feedback[0]).toMatchObject({
      interviewer_email: bob.emailAddress,
      recommendation: "strong_no",
    });
    expect(
      interviewOf(await detail(world, opening, application, ada.token), 1)
        .feedback,
    ).toEqual([]);
    const ownerView = interviewOf(await detail(world, opening, application), 1);
    expect(ownerView.feedback).toHaveLength(1);
    expect(ownerView.interviewers).toEqual([
      { email: ada.emailAddress, feedback_submitted: false },
      { email: bob.emailAddress, feedback_submitted: true },
    ]);

    const key = orgsIdempotencyKey();
    const body = {
      opening_number: opening,
      application_number: application,
      version: await version(world, opening, application),
      interview_number: 1,
      recommendation: "strong_yes" as const,
      notes: "Great collaborator",
    };
    const adas = await api.submitInterviewFeedback(ada.token, body, key);
    expect(adas.status(), await adas.text()).toBe(200);
    const adaView = interviewOf((await adas.json()) as ApplicationDetail, 1);
    expect(adaView.feedback.map((entry) => entry.interviewer_email)).toEqual([
      bob.emailAddress,
      ada.emailAddress,
    ]);
    const replay = await api.submitInterviewFeedback(ada.token, body, key);
    expect(replay.status(), await replay.text()).toBe(200);
    // Bob now sees Ada's too, and neither may submit again.
    expect(
      interviewOf(await detail(world, opening, application, bob.token), 1)
        .feedback,
    ).toHaveLength(2);
    await expectProblem(
      await submit(ada.token),
      409,
      INTERVIEW_FEEDBACK_EXISTS,
    );
    await expectProblem(
      await submit(bob.token),
      409,
      INTERVIEW_FEEDBACK_EXISTS,
    );

    // History keeps actions and numbers, never the notes.
    const entries = await history(world, opening, application);
    expect(
      entries.filter(
        (entry) => entry.action === "interview_feedback_submitted",
      ),
    ).toHaveLength(2);
    expect(JSON.stringify(entries)).not.toContain("Great collaborator");
    const audited = orgSQL(
      `SELECT count(*) FROM vetchium.audit_events
       WHERE subject_org_did = ${sqlLiteral(world.did)}::uuid
         AND action = 'org.application.interview_feedback_submitted'
         AND payload::text NOT LIKE '%Great collaborator%'
         AND payload::text NOT LIKE '%Solid systems%'`,
    );
    expect(Number(audited)).toBe(2);
  });
});

test("an interviewer without other access reads and acts only on their own interviews", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withOrg(request, async (world) => {
    const { api, owner, org } = world;
    await upgrade(world);
    const ada = await addOrgMember(api, owner, org.domain, `ada@${org.domain}`);
    const bob = await addOrgMember(api, owner, org.domain, `bob@${org.domain}`);
    const { opening, application, stages } = await panelCandidacy(world);
    const other = await seedAt(
      world,
      opening,
      "in_pipeline",
      stageOf(stages, 1).id,
    );
    const untouched = await seedAt(
      world,
      opening,
      "in_pipeline",
      stageOf(stages, 1).id,
    );
    await schedule(world, opening, application, {
      interviewer_emails: [ada.emailAddress],
    });
    await schedule(world, opening, application, {
      interviewer_emails: [bob.emailAddress],
    });
    await schedule(world, opening, other, {
      interviewer_emails: [bob.emailAddress],
    });
    await schedule(world, opening, untouched, {
      interviewer_emails: [bob.emailAddress],
    });

    // Ada reads her one candidacy and nothing else.
    const own = await detail(world, opening, application, ada.token);
    expect(own.application_number).toBe(application);
    for (const hidden of [other, untouched]) {
      await expectProblem(
        await api.getApplication(ada.token, {
          opening_number: opening,
          application_number: hidden,
        }),
        404,
        NOT_FOUND,
      );
      await expectProblem(
        await api.listApplicationHistory(ada.token, {
          opening_number: opening,
          application_number: hidden,
        }),
        404,
        NOT_FOUND,
      );
    }
    // The interviewer reads the candidacy's whole history.
    expect(await history(world, opening, application, ada.token)).toEqual(
      await history(world, opening, application),
    );
    const listed = await api.listApplications(ada.token, {
      opening_number: opening,
      view: "candidates",
    });
    expect(listed.status(), await listed.text()).toBe(200);
    expect(
      ((await listed.json()) as ListApplicationsResponse).applications.map(
        (entry) => entry.application_number,
      ),
    ).toEqual([application]);
    const counts = await api.getApplicationCounts(ada.token, {
      opening_number: opening,
    });
    expect(counts.status(), await counts.text()).toBe(200);
    const body = (await counts.json()) as ApplicationCounts;
    expect(
      body.states.find((entry) => entry.state === "in_pipeline")?.count,
    ).toBe(1);
    expect(
      body.stages.find((entry) => entry.stage.name === "Panel")?.count,
    ).toBe(1);
    // The Applicants view is never an interviewer's.
    const applicants = await api.listApplications(ada.token, {
      opening_number: opening,
      view: "applicants",
    });
    expect(applicants.status(), await applicants.text()).toBe(200);
    expect(
      ((await applicants.json()) as ListApplicationsResponse).applications,
    ).toEqual([]);
    // Another Opening where she interviews nobody is not hers.
    const stranger = await api.getApplicationCounts(ada.token, {
      opening_number: opening + 50,
    });
    await expectProblem(stranger, 404, NOT_FOUND);

    // She cannot act on the application ...
    await expectProblem(
      await api.scheduleInterview(ada.token, {
        opening_number: opening,
        application_number: application,
        version: own.version,
        ...interviewDetails(world),
      }),
      403,
      PERMISSION_REQUIRED,
    );
    await expectProblem(
      await api.markApplicationNotProgressing(ada.token, {
        opening_number: opening,
        application_number: application,
        version: own.version,
      }),
      403,
      PERMISSION_REQUIRED,
    );
    // ... or on an interview that is not hers.
    startInterview(world, opening, application, 1);
    startInterview(world, opening, application, 2);
    const hers = await api.recordInterviewOutcome(ada.token, {
      opening_number: opening,
      application_number: application,
      version: own.version,
      interview_number: 2,
      outcome: "completed",
    });
    await expectProblem(hers, 403, PERMISSION_REQUIRED);
    const mine = await api.recordInterviewOutcome(ada.token, {
      opening_number: opening,
      application_number: application,
      version: own.version,
      interview_number: 1,
      outcome: "completed",
    });
    expect(mine.status(), await mine.text()).toBe(200);
    const submitted = await api.submitInterviewFeedback(ada.token, {
      opening_number: opening,
      application_number: application,
      version: own.version + 1,
      interview_number: 1,
      recommendation: "yes",
      notes: "Hire",
    });
    expect(submitted.status(), await submitted.text()).toBe(200);
    // Interview 2 is Bob's: Ada's feedback there is refused, and she
    // cannot read Bob's.
    await expectProblem(
      await api.submitInterviewFeedback(ada.token, {
        opening_number: opening,
        application_number: application,
        version: own.version + 2,
        interview_number: 2,
        recommendation: "yes",
        notes: "Hire",
      }),
      403,
      PERMISSION_REQUIRED,
    );

    // Her list shows only her interviews, with the feedback flag.
    const mineList = await api.listMyInterviews(ada.token, {});
    expect(mineList.status(), await mineList.text()).toBe(200);
    expect(mineList.headers()["cache-control"]).toBe("no-store");
    const adaInterviews = ((await mineList.json()) as ListMyInterviewsResponse)
      .interviews;
    expect(adaInterviews).toHaveLength(1);
    expect(adaInterviews[0]).toMatchObject({
      opening_number: opening,
      application_number: application,
      display_name: "Ada Lovelace",
      interview_number: 1,
      state: "completed",
      applicant_response: "pending",
      feedback_submitted: true,
    });

    // Bob interviews on three candidacies, paged through his own list.
    const bobsAll = (await (
      await api.listMyInterviews(bob.token, { limit: 2 })
    ).json()) as ListMyInterviewsResponse;
    expect(bobsAll.interviews).toHaveLength(2);
    expect(bobsAll.next_pagination_key).toBeDefined();
    const nextPage = (await (
      await api.listMyInterviews(bob.token, {
        limit: 2,
        pagination_key: bobsAll.next_pagination_key ?? "",
      })
    ).json()) as ListMyInterviewsResponse;
    expect(nextPage.interviews).toHaveLength(1);
    expect(nextPage.next_pagination_key).toBeUndefined();
    expect(
      [...bobsAll.interviews, ...nextPage.interviews]
        .map((entry) => entry.application_number)
        .sort(),
    ).toEqual([application, other, untouched].sort());
    await expectProblem(
      await api.listMyInterviews(bob.token, { pagination_key: "garbage" }),
      400,
      `${PREFIX}invalid-pagination-key`,
    );
    await expectProblem(
      await api.listMyInterviews(bob.token, { limit: 0 }),
      400,
      VALIDATION,
      ["limit"],
    );
    await expectProblem(
      await api.listMyInterviews("not-a-token", {}),
      401,
      `${PREFIX}org-authentication-required`,
    );

    // Being taken off an interview ends access to that candidacy only.
    const swapped = await api.changeInterview(owner, {
      opening_number: opening,
      application_number: untouched,
      version: await version(world, opening, untouched),
      interview_number: 1,
      ...interviewDetails(world, { interviewer_emails: [org.emailAddress] }),
    });
    expect(swapped.status(), await swapped.text()).toBe(200);
    await expectProblem(
      await api.getApplication(bob.token, {
        opening_number: opening,
        application_number: untouched,
      }),
      404,
      NOT_FOUND,
    );
    expect(
      (await detail(world, opening, other, bob.token)).application_number,
    ).toBe(other);

    // An interviewer reads the candidacy but not its offers.
    const offered = await seedAt(
      world,
      opening,
      "in_pipeline",
      stageOf(stages, 1).id,
    );
    await schedule(world, opening, offered, {
      interviewer_emails: [ada.emailAddress],
    });
    await extend(world, opening, offered);
    expect((await detail(world, opening, offered, ada.token)).offers).toEqual(
      [],
    );
    expect((await detail(world, opening, offered)).offers).toHaveLength(1);
  });
});

test("candidates can be filtered by the action awaiting the applicant", async ({
  request,
}) => {
  test.setTimeout(150_000);
  await withOrg(request, async (world) => {
    const { api, owner } = world;
    const { opening, application, stages } = await panelCandidacy(world);
    const answered = await seedFor(
      world,
      opening,
      "in_pipeline",
      stageOf(stages, 1).id,
    );
    const past = await seedAt(
      world,
      opening,
      "in_pipeline",
      stageOf(stages, 1).id,
    );
    const none = await seedAt(
      world,
      opening,
      "in_pipeline",
      stageOf(stages, 1).id,
    );
    await schedule(world, opening, application);
    await schedule(world, opening, answered.number);
    await schedule(world, opening, past);
    const accepted = await accept(
      answered.applicant,
      {
        domain: world.org.domain,
        opening_number: opening,
        application_number: answered.number,
      },
      1,
    );
    expect(accepted.status(), await accepted.text()).toBe(200);
    startInterview(world, opening, past, 1);
    const numbers = async (action: string) => {
      const response = await api.listApplications(owner, {
        opening_number: opening,
        view: "candidates",
        pending_applicant_action: action as never,
      });
      expect(response.status(), await response.text()).toBe(200);
      return ((await response.json()) as ListApplicationsResponse).applications
        .map((entry) => entry.application_number)
        .sort((a, b) => a - b);
    };
    expect(await numbers("interview_response")).toEqual([application]);
    expect(await numbers("offer_response")).toEqual([]);
    void none;

    await expectProblem(
      await api.listApplications(owner, {
        opening_number: opening,
        view: "applicants",
        pending_applicant_action: "interview_response",
      }),
      400,
      VALIDATION,
      ["pending_applicant_action"],
    );
    await expectProblem(
      await api.listApplications(owner, {
        opening_number: opening,
        view: "candidates",
        pending_applicant_action: "sign" as never,
      }),
      400,
      VALIDATION,
      ["pending_applicant_action"],
    );
  });
});

// Leaving the pipeline cancels the interviews that have not started.

test("every exit from the pipeline cancels upcoming interviews and spares started ones", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withOrg(request, async (world) => {
    const { api, owner, org } = world;
    const { opening, application, stages } = await panelCandidacy(world);
    const candidacy = () =>
      seedAt(world, opening, "in_pipeline", stageOf(stages, 1).id);
    const states = async (number: number) =>
      (await detail(world, opening, number)).interviews.map(
        (interview) => interview.state,
      );

    // Not progressing: one upcoming and one that already started.
    await schedule(world, opening, application);
    await schedule(world, opening, application);
    startInterview(world, opening, application, 2);
    const marked = await api.markApplicationNotProgressing(owner, {
      opening_number: opening,
      application_number: application,
      version: await version(world, opening, application),
    });
    expect(marked.status(), await marked.text()).toBe(200);
    expect(await states(application)).toEqual(["scheduled", "cancelled"]);
    // The started interview keeps its place to be recorded.
    expect(
      interviewOf(await detail(world, opening, application), 2).state,
    ).toBe("scheduled");

    // Joining and not joining end an accepted offer's candidacy.
    // The interview is scheduled while the candidacy is in the pipeline;
    // the offer and its acceptance leave it upcoming.
    for (const outcome of ["joined", "did_not_join"] as const) {
      const seeded = await seedFor(
        world,
        opening,
        "in_pipeline",
        stageOf(stages, 1).id,
      );
      const number = seeded.number;
      await schedule(world, opening, number, {
        start_time: inFuture(24 * 60),
      });
      await extend(world, opening, number);
      const answer = await seeded.applicant.hub.acceptApplicationOffer(
        {
          domain: world.org.domain,
          opening_number: opening,
          application_number: number,
          offer_number: 1,
        },
        { token: seeded.applicant.token, idempotencyKey: hubIdempotencyKey() },
      );
      expect(answer.status(), await answer.text()).toBe(200);
      expect(await states(number)).toEqual(["scheduled"]);
      const version1 = await version(world, opening, number);
      const finished =
        outcome === "joined"
          ? await api.recordApplicationJoined(owner, {
              opening_number: opening,
              application_number: number,
              version: version1,
              joined_on: new Date().toISOString().slice(0, 10),
            })
          : await api.recordApplicationDidNotJoin(owner, {
              opening_number: opening,
              application_number: number,
              version: version1,
            });
      expect(finished.status(), await finished.text()).toBe(200);
      expect(await states(number)).toEqual(["cancelled"]);
    }

    // Closing the Opening with every application marked.
    const closing = await candidacy();
    await schedule(world, opening, closing);
    expect(await states(closing)).toEqual(["scheduled"]);
    const current = await api.getOpening(owner, { opening_number: opening });
    const closed = await api.requestOpeningChange(owner, {
      opening_number: opening,
      version: ((await current.json()) as OrgOpening).version,
      kind: "close",
      mark_applications_not_progressing: true,
    });
    expect(closed.status(), await closed.text()).toBe(200);
    expect(await states(closing)).toEqual(["cancelled"]);
  });
});

test("withdrawing, declining, and an expired offer cancel upcoming interviews", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withApplicant(request, "sgp", "sgp", async (applicant, world) => {
    const { reference, opening } = await shortlisted(applicant, world);
    await schedule(world, opening, reference.application_number);
    await expectProjected(applicant, reference, "interviewing", [
      "interview_response",
    ]);
    const withdrawn = await applicant.hub.withdrawApplication(reference, {
      token: applicant.token,
      idempotencyKey: hubIdempotencyKey(),
    });
    expect(withdrawn.status(), await withdrawn.text()).toBe(200);
    const orgView = await detail(world, opening, reference.application_number);
    expect(orgView.state).toBe("withdrawn");
    expect(orgView.interviews.map((entry) => entry.state)).toEqual([
      "cancelled",
    ]);
    const mine = await myApplication(applicant, reference);
    expect(mine.interviews.map((entry) => entry.state)).toEqual(["cancelled"]);
    await expectProjected(applicant, reference, "withdrawn", []);
  });
});

test("declining an offer cancels upcoming interviews", async ({ request }) => {
  test.setTimeout(240_000);
  await withApplicant(request, "usa1", "sgp", async (applicant, world) => {
    const { reference, opening } = await shortlisted(applicant, world);
    await schedule(world, opening, reference.application_number);
    await extend(world, opening, reference.application_number);
    const declined = await applicant.hub.declineApplicationOffer(
      { ...reference, offer_number: 1 },
      { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
    );
    expect(declined.status(), await declined.text()).toBe(200);
    const orgView = await detail(world, opening, reference.application_number);
    expect(orgView.state).toBe("offer_declined");
    expect(orgView.interviews.map((entry) => entry.state)).toEqual([
      "cancelled",
    ]);
  });
});

test("an expired offer cancels upcoming interviews", async ({ request }) => {
  test.setTimeout(240_000);
  await withApplicant(request, "sgp", "sgp", async (applicant, world) => {
    const { reference, opening } = await shortlisted(applicant, world);
    await schedule(world, opening, reference.application_number);
    await extend(world, opening, reference.application_number, 1);
    orgSQL(
      `UPDATE vetchium.org_application_offers AS o
       SET extended_at = now() - interval '2 days',
         respond_by = now() - interval '1 second'
       FROM vetchium.org_applications AS a
       JOIN vetchium.org_openings AS op USING (org_opening_id)
       WHERE a.org_application_id = o.org_application_id
         AND op.org_did = ${sqlLiteral(world.did)}::uuid
         AND op.opening_number = ${opening}
         AND a.application_number = ${reference.application_number}`,
    );
    await expect
      .poll(
        async () =>
          (await detail(world, opening, reference.application_number)).state,
        { timeout: 15_000 },
      )
      .toBe("offer_declined");
    const orgView = await detail(world, opening, reference.application_number);
    expect(orgView.interviews.map((entry) => entry.state)).toEqual([
      "cancelled",
    ]);
  });
});

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

/** Applies through the Hub and shortlists to the Panel stage. */
async function shortlisted(
  applicant: Applicant,
  world: World,
): Promise<{ reference: ApplicationReference; opening: number }> {
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
    stage_id: stageOf(stages, 1).id,
  });
  expect(shortlist.status(), await shortlist.text()).toBe(200);
  return { reference, opening: opening.opening_number };
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
        const response = await applicant.hub.listMyApplications(
          {},
          applicant.token,
        );
        const listed = (
          (await response.json()) as ListMyApplicationsResponse
        ).applications.find(
          (entry) =>
            entry.org_domain === reference.domain &&
            entry.application_number === reference.application_number,
        );
        return listed && [listed.status, listed.pending_actions];
      },
      { timeout: 15_000 },
    )
    .toEqual([status, pendingActions]);
}

async function upload(world: World): Promise<string> {
  const response = await world.api.uploadOfferLetter(world.owner, pdf());
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as OfferLetterUploaded).letter_id;
}

async function extend(
  world: World,
  opening: number,
  application: number,
  days = 14,
): Promise<ApplicationDetail> {
  const response = await world.api.extendApplicationOffer(world.owner, {
    opening_number: opening,
    application_number: application,
    version: await version(world, opening, application),
    letter_id: await upload(world),
    respond_within_days: days,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as ApplicationDetail;
}

function accept(
  applicant: Applicant,
  reference: ApplicationReference,
  interview: number,
  key = hubIdempotencyKey(),
) {
  return applicant.hub.acceptApplicationInterview(
    { ...reference, interview_number: interview },
    { token: applicant.token, idempotencyKey: key },
  );
}

function reschedule(
  applicant: Applicant,
  reference: ApplicationReference,
  interview: number,
  note: string,
  key = hubIdempotencyKey(),
) {
  return applicant.hub.requestApplicationInterviewReschedule(
    { ...reference, interview_number: interview, note },
    { token: applicant.token, idempotencyKey: key },
  );
}

for (const [applicantTenant, label] of [
  ["sgp", "a local"],
  ["usa1", "a remote"],
] as const) {
  test(`${label} applicant reads, accepts, and asks to reschedule an interview`, async ({
    request,
  }) => {
    test.setTimeout(180_000);
    await withApplicant(
      request,
      applicantTenant,
      "sgp",
      async (applicant, world) => {
        const { reference, opening } = await shortlisted(applicant, world);
        const number = reference.application_number;
        await expectProjected(applicant, reference, "interviewing", []);
        const start = inFuture(240);
        await schedule(world, opening, number, {
          start_time: start,
          duration_minutes: 30,
        });

        // The applicant reads the interview without the stage or interviewers.
        const read = await myApplication(applicant, reference);
        expect(read).toMatchObject({
          status: "interviewing",
          pending_actions: ["interview_response"],
        });
        expect(read.interviews).toHaveLength(1);
        const interview = read.interviews[0];
        expect(interview && Object.keys(interview).sort()).toEqual([
          "duration_minutes",
          "interview_number",
          "mode",
          "response",
          "starts_at",
          "state",
          "video_url",
        ]);
        expect(interview).toMatchObject({
          interview_number: 1,
          state: "scheduled",
          duration_minutes: 30,
          mode: "video",
          video_url: "https://meet.example.com/room",
          response: "pending",
        });
        expect(JSON.stringify(read)).not.toContain("Panel");
        expect(JSON.stringify(read)).not.toContain(world.org.emailAddress);
        await expectProjected(applicant, reference, "interviewing", [
          "interview_response",
        ]);

        // Unknown and malformed answers.
        await expectProblem(
          await accept(applicant, reference, 9),
          404,
          HUB_NOT_FOUND,
        );
        await expectProblem(
          await reschedule(applicant, reference, 9, "Another day, please."),
          404,
          HUB_NOT_FOUND,
        );
        await expectProblem(
          await accept(
            applicant,
            { ...reference, application_number: number + 5 },
            1,
          ),
          404,
          HUB_NOT_FOUND,
        );

        const key = hubIdempotencyKey();
        const accepted = await accept(applicant, reference, 1, key);
        expect(accepted.status(), await accepted.text()).toBe(200);
        expect(accepted.headers()["cache-control"]).toBe("no-store");
        expect(await accepted.json()).toEqual(reference);
        const replay = await accept(applicant, reference, 1, key);
        expect(replay.status(), await replay.text()).toBe(200);
        await expectProblem(
          await accept(applicant, reference, 2, key),
          409,
          KEY_CONFLICT,
        );
        await expectProblem(
          await accept(applicant, reference, 1),
          409,
          HUB_STATE_CONFLICT,
        );
        expect(
          (await myApplication(applicant, reference)).interviews[0]?.response,
        ).toBe("accepted");
        await expectProjected(applicant, reference, "interviewing", []);
        const orgView = await detail(world, opening, number);
        expect(interviewOf(orgView, 1).applicant_response).toBe("accepted");
        expect((await history(world, opening, number))[0]).toMatchObject({
          action: "interview_accepted",
          actor: "applicant",
          interview_number: 1,
        });

        // A reschedule request carries a note the Org reads.
        const asked = await reschedule(
          applicant,
          reference,
          1,
          " Out of town ",
        );
        expect(asked.status(), await asked.text()).toBe(200);
        await expectProblem(
          await reschedule(applicant, reference, 1, "Again"),
          409,
          HUB_STATE_CONFLICT,
        );
        expect(
          interviewOf(await detail(world, opening, number), 1),
        ).toMatchObject({
          applicant_response: "reschedule_requested",
          reschedule_note: "Out of town",
        });
        expect(
          (await myApplication(applicant, reference)).interviews[0],
        ).toMatchObject({
          response: "reschedule_requested",
          reschedule_note: "Out of town",
        });
        expect((await history(world, opening, number))[0]).toMatchObject({
          action: "interview_reschedule_requested",
          actor: "applicant",
        });
        await expectProjected(applicant, reference, "interviewing", []);

        // The Org moving the interview asks the applicant again.
        const moved = await world.api.changeInterview(world.owner, {
          opening_number: opening,
          application_number: number,
          version: await version(world, opening, number),
          interview_number: 1,
          ...interviewDetails(world, { start_time: inFuture(300) }),
        });
        expect(moved.status(), await moved.text()).toBe(200);
        await expectProjected(applicant, reference, "interviewing", [
          "interview_response",
        ]);
        expect(
          (await myApplication(applicant, reference)).interviews[0],
        ).toMatchObject({
          response: "pending",
        });
        expect(
          (await myApplication(applicant, reference)).interviews[0]
            ?.reschedule_note,
        ).toBeUndefined();

        // A cancelled interview is shown as cancelled and cannot be answered.
        const cancelled = await world.api.cancelInterview(world.owner, {
          opening_number: opening,
          application_number: number,
          version: await version(world, opening, number),
          interview_number: 1,
        });
        expect(cancelled.status(), await cancelled.text()).toBe(200);
        expect(
          (await myApplication(applicant, reference)).interviews[0]?.state,
        ).toBe("cancelled");
        await expectProblem(
          await accept(applicant, reference, 1),
          409,
          HUB_STATE_CONFLICT,
        );
        await expectProblem(
          await reschedule(applicant, reference, 1, "Later please"),
          409,
          HUB_STATE_CONFLICT,
        );
        await expectProjected(applicant, reference, "interviewing", []);
      },
    );
  });
}

test("how an interview went never reaches the applicant", async ({
  request,
}) => {
  test.setTimeout(150_000);
  await withApplicant(request, "usa1", "sgp", async (applicant, world) => {
    const { reference, opening } = await shortlisted(applicant, world);
    const number = reference.application_number;
    await schedule(world, opening, number);
    await schedule(world, opening, number);
    startInterview(world, opening, number, 1);
    startInterview(world, opening, number, 2);
    for (const [interview, outcome] of [
      [1, "completed"],
      [2, "no_show"],
    ] as const) {
      const recorded = await world.api.recordInterviewOutcome(world.owner, {
        opening_number: opening,
        application_number: number,
        version: await version(world, opening, number),
        interview_number: interview,
        outcome,
      });
      expect(recorded.status(), await recorded.text()).toBe(200);
    }
    const submitted = await world.api.submitInterviewFeedback(world.owner, {
      opening_number: opening,
      application_number: number,
      version: await version(world, opening, number),
      interview_number: 1,
      recommendation: "strong_no",
      notes: "Secret verdict",
    });
    expect(submitted.status(), await submitted.text()).toBe(200);
    const read = await myApplication(applicant, reference);
    expect(read.interviews).toEqual([]);
    expect(JSON.stringify(read)).not.toMatch(
      /Secret|strong_no|no_show|completed/,
    );
    await expectProjected(applicant, reference, "interviewing", []);
    // The finished interviews cannot be answered either.
    await expectProblem(
      await accept(applicant, reference, 1),
      409,
      HUB_STATE_CONFLICT,
    );
  });
});

for (const verb of ["accept", "reschedule"] as const) {
  test(`an uncertain interview ${verb} is 202 and its replay returns the outcome`, async ({
    request,
  }) => {
    test.setTimeout(150_000);
    await withApplicant(request, "usa1", "sgp", async (applicant, world) => {
      const { reference, opening } = await shortlisted(applicant, world);
      await schedule(world, opening, reference.application_number);
      // A stale route sends the command to deu, which does not home the Org.
      const setHome = (tenant: TestTenant) =>
        globalSQLScalar(
          `UPDATE vetchium.org_principals
         SET home_tenant_id = ${sqlLiteral(tenant)},
           routing_version = routing_version + 1
         WHERE org_did = ${sqlLiteral(world.did)}::uuid`,
        );
      const answer = (key: string) =>
        verb === "accept"
          ? accept(applicant, reference, 1, key)
          : reschedule(applicant, reference, 1, "Mornings suit me.", key);
      const key = hubIdempotencyKey();
      setHome("deu");
      try {
        const pending = await answer(key);
        expect(pending.status(), await pending.text()).toBe(202);
        expect(pending.headers()["cache-control"]).toBe("no-store");
      } finally {
        setHome("sgp");
      }
      const answered = await answer(key);
      expect(answered.status(), await answered.text()).toBe(200);
      expect(
        interviewOf(
          await detail(world, opening, reference.application_number),
          1,
        ).applicant_response,
      ).toBe(verb === "accept" ? "accepted" : "reschedule_requested");
    });
  });
}

test("an applicant whose region cannot reach the directory gets hub-org-unavailable", async ({
  request,
}) => {
  // ind1 cannot reach its directory, so nothing is sent.
  await withApplicant(request, "ind1", "usa1", async (applicant, world) => {
    const reference = {
      domain: world.org.domain,
      opening_number: 1,
      application_number: 1,
    };
    await expectProblem(
      await accept(applicant, reference, 1),
      503,
      `${PREFIX}hub-org-unavailable`,
    );
    await expectProblem(
      await reschedule(applicant, reference, 1, "Later"),
      503,
      `${PREFIX}hub-org-unavailable`,
    );
  });
});

test("interview answers reject malformed, unauthenticated, and unknown requests", async ({
  request,
}) => {
  await withApplicant(request, "sgp", "sgp", async (applicant, world) => {
    const hub = applicant.hub;
    const reference = {
      domain: world.org.domain,
      opening_number: 1,
      application_number: 1,
      interview_number: 1,
    };
    for (const path of [
      "/accept-application-interview",
      "/request-application-interview-reschedule",
    ]) {
      const body = path.includes("reschedule")
        ? { ...reference, note: "Later" }
        : reference;
      await expectProblem(
        await hub.post(path, body, { idempotencyKey: hubIdempotencyKey() }),
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
          { ...body, interview_number: 0 },
          { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
        ),
        400,
        VALIDATION,
        ["interview_number"],
      );
      await expectProblem(
        await hub.post(path, body, { token: applicant.token }),
        400,
        VALIDATION,
        ["Idempotency-Key"],
      );
    }
    for (const note of ["", "   ", "é".repeat(501)]) {
      await expectProblem(
        await reschedule(applicant, reference, 1, note),
        400,
        VALIDATION,
        ["note"],
      );
    }
    await expectProblem(
      await accept(applicant, reference, 1),
      404,
      HUB_NOT_FOUND,
    );
    await expectProblem(
      await accept(
        applicant,
        { ...reference, domain: `unknown-${randomUUID()}.example.test` },
        1,
      ),
      404,
      HUB_NOT_FOUND,
    );
  });
});

test("every interview write authenticates, validates, and refuses suspended Orgs and stale requests", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withOrg(request, async (world) => {
    const { api, owner } = world;
    const { opening, application } = await panelCandidacy(world);
    await schedule(world, opening, application);
    const reference = {
      opening_number: opening,
      application_number: application,
      version: 2,
      interview_number: 1,
    };
    const bodies = {
      "schedule-interview": {
        ...reference,
        interview_number: undefined,
        ...interviewDetails(world),
      },
      "change-interview": { ...reference, ...interviewDetails(world) },
      "cancel-interview": reference,
      "record-interview-outcome": { ...reference, outcome: "completed" },
      "submit-interview-feedback": {
        ...reference,
        recommendation: "yes",
        notes: "Fine",
      },
    } as const;
    for (const [operation, body] of Object.entries(bodies)) {
      const path = operation as keyof typeof bodies;
      await expectProblem(
        await api.interviewWriteRaw(path, "not-a-token", body),
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
        await api.interviewWriteRaw(path, owner, { ...body, version: 0 }),
        400,
        VALIDATION,
        ["version"],
      );
      await expectProblem(
        await api.interviewWriteRaw(path, owner, {
          ...body,
          application_number: application + 100,
        }),
        404,
        NOT_FOUND,
      );
      await expectProblem(
        await api.interviewWriteRaw(path, owner, { ...body, version: 1 }),
        409,
        VERSION_CONFLICT,
      );
    }

    // A key bound to one successful request refuses a different one.
    const conflict = async (
      operation: keyof typeof bodies,
      body: Record<string, unknown>,
    ) => {
      const key = orgsIdempotencyKey();
      const current = await version(world, opening, application);
      const done = await api.interviewWriteRaw(
        operation,
        owner,
        { ...body, version: current },
        key,
      );
      expect(done.status(), await done.text()).toBe(200);
      await expectProblem(
        await api.interviewWriteRaw(
          operation,
          owner,
          { ...body, version: current + 1 },
          key,
        ),
        409,
        KEY_CONFLICT,
      );
    };
    await conflict("change-interview", bodies["change-interview"]);
    startInterview(world, opening, application, 1);
    await conflict(
      "record-interview-outcome",
      bodies["record-interview-outcome"],
    );
    await conflict(
      "submit-interview-feedback",
      bodies["submit-interview-feedback"],
    );
    await schedule(world, opening, application);
    await conflict("cancel-interview", { ...reference, interview_number: 2 });
    await expectProblem(
      await api.listMyInterviews(owner, { limit: 101 as never }),
      400,
      VALIDATION,
      ["limit"],
    );
    await expectProblem(
      await api.postRaw("/list-my-interviews", "{not json", { token: owner }),
      400,
      `${PREFIX}invalid-json`,
    );

    orgSQL(
      `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
       WHERE org_did = ${sqlLiteral(world.did)}::uuid`,
    );
    for (const [operation, body] of Object.entries(bodies)) {
      await expectProblem(
        await api.interviewWriteRaw(
          operation as keyof typeof bodies,
          owner,
          body,
        ),
        403,
        `${PREFIX}org-suspended`,
      );
    }
    await expectProblem(
      await api.listMyInterviews(owner, {}),
      403,
      `${PREFIX}org-suspended`,
    );
  });
});

/** Replaces the Opening's pipeline, giving the stage at `index` `form`. */
async function setForm(
  world: World,
  opening: number,
  index: number,
  form: FeedbackCriterion[],
): Promise<FeedbackCriterion[]> {
  const current = await world.api.getOpeningPipeline(world.owner, {
    opening_number: opening,
  });
  const pipeline = (await current.json()) as OpeningPipeline;
  const replaced = await world.api.replaceOpeningPipeline(world.owner, {
    opening_number: opening,
    version: pipeline.version,
    stages: pipeline.stages.map((stage, position) => ({
      id: stage.id,
      name: stage.name,
      kind: stage.kind,
      ...(stage.feedback_form && {
        feedback_form: position === index ? form : stage.feedback_form,
      }),
    })),
  });
  expect(replaced.status(), await replaced.text()).toBe(200);
  return (
    ((await replaced.json()) as OpeningPipeline).stages[index]?.feedback_form ??
    []
  );
}

test("feedback answers the stage's form, and readers see each answer's currency", async ({
  request,
}) => {
  test.setTimeout(180_000);
  await withOrg(request, async (world) => {
    const { api, owner, org } = world;
    await upgrade(world);
    const ada = await addOrgMember(api, owner, org.domain, `ada@${org.domain}`);
    const { opening, application } = await panelCandidacy(world);
    await schedule(world, opening, application, {
      interviewer_emails: [org.emailAddress, ada.emailAddress],
    });
    startInterview(world, opening, application, 1);
    const completed = await api.recordInterviewOutcome(owner, {
      opening_number: opening,
      application_number: application,
      version: await version(world, opening, application),
      interview_number: 1,
      outcome: "completed",
    });
    expect(completed.status(), await completed.text()).toBe(200);
    const submit = async (token: string, criteria_answers?: unknown[]) =>
      api.interviewWriteRaw("submit-interview-feedback", token, {
        opening_number: opening,
        application_number: application,
        version: await version(world, opening, application),
        interview_number: 1,
        recommendation: "yes",
        notes: "Solid systems depth",
        ...(criteria_answers && { criteria_answers }),
      });
    const expectInvalid = async (
      response: Awaited<ReturnType<typeof submit>>,
      ids: string[],
    ) => {
      expect(response.status(), await response.text()).toBe(422);
      expect(await response.json()).toMatchObject({
        type: FEEDBACK_ANSWERS_INVALID,
        criterion_ids: ids,
      });
    };
    const unknown = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a99";

    // Without a form only recommendation and notes are accepted.
    await expectInvalid(
      await submit(owner, [{ criterion_id: unknown, value: 3 }]),
      [unknown],
    );
    const plain = await submit(owner);
    expect(plain.status(), await plain.text()).toBe(200);

    const [depth, fit, notes] = (await setForm(world, opening, 1, [
      { text: "System design", type: "rating", required: true },
      { text: "Hire again", type: "yes_no", required: false },
      { text: "Notes", type: "text", required: false },
    ])) as [FeedbackCriterion, FeedbackCriterion, FeedbackCriterion];
    const depthID = depth.id as string;
    const fitID = fit.id as string;
    const notesID = notes.id as string;
    await expectInvalid(await submit(ada.token, []), [depthID]);
    for (const value of [0, 6, "4", true]) {
      await expectInvalid(
        await submit(ada.token, [{ criterion_id: depthID, value }]),
        [depthID],
      );
    }
    await expectInvalid(
      await submit(ada.token, [
        { criterion_id: depthID, value: 4 },
        { criterion_id: fitID, value: "yes" },
        { criterion_id: notesID, value: false },
      ]),
      [fitID, notesID],
    );
    await expectInvalid(
      await submit(ada.token, [
        { criterion_id: depthID, value: 4 },
        { criterion_id: fitID, value: true },
        { criterion_id: fitID, value: false },
      ]),
      [fitID],
    );
    await expectProblem(
      await submit(ada.token, [{ criterion_id: depthID, value: ["4"] }]),
      400,
      VALIDATION,
      ["criteria_answers.0.value"],
    );

    // Ada sees no one else's feedback, answers included, before her own.
    expect(
      interviewOf(await detail(world, opening, application, ada.token), 1)
        .feedback,
    ).toEqual([]);
    const adas = await submit(ada.token, [
      { criterion_id: notesID, value: " Strong reasoning " },
      { criterion_id: depthID, value: 4 },
    ]);
    expect(adas.status(), await adas.text()).toBe(200);
    const byEmail = (application: ApplicationDetail, email: string) =>
      interviewOf(application, 1).feedback.find(
        (entry) => entry.interviewer_email === email,
      );
    const adaView = (await adas.json()) as ApplicationDetail;
    expect(interviewOf(adaView, 1).stage.feedback_form).toEqual([
      depth,
      fit,
      notes,
    ]);
    expect(byEmail(adaView, org.emailAddress)?.criteria_answers).toEqual([]);
    expect(byEmail(adaView, ada.emailAddress)?.criteria_answers).toEqual([
      { ...depth, answer: 4, current: "same" },
      { ...fit, current: "same" },
      { ...notes, answer: "Strong reasoning", current: "same" },
    ]);

    // Answers keep the criteria as asked; currency follows the form now, and
    // `required` alone changes nothing.
    await setForm(world, opening, 1, [
      { ...depth, required: false },
      { ...fit, text: "Would hire again" },
    ]);
    const after = byEmail(
      await detail(world, opening, application),
      ada.emailAddress,
    );
    expect(after?.criteria_answers).toEqual([
      { ...depth, answer: 4, current: "same" },
      { ...fit, current: "changed" },
      { ...notes, answer: "Strong reasoning", current: "removed" },
    ]);
  });
});
