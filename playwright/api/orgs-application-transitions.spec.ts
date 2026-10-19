import { randomBytes, randomUUID } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type {
  ApplicationReference,
  ListMyApplicationsResponse,
} from "typespec/hub/applications/applications";
import type {
  ApplicationDetail,
  ApplicationHistoryEntry,
  ApplicationState,
  ListApplicationHistoryResponse,
} from "typespec/orgs/applications/applications";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { expectProblem } from "../lib/admin-api.ts";
import {
  cleanupGlobalHubPrincipal,
  cleanupHubUser,
  seedActiveHubUser,
  seedGlobalHubPrincipal,
  sqlLiteral,
  sqlScalarForTenant,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import { HubAPI, hubIdempotencyKey } from "../lib/hub-api.ts";
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

type Api = OrgsAPI;

const PREFIX = "vetchium-problem-details/";
const NOT_FOUND = `${PREFIX}org-application-not-found`;
const VERSION_CONFLICT = `${PREFIX}org-application-version-conflict`;
const STATE_CONFLICT = `${PREFIX}org-application-state-conflict`;
const PERMISSION_REQUIRED = `${PREFIX}org-permission-required`;
const KEY_CONFLICT = `${PREFIX}idempotency-key-conflict`;
const VALIDATION = `${PREFIX}validation-failed`;

/** Removes the outbox events the Org's applications queued for their
 * (fixture) applicants, which nothing delivers to, before the Org goes. */
function cleanupOutbox(domain: string): void {
  const did = orgDID(domain);
  if (did === "") return;
  orgSQL(
    `DELETE FROM vetchium.federation_outbox
     WHERE aggregate_type = 'org_application'
       AND aggregate_id LIKE ${sqlLiteral(`${did}:%`)}`,
  );
}

async function withOrg(
  request: APIRequestContext,
  body: (api: Api, owner: string, org: SignedUpOrg) => Promise<void>,
): Promise<void> {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    await body(api, await loginOrg(api, org), org);
  } finally {
    cleanupOutbox(org.domain);
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
}

function content(title: string, positions = 1): OpeningContent {
  return {
    title,
    description: "Build reliable services",
    language: "en",
    employing_country: "SG",
    work_arrangement: "hybrid",
    employment_type: "full_time",
    positions,
  };
}

/** A published Opening with the three-stage pipeline Screen (review), Panel
 * and Final (interview). The owner is its hiring manager and recruiter. */
async function publishedOpening(
  api: Api,
  owner: string,
  org: SignedUpOrg,
  options: { positions?: number; team?: string[] } = {},
): Promise<{ opening: OrgOpening; stages: PipelineStage[] }> {
  const created = await api.createOpening(owner, {
    content: content("Engineer", options.positions ?? 1),
    hiring_manager_email: org.emailAddress,
    recruiter_email: org.emailAddress,
    team_member_emails: options.team ?? [],
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
  return { opening: await reread(api, owner, opening), stages };
}

async function reread(
  api: Api,
  token: string,
  opening: OrgOpening,
): Promise<OrgOpening> {
  const response = await api.getOpening(token, {
    opening_number: opening.opening_number,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as OrgOpening;
}

/** UTC calendar date `days` from today, as the API reads dates. */
function utcDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function stageOf(stages: PipelineStage[], index: number): PipelineStage {
  const stage = stages[index];
  if (!stage) throw new Error(`expected stage ${index}`);
  return stage;
}

const orgDIDSQL = (domain: string) =>
  `(SELECT org_did FROM vetchium.org_domains WHERE domain = ${sqlLiteral(domain)})`;

interface SeedOptions {
  name?: string;
  state?: ApplicationState;
  stageId?: string;
  offerExtendedDaysAgo?: number;
  joinedOn?: string;
  joinedRecordedDaysAgo?: number;
  separatedOn?: string;
  separatedRecordedDaysAgo?: number;
}

/**
 * Inserts an application the way hub-apply would have (the applicant is a
 * fixture nobody can reach), in any state, and returns its number.
 */
function seedApplication(
  domain: string,
  openingNumber: number,
  options: SeedOptions = {},
): number {
  const state = options.state ?? "submitted";
  const stage = options.stageId ? sqlLiteral(options.stageId) : "NULL";
  const offer =
    options.offerExtendedDaysAgo === undefined
      ? "NULL"
      : `now() - interval '${options.offerExtendedDaysAgo} days'`;
  const joinedOn = options.joinedOn ? sqlLiteral(options.joinedOn) : "NULL";
  const joinedRecorded =
    options.joinedOn === undefined
      ? "NULL"
      : `now() - interval '${options.joinedRecordedDaysAgo ?? 0} days'`;
  const separatedOn = options.separatedOn
    ? sqlLiteral(options.separatedOn)
    : "NULL";
  const separatedRecorded =
    options.separatedOn === undefined
      ? "NULL"
      : `now() - interval '${options.separatedRecordedDaysAgo ?? 0} days'`;
  return Number(
    orgSQL(`
    WITH o AS (
      SELECT org_opening_id, org_did, next_application_number
      FROM vetchium.org_openings
      WHERE org_did = ${orgDIDSQL(domain)} AND opening_number = ${openingNumber}
    ), applicant AS (
      INSERT INTO vetchium.org_applicants
        (org_applicant_id, org_did, applicant_kind, hub_user_did)
      SELECT gen_random_uuid(), o.org_did, 'hub_user',
        overlay(gen_random_uuid()::text placing '7' from 15)::uuid
      FROM o RETURNING org_applicant_id
    ), application AS (
      INSERT INTO vetchium.org_applications (
        org_application_id, org_opening_id, application_number,
        org_applicant_id, application_state, snapshot, current_stage_id,
        offer_extended_at, joined_on, joined_recorded_at, separated_on,
        separated_recorded_at
      )
      SELECT gen_random_uuid(), o.org_opening_id, o.next_application_number,
        applicant.org_applicant_id, ${sqlLiteral(state)},
        jsonb_build_object('display_name',
          ${sqlLiteral(options.name ?? "Ada Lovelace")}::text,
          'handle', 'abcd1234-0123456789a'::text,
          'resident_country', 'GB'::text,
          'biography', 'Wrote the first program'::text,
          'websites', '[]'::jsonb, 'work_experiences', '[]'::jsonb,
          'certifications', '[]'::jsonb, 'language_abilities', '[]'::jsonb,
          'educational_qualifications', '[]'::jsonb),
        ${stage}::uuid, ${offer}, ${joinedOn}::date, ${joinedRecorded},
        ${separatedOn}::date, ${separatedRecorded}
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

async function detail(
  api: Api,
  token: string,
  opening: number,
  application: number,
): Promise<ApplicationDetail> {
  const response = await api.getApplication(token, {
    opening_number: opening,
    application_number: application,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as ApplicationDetail;
}

async function history(
  api: Api,
  token: string,
  opening: number,
  application: number,
): Promise<ApplicationHistoryEntry[]> {
  const response = await api.listApplicationHistory(token, {
    opening_number: opening,
    application_number: application,
  });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as ListApplicationHistoryResponse).entries;
}

/** A write that must succeed, returning the application it leaves. */
async function expectApplied(
  response: APIResponse,
): Promise<ApplicationDetail> {
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ApplicationDetail;
}

const statuses = (detail: ApplicationDetail) =>
  detail.stage_records.map((record) => record.status);

test("shortlisting records the stages, and replays and conflicts are exact", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const { opening, stages } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const [screen, panel] = [stageOf(stages, 0), stageOf(stages, 1)];
    const number = seedApplication(org.domain, n);
    const reference = { opening_number: n, application_number: number };

    // Refusals leave the application alone and run in the documented order.
    await expectProblem(
      await api.shortlistApplication(owner, {
        ...reference,
        application_number: number + 50,
        version: 1,
        stage_id: panel.id,
      }),
      404,
      NOT_FOUND,
    );
    await expectProblem(
      await api.shortlistApplication(owner, {
        ...reference,
        opening_number: n + 50,
        version: 1,
        stage_id: panel.id,
      }),
      404,
      NOT_FOUND,
    );
    await expectProblem(
      await api.shortlistApplication(owner, {
        ...reference,
        version: 7,
        stage_id: panel.id,
      }),
      409,
      VERSION_CONFLICT,
    );
    await expectProblem(
      await api.shortlistApplication(owner, {
        ...reference,
        version: 1,
        stage_id: randomUUID(),
      }),
      400,
      VALIDATION,
      ["stage_id"],
    );
    expect((await detail(api, owner, n, number)).version).toBe(1);

    const key = orgsIdempotencyKey();
    const request1 = { ...reference, version: 1, stage_id: panel.id };
    const shortlisted = await expectApplied(
      await api.shortlistApplication(owner, request1, key),
    );
    expect(shortlisted).toMatchObject({
      application_number: number,
      state: "in_pipeline",
      version: 2,
      current_stage: { id: panel.id, name: "Panel", kind: "interview" },
      positions: 1,
      joined_count: 0,
    });
    // The stage passed over is skipped; the chosen and later ones wait.
    expect(statuses(shortlisted)).toEqual(["skipped", "pending", "pending"]);
    expect(shortlisted.stage_records.map((record) => record.stage.id)).toEqual(
      stages.map((stage) => stage.id),
    );

    // The same key and body replays the stored result; another body does not.
    expect(
      await expectApplied(await api.shortlistApplication(owner, request1, key)),
    ).toEqual(shortlisted);
    await expectProblem(
      await api.shortlistApplication(
        owner,
        { ...request1, stage_id: screen.id },
        key,
      ),
      409,
      KEY_CONFLICT,
    );
    expect((await detail(api, owner, n, number)).version).toBe(2);

    // A fresh key sees the new state.
    await expectProblem(
      await api.shortlistApplication(owner, { ...request1, version: 2 }),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await api.shortlistApplication(owner, request1),
      409,
      VERSION_CONFLICT,
    );

    const entries = await history(api, owner, n, number);
    expect(entries[0]).toMatchObject({
      action: "shortlisted",
      actor: "org_user",
      actor_email: org.emailAddress,
      state: "in_pipeline",
      version: 2,
      stage: { id: panel.id, name: "Panel" },
    });
    expect(entries.map((entry) => entry.action)).toEqual([
      "shortlisted",
      "applied",
    ]);
    // History holds actions, states, and dates, never free text.
    expect(JSON.stringify(entries)).not.toContain("Lovelace");
  });
});

test("an application moves forward, skipping, and completes review stages", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const { opening, stages } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const [screen, panel, final] = [
      stageOf(stages, 0),
      stageOf(stages, 1),
      stageOf(stages, 2),
    ];
    const number = seedApplication(org.domain, n);
    const ref = (version: number) => ({
      opening_number: n,
      application_number: number,
      version,
    });

    const first = await expectApplied(
      await api.shortlistApplication(owner, {
        ...ref(1),
        stage_id: screen.id,
      }),
    );
    expect(statuses(first)).toEqual(["pending", "pending", "pending"]);

    // Only a review stage is completed by hand, and only while pending.
    const completed = await expectApplied(
      await api.completeApplicationStage(owner, ref(2)),
    );
    expect(completed.version).toBe(3);
    expect(statuses(completed)).toEqual(["completed", "pending", "pending"]);
    await expectProblem(
      await api.completeApplicationStage(owner, ref(3)),
      409,
      STATE_CONFLICT,
    );

    // Moving to the same or an earlier stage, or an unknown one, is refused.
    await expectProblem(
      await api.moveApplicationStage(owner, { ...ref(3), stage_id: screen.id }),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await api.moveApplicationStage(owner, {
        ...ref(3),
        stage_id: randomUUID(),
      }),
      400,
      VALIDATION,
      ["stage_id"],
    );
    await expectProblem(
      await api.moveApplicationStage(owner, { ...ref(2), stage_id: final.id }),
      409,
      VERSION_CONFLICT,
    );

    // Moving two stages ahead skips the one passed over; a finished stage
    // stays finished.
    const moved = await expectApplied(
      await api.moveApplicationStage(owner, { ...ref(3), stage_id: final.id }),
    );
    expect(moved).toMatchObject({
      state: "in_pipeline",
      version: 4,
      current_stage: { id: final.id },
    });
    expect(statuses(moved)).toEqual(["completed", "skipped", "pending"]);
    // An interview stage is never completed by hand.
    await expectProblem(
      await api.completeApplicationStage(owner, ref(4)),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await api.moveApplicationStage(owner, { ...ref(4), stage_id: panel.id }),
      409,
      STATE_CONFLICT,
    );

    const entries = await history(api, owner, n, number);
    expect(entries.map((entry) => entry.action)).toEqual([
      "stage_moved",
      "stage_completed",
      "shortlisted",
      "applied",
    ]);
    expect(entries[0]?.stage?.id).toBe(final.id);
    expect(entries[1]?.stage?.id).toBe(screen.id);

    const left = await expectApplied(
      await api.markApplicationNotProgressing(owner, ref(4)),
    );
    expect(left).toMatchObject({ state: "not_progressing", version: 5 });
    // The candidacy ended where it stood.
    expect(left.current_stage?.id).toBe(final.id);
  });
});

test("a stage added after shortlisting is recorded when the candidacy moves", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const { opening, stages } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const number = seedApplication(org.domain, n);
    await expectApplied(
      await api.shortlistApplication(owner, {
        opening_number: n,
        application_number: number,
        version: 1,
        stage_id: stageOf(stages, 0).id,
      }),
    );
    const current = await reread(api, owner, opening);
    const replaced = await api.replaceOpeningPipeline(owner, {
      opening_number: n,
      version: current.version,
      stages: [
        ...stages.map(({ id, name, kind }) => ({ id, name, kind })),
        { name: "Reference check", kind: "review" },
      ],
    });
    expect(replaced.status(), await replaced.text()).toBe(200);
    const extended = ((await replaced.json()) as { stages: PipelineStage[] })
      .stages;
    expect(extended).toHaveLength(4);
    expect((await detail(api, owner, n, number)).stage_records).toHaveLength(3);

    const moved = await expectApplied(
      await api.moveApplicationStage(owner, {
        opening_number: n,
        application_number: number,
        version: 2,
        stage_id: stageOf(extended, 3).id,
      }),
    );
    expect(moved.stage_records.map((record) => record.stage.name)).toEqual([
      "Screen",
      "Panel",
      "Final",
      "Reference check",
    ]);
    expect(statuses(moved)).toEqual([
      "skipped",
      "skipped",
      "skipped",
      "pending",
    ]);
  });
});

test("not progressing ends any live application and nothing leaves a terminal state", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const { opening, stages } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const panel = stageOf(stages, 1).id;
    const live: [ApplicationState, string | undefined][] = [
      ["submitted", undefined],
      ["in_pipeline", panel],
      ["offered", panel],
      ["offer_accepted", panel],
    ];
    for (const [state, stageId] of live) {
      const number = seedApplication(org.domain, n, {
        state,
        ...(stageId ? { stageId } : {}),
      });
      const ended = await expectApplied(
        await api.markApplicationNotProgressing(owner, {
          opening_number: n,
          application_number: number,
          version: 1,
        }),
      );
      expect(ended, state).toMatchObject({
        state: "not_progressing",
        version: 2,
      });
      const entries = await history(api, owner, n, number);
      expect(entries[0], state).toMatchObject({
        action: "not_progressing",
        actor: "org_user",
        state: "not_progressing",
        version: 2,
      });
    }
  });
});

test("every action refuses every state it does not allow", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const { opening, stages } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const [screen, panel, final] = [
      stageOf(stages, 0),
      stageOf(stages, 1),
      stageOf(stages, 2),
    ];
    const joined = { joinedOn: utcDate(-5) };
    const seeds: Record<ApplicationState, SeedOptions> = {
      submitted: {},
      in_pipeline: { state: "in_pipeline", stageId: panel.id },
      offered: { state: "offered", stageId: panel.id },
      offer_accepted: { state: "offer_accepted", stageId: panel.id },
      offer_declined: { state: "offer_declined", stageId: panel.id },
      joined: { state: "joined", stageId: panel.id, ...joined },
      did_not_join: { state: "did_not_join", stageId: panel.id },
      not_progressing: { state: "not_progressing" },
      withdrawn: { state: "withdrawn" },
    };
    const actions: Record<
      string,
      {
        allowed: ApplicationState[];
        call: (number: number) => Promise<APIResponse>;
      }
    > = {
      shortlist: {
        allowed: ["submitted"],
        call: (number) =>
          api.shortlistApplication(owner, {
            opening_number: n,
            application_number: number,
            version: 1,
            stage_id: screen.id,
          }),
      },
      move: {
        allowed: ["in_pipeline"],
        call: (number) =>
          api.moveApplicationStage(owner, {
            opening_number: n,
            application_number: number,
            version: 1,
            stage_id: final.id,
          }),
      },
      complete: {
        // The seeded candidacy is at an interview stage.
        allowed: [],
        call: (number) =>
          api.completeApplicationStage(owner, {
            opening_number: n,
            application_number: number,
            version: 1,
          }),
      },
      notProgressing: {
        allowed: ["submitted", "in_pipeline", "offered", "offer_accepted"],
        call: (number) =>
          api.markApplicationNotProgressing(owner, {
            opening_number: n,
            application_number: number,
            version: 1,
          }),
      },
      joined: {
        allowed: ["offer_accepted"],
        call: (number) =>
          api.recordApplicationJoined(owner, {
            opening_number: n,
            application_number: number,
            version: 1,
            joined_on: utcDate(-1),
          }),
      },
      didNotJoin: {
        allowed: ["offer_accepted"],
        call: (number) =>
          api.recordApplicationDidNotJoin(owner, {
            opening_number: n,
            application_number: number,
            version: 1,
          }),
      },
      separated: {
        allowed: ["joined"],
        call: (number) =>
          api.recordApplicationSeparated(owner, {
            opening_number: n,
            application_number: number,
            version: 1,
            separated_on: utcDate(-1),
          }),
      },
      correctJoined: {
        allowed: ["joined"],
        call: (number) =>
          api.correctApplicationJoinedOn(owner, {
            opening_number: n,
            application_number: number,
            version: 1,
            joined_on: utcDate(-2),
          }),
      },
      // No separation is recorded on the seeded joined application.
      correctSeparated: {
        allowed: [],
        call: (number) =>
          api.correctApplicationSeparatedOn(owner, {
            opening_number: n,
            application_number: number,
            version: 1,
            separated_on: utcDate(-1),
          }),
      },
    };
    const numbers = new Map<ApplicationState, number>();
    for (const [state, options] of Object.entries(seeds)) {
      numbers.set(
        state as ApplicationState,
        seedApplication(org.domain, n, { ...options, name: state }),
      );
    }
    for (const [name, action] of Object.entries(actions)) {
      for (const [state, number] of numbers) {
        if (action.allowed.includes(state)) continue;
        const response = await action.call(number);
        expect(
          response.status(),
          `${name} on ${state}: ${await response.text()}`,
        ).toBe(409);
        expect((await response.json()).type, `${name} on ${state}`).toBe(
          STATE_CONFLICT,
        );
      }
    }
    // Nothing changed.
    for (const [state, number] of numbers) {
      const after = await detail(api, owner, n, number);
      expect(after.version, state).toBe(1);
      expect(after.state, state).toBe(state);
    }
  });
});

test("joining and separation follow the date rules, keep history, and allow over-hiring", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const { opening, stages } = await publishedOpening(api, owner, org, {
      positions: 1,
    });
    const n = opening.opening_number;
    const final = stageOf(stages, 2).id;
    const accepted = (name: string, extended = 10) =>
      seedApplication(org.domain, n, {
        name,
        state: "offer_accepted",
        stageId: final,
        offerExtendedDaysAgo: extended,
      });
    const first = accepted("First Hire");
    const ref = (number: number, version = 1) => ({
      opening_number: n,
      application_number: number,
      version,
    });

    // joined_on is a real date, at most today, not before the offer.
    for (const joined_on of ["2026-02-30", "2026-1-1", "", "tomorrow"]) {
      await expectProblem(
        await api.recordApplicationJoined(owner, { ...ref(first), joined_on }),
        400,
        VALIDATION,
        ["joined_on"],
      );
    }
    for (const joined_on of [utcDate(2), utcDate(-30)]) {
      await expectProblem(
        await api.recordApplicationJoined(owner, { ...ref(first), joined_on }),
        400,
        VALIDATION,
        ["joined_on"],
      );
    }
    expect((await detail(api, owner, n, first)).state).toBe("offer_accepted");

    const key = orgsIdempotencyKey();
    const joinedRequest = { ...ref(first), joined_on: utcDate(-3) };
    const hired = await expectApplied(
      await api.recordApplicationJoined(owner, joinedRequest, key),
    );
    expect(hired).toMatchObject({
      state: "joined",
      version: 2,
      joined_on: utcDate(-3),
      positions: 1,
      joined_count: 1,
    });
    expect(hired.separated_on).toBeUndefined();
    expect(
      await expectApplied(
        await api.recordApplicationJoined(owner, joinedRequest, key),
      ),
    ).toEqual(hired);

    // Hiring beyond positions succeeds; the response carries both numbers.
    const second = accepted("Second Hire");
    const over = await expectApplied(
      await api.recordApplicationJoined(owner, {
        ...ref(second),
        joined_on: utcDate(0),
      }),
    );
    expect(over).toMatchObject({ joined_on: utcDate(0), positions: 1 });
    expect(over.joined_count).toBe(2);

    // Separation is after joining, within a year of it, and not in the
    // future; it is recorded once.
    for (const separated_on of [utcDate(-3), utcDate(-5), utcDate(2)]) {
      await expectProblem(
        await api.recordApplicationSeparated(owner, {
          ...ref(first, 2),
          separated_on,
        }),
        400,
        VALIDATION,
        ["separated_on"],
      );
    }
    const separated = await expectApplied(
      await api.recordApplicationSeparated(owner, {
        ...ref(first, 2),
        separated_on: utcDate(-1),
      }),
    );
    expect(separated).toMatchObject({
      state: "joined",
      version: 3,
      joined_on: utcDate(-3),
      separated_on: utcDate(-1),
    });
    await expectProblem(
      await api.recordApplicationSeparated(owner, {
        ...ref(first, 3),
        separated_on: utcDate(-1),
      }),
      409,
      STATE_CONFLICT,
    );

    // Corrections keep the dates consistent and add history, not edits.
    await expectProblem(
      await api.correctApplicationJoinedOn(owner, {
        ...ref(first, 3),
        joined_on: utcDate(-1),
      }),
      400,
      VALIDATION,
      ["joined_on"],
    );
    const fixedJoin = await expectApplied(
      await api.correctApplicationJoinedOn(owner, {
        ...ref(first, 3),
        joined_on: utcDate(-4),
      }),
    );
    expect(fixedJoin).toMatchObject({ joined_on: utcDate(-4), version: 4 });
    const fixedSeparation = await expectApplied(
      await api.correctApplicationSeparatedOn(owner, {
        ...ref(first, 4),
        separated_on: utcDate(-2),
      }),
    );
    expect(fixedSeparation).toMatchObject({
      joined_on: utcDate(-4),
      separated_on: utcDate(-2),
      version: 5,
    });
    const entries = await history(api, owner, n, first);
    expect(
      entries.map((entry) => [
        entry.action,
        entry.joined_on,
        entry.separated_on,
      ]),
    ).toEqual([
      ["separated_corrected", undefined, utcDate(-2)],
      ["joined_corrected", utcDate(-4), undefined],
      ["separated", undefined, utcDate(-1)],
      ["joined", utcDate(-3), undefined],
      ["applied", undefined, undefined],
    ]);

    // Did not join ends an accepted offer without a date.
    const declined = accepted("Never Joined");
    const none = await expectApplied(
      await api.recordApplicationDidNotJoin(owner, ref(declined)),
    );
    expect(none).toMatchObject({ state: "did_not_join", version: 2 });
    expect(none.joined_on).toBeUndefined();
    expect((await history(api, owner, n, declined))[0]?.action).toBe(
      "did_not_join",
    );
  });
});

test("a separation more than a year after joining is refused", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const { opening, stages } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const number = seedApplication(org.domain, n, {
      state: "offer_accepted",
      stageId: stageOf(stages, 2).id,
      offerExtendedDaysAgo: 800,
    });
    const joined = await expectApplied(
      await api.recordApplicationJoined(owner, {
        opening_number: n,
        application_number: number,
        version: 1,
        joined_on: utcDate(-500),
      }),
    );
    const request2 = (separated_on: string) => ({
      opening_number: n,
      application_number: number,
      version: joined.version,
      separated_on,
    });
    await expectProblem(
      await api.recordApplicationSeparated(owner, request2(utcDate(-100))),
      400,
      VALIDATION,
      ["separated_on"],
    );
    await expectApplied(
      await api.recordApplicationSeparated(owner, request2(utcDate(-136))),
    );
  });
});

test("dates are corrected only within 90 days of first recording", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const { opening, stages } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const panel = stageOf(stages, 1).id;
    const seed = (recordedDaysAgo: number) =>
      seedApplication(org.domain, n, {
        state: "joined",
        stageId: panel,
        joinedOn: utcDate(-200),
        joinedRecordedDaysAgo: recordedDaysAgo,
        separatedOn: utcDate(-100),
        separatedRecordedDaysAgo: recordedDaysAgo,
      });
    const late = seed(91);
    const timely = seed(89);
    const body = (number: number) => ({
      opening_number: n,
      application_number: number,
      version: 1,
    });

    await expectProblem(
      await api.correctApplicationJoinedOn(owner, {
        ...body(late),
        joined_on: utcDate(-201),
      }),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await api.correctApplicationSeparatedOn(owner, {
        ...body(late),
        separated_on: utcDate(-101),
      }),
      409,
      STATE_CONFLICT,
    );
    expect((await detail(api, owner, n, late)).version).toBe(1);

    const joined = await expectApplied(
      await api.correctApplicationJoinedOn(owner, {
        ...body(timely),
        joined_on: utcDate(-201),
      }),
    );
    expect(joined).toMatchObject({ joined_on: utcDate(-201), version: 2 });
    const separated = await expectApplied(
      await api.correctApplicationSeparatedOn(owner, {
        ...body(timely),
        version: 2,
        separated_on: utcDate(-101),
      }),
    );
    expect(separated).toMatchObject({
      separated_on: utcDate(-101),
      version: 3,
    });
    // A correction does not reopen the window.
    const recorded = orgSQL(
      `SELECT joined_recorded_at < now() - interval '88 days'
       FROM vetchium.org_applications
       WHERE org_application_id = (
         SELECT a.org_application_id FROM vetchium.org_applications AS a
         JOIN vetchium.org_openings AS o USING (org_opening_id)
         WHERE o.org_did = ${orgDIDSQL(org.domain)}
           AND o.opening_number = ${n} AND a.application_number = ${timely})`,
    );
    expect(recorded).toBe("t");
  });
});

test("who may act: manager, recruiter, and candidacies holders act; team members read only", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const upgraded = await api.setSubscriptionPlan(owner, {
      plan_oid: "org-silver-tier",
      billing_interval: "month",
    });
    expect(upgraded.status(), await upgraded.text()).toBe(200);
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

    const { opening } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const team = await api.setOpeningTeam(owner, {
      opening_number: n,
      version: (await reread(api, owner, opening)).version,
      hiring_manager_email: hiringManager.emailAddress,
      recruiter_email: recruiter.emailAddress,
      team_member_emails: [teammate.emailAddress],
    });
    expect(team.status(), await team.text()).toBe(200);

    const attempt = async (token: string) => {
      const number = seedApplication(org.domain, n);
      const response = await api.markApplicationNotProgressing(token, {
        opening_number: n,
        application_number: number,
        version: 1,
      });
      return { number, response };
    };
    for (const actor of [
      { token: owner, name: "the superadmin" },
      { token: hiringManager.token, name: "the hiring manager" },
      { token: recruiter.token, name: "the recruiter" },
      { token: candidacies.token, name: "an org:manage_candidacies holder" },
    ]) {
      const { response } = await attempt(actor.token);
      expect(response.status(), `${actor.name}: ${await response.text()}`).toBe(
        200,
      );
    }
    // A hiring-team member reads the application but cannot act on it.
    const team1 = await attempt(teammate.token);
    await expectProblem(team1.response, 403, PERMISSION_REQUIRED);
    expect((await detail(api, owner, n, team1.number)).state).toBe("submitted");
    // Everyone else cannot even tell the application exists.
    for (const denied of [
      { token: viewer.token, name: "an org:view_openings holder" },
      { token: openingsManager.token, name: "an org:manage_openings holder" },
      { token: approver.token, name: "an org:approve_openings holder" },
      { token: plain.token, name: "a member with no grant" },
    ]) {
      const { number, response } = await attempt(denied.token);
      await expectProblem(response, 404, NOT_FOUND);
      expect((await detail(api, owner, n, number)).state, denied.name).toBe(
        "submitted",
      );
    }

    // The check is made on each call, so a revoked grant stops at once.
    const revoked = await api.setUserPermissions(owner, {
      email_address: candidacies.emailAddress,
      permissions: [],
    });
    expect(revoked.status(), await revoked.text()).toBe(204);
    await expectProblem(
      (await attempt(candidacies.token)).response,
      404,
      NOT_FOUND,
    );
  });
});

test("application write routes authenticate, validate, and refuse suspended Orgs", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const { opening, stages } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const number = seedApplication(org.domain, n);
    const base = { opening_number: n, application_number: number, version: 1 };
    const stage = { ...base, stage_id: stageOf(stages, 0).id };
    const routes: {
      path: string;
      body: object;
      invalid: object;
      fields: string[];
    }[] = [
      {
        path: "/shortlist-application",
        body: stage,
        invalid: { ...stage, stage_id: "NOT-A-UUID" },
        fields: ["stage_id"],
      },
      {
        path: "/move-application-stage",
        body: stage,
        invalid: { ...stage, version: 0 },
        fields: ["version"],
      },
      {
        path: "/complete-application-stage",
        body: base,
        invalid: { ...base, opening_number: 0 },
        fields: ["opening_number"],
      },
      {
        path: "/mark-application-not-progressing",
        body: base,
        invalid: { ...base, application_number: 0 },
        fields: ["application_number"],
      },
      {
        path: "/record-application-joined",
        body: { ...base, joined_on: utcDate(-1) },
        invalid: { ...base, joined_on: "2026-13-01" },
        fields: ["joined_on"],
      },
      {
        path: "/record-application-did-not-join",
        body: base,
        invalid: { opening_number: 0, application_number: 0, version: 0 },
        fields: ["opening_number", "application_number", "version"],
      },
      {
        path: "/record-application-separated",
        body: { ...base, separated_on: utcDate(-1) },
        invalid: { ...base, separated_on: "soon" },
        fields: ["separated_on"],
      },
      {
        path: "/correct-application-joined-on",
        body: { ...base, joined_on: utcDate(-1) },
        invalid: base,
        fields: ["joined_on"],
      },
      {
        path: "/correct-application-separated-on",
        body: { ...base, separated_on: utcDate(-1) },
        invalid: base,
        fields: ["separated_on"],
      },
    ];
    for (const route of routes) {
      const key = { idempotencyKey: orgsIdempotencyKey() };
      const unauthenticated = await api.post(route.path, route.body, key);
      expect(unauthenticated.status(), route.path).toBe(401);
      const malformed = await api.postRaw(route.path, "{", {
        token: owner,
        ...key,
      });
      expect(malformed.status(), route.path).toBe(400);
      expect((await malformed.json()).type).toContain("invalid-json");
      const keyless = await api.post(route.path, route.body, { token: owner });
      await expectProblem(keyless, 400, VALIDATION, ["Idempotency-Key"]);
      await expectProblem(
        await api.post(route.path, route.invalid, { token: owner, ...key }),
        400,
        VALIDATION,
        route.fields,
      );
    }
    expect((await detail(api, owner, n, number)).version).toBe(1);

    orgSQL(`UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
      WHERE org_did = ${orgDIDSQL(org.domain)}`);
    for (const route of routes) {
      const blocked = await api.post(route.path, route.body, {
        token: owner,
        idempotencyKey: orgsIdempotencyKey(),
      });
      expect(blocked.status(), `${route.path}: ${await blocked.text()}`).toBe(
        403,
      );
      expect((await blocked.json()).type).toContain("org-suspended");
    }
  });
});

/** Seeds one application per state a close can reach or must leave alone. */
function seedMixed(domain: string, n: number, stageId: string) {
  return {
    submitted: seedApplication(domain, n, { name: "Submitted" }),
    inPipeline: seedApplication(domain, n, {
      name: "In Pipeline",
      state: "in_pipeline",
      stageId,
    }),
    offered: seedApplication(domain, n, {
      name: "Offered",
      state: "offered",
      stageId,
    }),
    offerAccepted: seedApplication(domain, n, {
      name: "Accepted",
      state: "offer_accepted",
      stageId,
    }),
    joined: seedApplication(domain, n, {
      name: "Joined",
      state: "joined",
      stageId,
      joinedOn: utcDate(-5),
    }),
    withdrawn: seedApplication(domain, n, {
      name: "Withdrawn",
      state: "withdrawn",
    }),
  };
}

async function states(
  api: Api,
  token: string,
  n: number,
  numbers: Record<string, number>,
): Promise<Record<string, ApplicationState>> {
  const out: Record<string, ApplicationState> = {};
  for (const [name, number] of Object.entries(numbers)) {
    out[name] = (await detail(api, token, n, number)).state;
  }
  return out;
}

const untouched = {
  submitted: "submitted",
  inPipeline: "in_pipeline",
  offered: "offered",
  offerAccepted: "offer_accepted",
  joined: "joined",
  withdrawn: "withdrawn",
};
const closed = {
  submitted: "not_progressing",
  inPipeline: "not_progressing",
  offered: "not_progressing",
  offerAccepted: "not_progressing",
  joined: "joined",
  withdrawn: "withdrawn",
};

test("an approver's close marks open applications only when asked", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    // Without the choice, a close leaves every application as it is.
    const plain = await publishedOpening(api, owner, org);
    const plainNumbers = seedMixed(
      org.domain,
      plain.opening.opening_number,
      stageOf(plain.stages, 1).id,
    );
    const plainClose = await api.requestOpeningChange(owner, {
      opening_number: plain.opening.opening_number,
      version: plain.opening.version,
      kind: "close",
    });
    expect(plainClose.status(), await plainClose.text()).toBe(200);
    expect(((await plainClose.json()) as OrgOpening).state).toBe("closed");
    expect(
      await states(api, owner, plain.opening.opening_number, plainNumbers),
    ).toEqual(untouched);

    // With it, in the same transaction, and a repeat with the key replays.
    const marked = await publishedOpening(api, owner, org);
    const n = marked.opening.opening_number;
    const numbers = seedMixed(org.domain, n, stageOf(marked.stages, 1).id);
    const key = orgsIdempotencyKey();
    const closeRequest = {
      opening_number: n,
      version: marked.opening.version,
      kind: "close" as const,
      mark_applications_not_progressing: true,
    };
    const response = await api.requestOpeningChange(owner, closeRequest, key);
    expect(response.status(), await response.text()).toBe(200);
    expect(((await response.json()) as OrgOpening).state).toBe("closed");
    expect(await states(api, owner, n, numbers)).toEqual(closed);
    expect(
      (await api.requestOpeningChange(owner, closeRequest, key)).status(),
    ).toBe(200);

    // Each marked application got a history entry and its version moved.
    const accepted = await detail(api, owner, n, numbers.offerAccepted);
    expect(accepted.version).toBe(2);
    const entries = await history(api, owner, n, numbers.offerAccepted);
    expect(entries[0]).toMatchObject({
      action: "not_progressing",
      actor: "org_user",
      actor_email: org.emailAddress,
      state: "not_progressing",
    });
    // Terminal applications are not touched.
    expect((await detail(api, owner, n, numbers.joined)).version).toBe(1);
    expect(await history(api, owner, n, numbers.joined)).toHaveLength(1);
  });
});

test("a close request's bulk choice applies only when an approver approves it", async ({
  request,
}) => {
  await withOrg(request, async (api, owner, org) => {
    const manager = await addOrgMember(
      api,
      owner,
      org.domain,
      `manager@${org.domain}`,
      ["org:manage_openings"],
    );
    const ask = async (mark: boolean | undefined) => {
      const { opening, stages } = await publishedOpening(api, owner, org);
      const n = opening.opening_number;
      const numbers = seedMixed(org.domain, n, stageOf(stages, 1).id);
      const requested = await api.requestOpeningChange(manager.token, {
        opening_number: n,
        version: opening.version,
        kind: "close",
        ...(mark === undefined
          ? {}
          : { mark_applications_not_progressing: mark }),
      });
      expect(requested.status(), await requested.text()).toBe(200);
      const pending = (await requested.json()) as OrgOpening;
      return { n, numbers, pending };
    };

    // Asking changes nothing until the decision, and shows the choice.
    const approved = await ask(true);
    expect(approved.pending.state).toBe("published");
    expect(approved.pending.pending_request).toMatchObject({
      kind: "close",
      mark_applications_not_progressing: true,
    });
    expect(await states(api, owner, approved.n, approved.numbers)).toEqual(
      untouched,
    );
    const decided = await api.decideOpeningRequest(owner, {
      opening_number: approved.n,
      version: approved.pending.version,
      decision: "approve",
    });
    expect(decided.status(), await decided.text()).toBe(200);
    expect(((await decided.json()) as OrgOpening).state).toBe("closed");
    expect(await states(api, owner, approved.n, approved.numbers)).toEqual(
      closed,
    );

    // Rejected: neither the Opening nor any application changes.
    const rejected = await ask(true);
    const rejection = await api.decideOpeningRequest(owner, {
      opening_number: rejected.n,
      version: rejected.pending.version,
      decision: "reject",
      note: "Not yet",
    });
    expect(rejection.status(), await rejection.text()).toBe(200);
    expect(await states(api, owner, rejected.n, rejected.numbers)).toEqual(
      untouched,
    );

    // Asked for without the choice, approving marks nothing.
    const declined = await ask(false);
    expect(
      declined.pending.pending_request?.mark_applications_not_progressing,
    ).toBe(false);
    const noMark = await api.decideOpeningRequest(owner, {
      opening_number: declined.n,
      version: declined.pending.version,
      decision: "approve",
    });
    expect(noMark.status(), await noMark.text()).toBe(200);
    expect(await states(api, owner, declined.n, declined.numbers)).toEqual(
      untouched,
    );

    // An approver's own close supersedes a pending one and uses its own choice.
    const superseded = await ask(false);
    const override = await api.requestOpeningChange(owner, {
      opening_number: superseded.n,
      version: superseded.pending.version,
      kind: "close",
      mark_applications_not_progressing: true,
    });
    expect(override.status(), await override.text()).toBe(200);
    expect(await states(api, owner, superseded.n, superseded.numbers)).toEqual(
      closed,
    );

    // The choice belongs to a close request only.
    const { opening } = await publishedOpening(api, owner, org);
    await expectProblem(
      await api.requestOpeningChange(owner, {
        opening_number: opening.opening_number,
        version: opening.version,
        kind: "pause",
        mark_applications_not_progressing: true,
      }),
      400,
      VALIDATION,
      ["mark_applications_not_progressing"],
    );
  });
});

// --- Hub status after each change, with real applicants. ------------------

interface Applicant {
  email: string;
  did: string;
  alias: string;
  token: string;
  hub: HubAPI;
}

const ALIAS_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function seedApplicant(request: APIRequestContext, name: string): Applicant {
  const email = `e2e+${randomUUID()}@e2e-org-transitions.example.test`;
  const seeded = seedActiveHubUser("sgp", email, name);
  let alias = "e2e-";
  for (const byte of randomBytes(20)) {
    alias += ALIAS_ALPHABET[byte % ALIAS_ALPHABET.length];
  }
  seedGlobalHubPrincipal(seeded.hubUserDID, "sgp", alias);
  return {
    email,
    did: seeded.hubUserDID,
    alias,
    token: seeded.sessionToken,
    hub: new HubAPI(request, "sgp"),
  };
}

function cleanupApplicant(applicant: Applicant, orgDIDValue: string): void {
  const did = sqlLiteral(applicant.did);
  const commandIDs = sqlScalarForTenant(
    "sgp",
    `SELECT coalesce(string_agg(quote_literal(command_id::text), ','), '')
     FROM vetchium.federation_operations
     WHERE owner_principal_type = 'hub_user' AND owner_principal_id = ${did}`,
  );
  sqlScalarForTenant(
    "sgp",
    `${
      commandIDs === ""
        ? ""
        : `DELETE FROM vetchium.federation_command_ledger
           WHERE command_id::text IN (${commandIDs});`
    }
     DELETE FROM vetchium.federation_outbox
     WHERE destination_principal_did = ${did}::uuid;
     DELETE FROM vetchium.audit_events
     WHERE entity_type = 'federation_event' AND entity_id IN (
       SELECT event_id::text FROM vetchium.federation_inbox
       WHERE aggregate_type = 'org_application'
         AND aggregate_id LIKE ${sqlLiteral(`${orgDIDValue}:%`)});
     DELETE FROM vetchium.federation_inbox
     WHERE aggregate_type = 'org_application'
       AND aggregate_id LIKE ${sqlLiteral(`${orgDIDValue}:%`)};
     DELETE FROM vetchium.federation_event_watermarks
     WHERE destination_principal_did = ${did}::uuid;`,
  );
  cleanupGlobalHubPrincipal(applicant.did, applicant.alias);
  cleanupHubUser(applicant.email, "sgp");
}

async function applyTo(
  applicant: Applicant,
  domain: string,
  opening: number,
): Promise<ApplicationReference> {
  const response = await applicant.hub.applyToOpening(
    { domain, opening_number: opening },
    { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
  );
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as ApplicationReference;
}

async function expectProjected(
  applicant: Applicant,
  reference: ApplicationReference,
  status: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await applicant.hub.listMyApplications(
          {},
          applicant.token,
        );
        const list = (await response.json()) as ListMyApplicationsResponse;
        return list.applications.find(
          (entry) =>
            entry.org_domain === reference.domain &&
            entry.opening_number === reference.opening_number &&
            entry.application_number === reference.application_number,
        )?.status;
      },
      { timeout: 15_000 },
    )
    .toBe(status);
}

test("every change reaches the applicant's Hub status", async ({ request }) => {
  test.setTimeout(120_000);
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  const ada = seedApplicant(request, "Ada Applicant");
  const grace = seedApplicant(request, "Grace Applicant");
  try {
    const owner = await loginOrg(api, org);
    const { opening, stages } = await publishedOpening(api, owner, org);
    const n = opening.opening_number;
    const [screen, panel] = [stageOf(stages, 0), stageOf(stages, 1)];
    const adaRef = await applyTo(ada, org.domain, n);
    const graceRef = await applyTo(grace, org.domain, n);
    await expectProjected(ada, adaRef, "applied");
    const at = (ref: ApplicationReference, version: number) => ({
      opening_number: n,
      application_number: ref.application_number,
      version,
    });

    await expectApplied(
      await api.shortlistApplication(owner, {
        ...at(adaRef, 1),
        stage_id: screen.id,
      }),
    );
    await expectProjected(ada, adaRef, "in_review");
    await expectApplied(
      await api.completeApplicationStage(owner, at(adaRef, 2)),
    );
    await expectProjected(ada, adaRef, "in_review");
    await expectApplied(
      await api.moveApplicationStage(owner, {
        ...at(adaRef, 3),
        stage_id: panel.id,
      }),
    );
    await expectProjected(ada, adaRef, "interviewing");
    // The live read agrees, and shows no stage, feedback, or version.
    const live = await ada.hub.getMyApplication(adaRef, ada.token);
    expect(live.status(), await live.text()).toBe(200);
    const liveText = await live.text();
    expect(((await live.json()) as { status: string }).status).toBe(
      "interviewing",
    );
    for (const internal of ["Panel", "stage", "version", "snapshot"]) {
      expect(liveText).not.toContain(internal);
    }
    await expectApplied(
      await api.markApplicationNotProgressing(owner, at(adaRef, 4)),
    );
    await expectProjected(ada, adaRef, "not_progressing");

    // Closing with the bulk choice reaches applicants who never heard from
    // the Org.
    const closedOpening = await api.requestOpeningChange(owner, {
      opening_number: n,
      version: (await reread(api, owner, opening)).version,
      kind: "close",
      mark_applications_not_progressing: true,
    });
    expect(closedOpening.status(), await closedOpening.text()).toBe(200);
    await expectProjected(grace, graceRef, "not_progressing");
  } finally {
    const did = orgDID(org.domain);
    cleanupApplicant(ada, did);
    cleanupApplicant(grace, did);
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
