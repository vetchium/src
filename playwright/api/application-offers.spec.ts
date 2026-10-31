import { randomUUID } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type { DeliverEventRequest } from "typespec/federation/events";
import type { HubApplicationChangedPayload } from "typespec/federation/hiring";
import type {
  ApplicationReference,
  MyApplicationDetail,
  MyApplicationSummary,
  RespondToOfferRequest,
} from "typespec/hub/applications/applications";
import type {
  ApplicationDetail,
  ApplicationHistoryEntry,
  ApplicationState,
  ListApplicationHistoryResponse,
  OfferLetterUploaded,
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
import { meshPeerRequest } from "../lib/mesh.ts";
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
import { applicationStages, utcDate } from "../lib/orgs-applications.ts";

const PREFIX = "vetchium-problem-details/";
const LETTER_INVALID = `${PREFIX}org-offer-letter-invalid`;
const LETTER_TOO_LARGE = `${PREFIX}org-offer-letter-too-large`;
const LETTER_CONFLICT = `${PREFIX}org-offer-letter-conflict`;
const NOT_FOUND = `${PREFIX}org-application-not-found`;
const VERSION_CONFLICT = `${PREFIX}org-application-version-conflict`;
const STATE_CONFLICT = `${PREFIX}org-application-state-conflict`;
const PERMISSION_REQUIRED = `${PREFIX}org-permission-required`;
const KEY_CONFLICT = `${PREFIX}idempotency-key-conflict`;
const VALIDATION = `${PREFIX}validation-failed`;
const HUB_STATE_CONFLICT = `${PREFIX}hub-application-state-conflict`;
const HUB_NOT_FOUND = `${PREFIX}hub-application-not-found`;
const MAX_LETTER = 5 * 1024 * 1024;

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

/** Removes the outbox events an Org's applications queued. */
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
  const stages = applicationStages(
    ((await replaced.json()) as { stages: PipelineStage[] }).stages,
  );
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

/** The version of a seeded candidacy: applied (1), then shortlisted. */
const SHORTLISTED = 2;

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
): Promise<ApplicationHistoryEntry[]> {
  const response = await world.api.listApplicationHistory(world.owner, {
    opening_number: opening,
    application_number: application,
  });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as ListApplicationHistoryResponse).entries;
}

async function upload(
  world: World,
  letter: Buffer = offerLetter(),
  token = world.owner,
): Promise<string> {
  const response = await world.api.uploadOfferLetter(token, letter);
  expect(response.status(), await response.text()).toBe(201);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return ((await response.json()) as OfferLetterUploaded).letter_id;
}

async function extend(
  world: World,
  opening: number,
  application: number,
  options: { letter?: Buffer; version?: number; days?: number } = {},
): Promise<ApplicationDetail> {
  const letterID = await upload(world, options.letter);
  const response = await world.api.extendApplicationOffer(world.owner, {
    opening_number: opening,
    application_number: application,
    version:
      options.version ?? (await detail(world, opening, application)).version,
    letter_id: letterID,
    proposed_joining_date: utcDate(30),
    respond_within_days: options.days ?? 14,
  });
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ApplicationDetail;
}

/** Reads the letter behind a signed link the way a browser would. */
async function expectLetter(url: string, letter: Buffer): Promise<void> {
  const response = await fetch(url);
  expect(response.status, url).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(Buffer.from(await response.arrayBuffer()).equals(letter)).toBe(true);
}

test("upload-offer-letter stores only a PDF of at most 5 MiB, idempotently", async ({
  request,
}) => {
  test.setTimeout(60_000);
  await withOrg(request, async (world) => {
    await publishedOpening(world);
    const { api, owner } = world;
    const letter = offerLetter();
    const key = orgsIdempotencyKey();
    const first = await api.uploadOfferLetter(owner, letter, undefined, key);
    expect(first.status(), await first.text()).toBe(201);
    const uploaded = (await first.json()) as OfferLetterUploaded;
    expect(uploaded.letter_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const replay = await api.uploadOfferLetter(owner, letter, undefined, key);
    expect(replay.status(), await replay.text()).toBe(201);
    expect(await replay.json()).toEqual(uploaded);
    await expectProblem(
      await api.uploadOfferLetter(owner, offerLetter(), undefined, key),
      409,
      KEY_CONFLICT,
    );

    await expectProblem(
      await api.uploadOfferLetter(owner, letter, "image/png"),
      400,
      LETTER_INVALID,
    );
    await expectProblem(
      await api.uploadOfferLetter(owner, Buffer.from("GIF89a not a pdf")),
      400,
      LETTER_INVALID,
    );
    await expectProblem(
      await api.uploadOfferLetter(owner, Buffer.alloc(0)),
      400,
      LETTER_INVALID,
    );
    const oversized = Buffer.alloc(MAX_LETTER + 1, 0x20);
    oversized.write("%PDF-1.4\n");
    await expectProblem(
      await api.uploadOfferLetter(owner, oversized),
      413,
      LETTER_TOO_LARGE,
    );
    const exact = oversized.subarray(0, MAX_LETTER);
    const atLimit = await api.uploadOfferLetter(owner, exact);
    expect(atLimit.status(), await atLimit.text()).toBe(201);

    const withoutKey = await api.request.post(
      `${api.origin}/api/orgs/upload-offer-letter`,
      {
        data: letter,
        headers: {
          Authorization: `Bearer ${owner}`,
          "Content-Type": "application/pdf",
        },
      },
    );
    await expectProblem(withoutKey, 400, VALIDATION, ["Idempotency-Key"]);
    await expectProblem(
      await api.request.post(`${api.origin}/api/orgs/upload-offer-letter`, {
        data: letter,
        headers: {
          "Content-Type": "application/pdf",
          "Idempotency-Key": orgsIdempotencyKey(),
        },
      }),
      401,
      `${PREFIX}org-authentication-required`,
    );
  });
});

test("only a user who acts on some Opening's applications uploads letters", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withOrg(request, async (world) => {
    const { api, owner, org } = world;
    const upgraded = await api.setSubscriptionPlan(owner, {
      plan_oid: "org-silver-tier",
      billing_interval: "month",
    });
    expect(upgraded.status(), await upgraded.text()).toBe(200);
    const teammate = await addOrgMember(
      api,
      owner,
      org.domain,
      `teammate@${org.domain}`,
    );
    const candidacies = await addOrgMember(
      api,
      owner,
      org.domain,
      `candidacies@${org.domain}`,
      ["org:manage_candidacies"],
    );
    const viewer = await addOrgMember(
      api,
      owner,
      org.domain,
      `viewer@${org.domain}`,
      ["org:view_openings"],
    );
    await publishedOpening(world, [teammate.emailAddress]);
    for (const token of [teammate.token, viewer.token]) {
      await expectProblem(
        await api.uploadOfferLetter(token, offerLetter()),
        403,
        PERMISSION_REQUIRED,
      );
    }
    await upload(world, offerLetter(), candidacies.token);

    orgSQL(
      `UPDATE vetchium.orgs SET org_state = 'suspended',
         suspended_at = now()
       WHERE org_did = ${sqlLiteral(world.did)}::uuid`,
    );
    await expectProblem(
      await api.uploadOfferLetter(owner, offerLetter()),
      403,
      `${PREFIX}org-suspended`,
    );
  });
});

test("an upload superseded after its bytes were stored is a conflict on retry", async ({
  request,
}) => {
  await withOrg(request, async (world) => {
    await publishedOpening(world);
    const letter = offerLetter();
    const key = orgsIdempotencyKey();
    const first = await world.api.uploadOfferLetter(
      world.owner,
      letter,
      undefined,
      key,
    );
    expect(first.status(), await first.text()).toBe(201);
    const { letter_id: letterID } = (await first.json()) as OfferLetterUploaded;
    // As if the request stopped after the Put and a newer upload then
    // superseded the staged letter.
    orgSQL(
      `UPDATE vetchium.idempotency_ledger
       SET response_status = NULL, response_ciphertext = NULL
       WHERE operation = 'orgs:upload-offer-letter'
         AND idempotency_key = ${sqlLiteral(key)};
       UPDATE vetchium.org_offer_letter_objects
       SET state = 'pending_delete', upload_expires_at = NULL,
         delete_requested_at = now()
       WHERE object_id = ${sqlLiteral(letterID)}::uuid`,
    );
    await expectProblem(
      await world.api.uploadOfferLetter(world.owner, letter, undefined, key),
      409,
      LETTER_CONFLICT,
    );
  });
});

test("an offer extends from any stage, withdraws to the same stage, and keeps every letter for the Org", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withOrg(request, async (world) => {
    const { opening, stages } = await publishedOpening(world);
    const n = opening.opening_number;
    for (const index of [0, 1, 2]) {
      const stage = stageOf(stages, index);
      const number = await seedAt(world, n, "in_pipeline", stage.id);
      const letter = offerLetter();
      const before = Date.now();
      const offered = await extend(world, n, number, {
        letter,
        version: SHORTLISTED,
      });
      expect(offered).toMatchObject({
        state: "offered",
        version: SHORTLISTED + 1,
        current_stage: stage,
      });
      expect(offered.offers).toHaveLength(1);
      const [offer] = offered.offers;
      expect(offer).toMatchObject({
        offer_number: 1,
        status: "extended",
        letter_byte_size: letter.length,
        proposed_joining_date: utcDate(30),
      });
      expect(offer?.ended_at).toBeUndefined();
      const respondBy = Date.parse(offer?.respond_by ?? "");
      expect(respondBy - Date.parse(offer?.extended_at ?? "")).toBe(
        14 * 24 * 60 * 60 * 1000,
      );
      expect(respondBy).toBeGreaterThan(before + 13 * 24 * 60 * 60 * 1000);
      await expectLetter(offer?.letter_url ?? "", letter);
      expect((await history(world, n, number))[0]).toMatchObject({
        action: "offer_extended",
        actor: "org_user",
        state: "offered",
        version: SHORTLISTED + 1,
      });
    }

    // Withdrawing returns the candidacy to its stage; the letter stays.
    const stage = stageOf(stages, 1);
    const number = await seedAt(world, n, "in_pipeline", stage.id);
    const first = offerLetter();
    await extend(world, n, number, { letter: first, version: SHORTLISTED });
    const key = orgsIdempotencyKey();
    const withdrawRequest = {
      opening_number: n,
      application_number: number,
      version: SHORTLISTED + 1,
    };
    const withdrawn = await world.api.withdrawApplicationOffer(
      world.owner,
      withdrawRequest,
      key,
    );
    expect(withdrawn.status(), await withdrawn.text()).toBe(200);
    const afterWithdraw = (await withdrawn.json()) as ApplicationDetail;
    expect(afterWithdraw).toMatchObject({
      state: "in_pipeline",
      version: SHORTLISTED + 2,
      current_stage: stage,
    });
    expect(afterWithdraw.offers[0]?.status).toBe("withdrawn");
    expect(afterWithdraw.offers[0]?.ended_at).toBeDefined();
    await expectLetter(afterWithdraw.offers[0]?.letter_url ?? "", first);
    const replayed = await world.api.withdrawApplicationOffer(
      world.owner,
      withdrawRequest,
      key,
    );
    expect(replayed.status()).toBe(200);
    expect(((await replayed.json()) as ApplicationDetail).version).toBe(
      SHORTLISTED + 2,
    );
    expect((await history(world, n, number))[0]).toMatchObject({
      action: "offer_withdrawn",
      state: "in_pipeline",
      version: SHORTLISTED + 2,
    });

    // A new offer gets the next number, newest first.
    const second = offerLetter();
    const reoffered = await extend(world, n, number, { letter: second });
    expect(reoffered.offers.map((offer) => offer.offer_number)).toEqual([2, 1]);
    expect(reoffered.offers.map((offer) => offer.status)).toEqual([
      "extended",
      "withdrawn",
    ]);
    await expectLetter(reoffered.offers[0]?.letter_url ?? "", second);
    await expectLetter(reoffered.offers[1]?.letter_url ?? "", first);
  });
});

test("extend-application-offer refuses states, versions, readers, dates, and letters it cannot use", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withOrg(request, async (world) => {
    const { api, owner, org } = world;
    const upgraded = await api.setSubscriptionPlan(owner, {
      plan_oid: "org-silver-tier",
      billing_interval: "month",
    });
    expect(upgraded.status(), await upgraded.text()).toBe(200);
    const teammate = await addOrgMember(
      api,
      owner,
      org.domain,
      `teammate@${org.domain}`,
    );
    const candidacies = await addOrgMember(
      api,
      owner,
      org.domain,
      `candidacies@${org.domain}`,
      ["org:manage_candidacies"],
    );
    const outsider = await addOrgMember(
      api,
      owner,
      org.domain,
      `outsider@${org.domain}`,
    );
    const { opening, stages } = await publishedOpening(world, [
      teammate.emailAddress,
    ]);
    const n = opening.opening_number;
    const stage = stageOf(stages, 0).id;
    const number = await seedAt(world, n, "in_pipeline", stage);
    const submitted = await seedAt(world, n, "submitted");
    const letterID = await upload(world);
    const extendRequest = (overrides: Record<string, unknown> = {}) => ({
      opening_number: n,
      application_number: number,
      version: SHORTLISTED,
      letter_id: letterID,
      respond_within_days: 7,
      ...overrides,
    });

    await expectProblem(
      await api.extendApplicationOffer(
        owner,
        extendRequest({ application_number: submitted, version: 1 }),
      ),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await api.extendApplicationOffer(
        owner,
        extendRequest({ version: SHORTLISTED + 1 }),
      ),
      409,
      VERSION_CONFLICT,
    );
    await expectProblem(
      await api.extendApplicationOffer(teammate.token, extendRequest()),
      403,
      PERMISSION_REQUIRED,
    );
    await expectProblem(
      await api.extendApplicationOffer(outsider.token, extendRequest()),
      404,
      NOT_FOUND,
    );
    await expectProblem(
      await api.extendApplicationOffer(
        owner,
        extendRequest({ proposed_joining_date: utcDate(-1) }),
      ),
      400,
      VALIDATION,
      ["proposed_joining_date"],
    );
    for (const days of [0, 61]) {
      await expectProblem(
        await api.extendApplicationOfferRaw(
          owner,
          extendRequest({ respond_within_days: days }),
        ),
        400,
        VALIDATION,
        ["respond_within_days"],
      );
    }
    await expectProblem(
      await api.extendApplicationOfferRaw(
        owner,
        extendRequest({ letter_id: "not-a-letter", extra: true }),
      ),
      400,
      `${PREFIX}invalid-json`,
    );
    await expectProblem(
      await api.extendApplicationOffer(
        owner,
        extendRequest({ letter_id: randomUUID() }),
      ),
      400,
      VALIDATION,
      ["letter_id"],
    );
    // Another user's letter is not the caller's to claim.
    const othersLetter = await upload(world, offerLetter(), candidacies.token);
    await expectProblem(
      await api.extendApplicationOffer(
        owner,
        extendRequest({ letter_id: othersLetter }),
      ),
      400,
      VALIDATION,
      ["letter_id"],
    );
    // A letter past its claim window is gone.
    const expired = await upload(world, offerLetter(), candidacies.token);
    orgSQL(
      `UPDATE vetchium.org_offer_letter_objects
       SET upload_expires_at = now() - interval '1 second'
       WHERE object_id = ${sqlLiteral(expired)}::uuid`,
    );
    await expectProblem(
      await api.extendApplicationOffer(
        candidacies.token,
        extendRequest({ letter_id: expired }),
      ),
      400,
      VALIDATION,
      ["letter_id"],
    );
    // A newer upload supersedes the caller's unclaimed letter.
    const superseded = await upload(world);
    await upload(world);
    await expectProblem(
      await api.extendApplicationOffer(
        owner,
        extendRequest({ letter_id: superseded }),
      ),
      400,
      VALIDATION,
      ["letter_id"],
    );
    await expectProblem(
      await api.post("/extend-application-offer", extendRequest(), {
        idempotencyKey: orgsIdempotencyKey(),
      }),
      401,
      `${PREFIX}org-authentication-required`,
    );
    expect((await detail(world, n, number)).state).toBe("in_pipeline");

    // The refusals left the letter claimable; one offer claims it once.
    const current = await upload(world);
    const key = orgsIdempotencyKey();
    const ok = await api.extendApplicationOffer(
      owner,
      extendRequest({ letter_id: current }),
      key,
    );
    expect(ok.status(), await ok.text()).toBe(200);
    const replay = await api.extendApplicationOffer(
      owner,
      extendRequest({ letter_id: current }),
      key,
    );
    expect(replay.status()).toBe(200);
    expect(((await replay.json()) as ApplicationDetail).offers).toHaveLength(1);
    await expectProblem(
      await api.extendApplicationOffer(
        owner,
        extendRequest({ letter_id: current, respond_within_days: 8 }),
        key,
      ),
      409,
      KEY_CONFLICT,
    );
    await expectProblem(
      await api.extendApplicationOffer(
        owner,
        extendRequest({ version: SHORTLISTED + 1, letter_id: current }),
      ),
      409,
      STATE_CONFLICT,
    );
    const another = await seedAt(world, n, "in_pipeline", stage);
    await expectProblem(
      await api.extendApplicationOffer(
        owner,
        extendRequest({ application_number: another, letter_id: current }),
      ),
      400,
      VALIDATION,
      ["letter_id"],
    );
  });
});

test("withdraw-application-offer and other exits from offered end the offer", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withOrg(request, async (world) => {
    const { api, owner, org } = world;
    const upgraded = await api.setSubscriptionPlan(owner, {
      plan_oid: "org-silver-tier",
      billing_interval: "month",
    });
    expect(upgraded.status(), await upgraded.text()).toBe(200);
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
    const { opening, stages } = await publishedOpening(world, [
      teammate.emailAddress,
    ]);
    const n = opening.opening_number;
    const stage = stageOf(stages, 1).id;
    const pipelined = await seedAt(world, n, "in_pipeline", stage);
    const reference = (number: number, version: number) => ({
      opening_number: n,
      application_number: number,
      version,
    });
    await expectProblem(
      await api.withdrawApplicationOffer(
        owner,
        reference(pipelined, SHORTLISTED),
      ),
      409,
      STATE_CONFLICT,
    );
    await expectProblem(
      await api.post(
        "/withdraw-application-offer",
        reference(pipelined, SHORTLISTED),
        { idempotencyKey: orgsIdempotencyKey() },
      ),
      401,
      `${PREFIX}org-authentication-required`,
    );
    await expectProblem(
      await api.withdrawApplicationOffer(owner, {
        ...reference(pipelined, SHORTLISTED),
        opening_number: 0,
      }),
      400,
      VALIDATION,
      ["opening_number"],
    );
    const offered = await seedAt(world, n, "in_pipeline", stage);
    await extend(world, n, offered, { version: SHORTLISTED });
    await expectProblem(
      await api.withdrawApplicationOffer(
        owner,
        reference(offered, SHORTLISTED),
      ),
      409,
      VERSION_CONFLICT,
    );
    await expectProblem(
      await api.withdrawApplicationOffer(
        teammate.token,
        reference(offered, SHORTLISTED + 1),
      ),
      403,
      PERMISSION_REQUIRED,
    );
    await expectProblem(
      await api.withdrawApplicationOffer(
        outsider.token,
        reference(offered, SHORTLISTED + 1),
      ),
      404,
      NOT_FOUND,
    );
    // Not progressing from offered withdraws the offer with it.
    const marked = await api.markApplicationNotProgressing(
      owner,
      reference(offered, SHORTLISTED + 1),
    );
    expect(marked.status(), await marked.text()).toBe(200);
    const notProgressing = (await marked.json()) as ApplicationDetail;
    expect(notProgressing.state).toBe("not_progressing");
    expect(notProgressing.offers[0]?.status).toBe("withdrawn");

    // So does closing the Opening with every application marked.
    const closing = await seedAt(world, n, "in_pipeline", stage);
    await extend(world, n, closing, { version: SHORTLISTED });
    const current = await api.getOpening(owner, { opening_number: n });
    const closed = await api.requestOpeningChange(owner, {
      opening_number: n,
      version: ((await current.json()) as OrgOpening).version,
      kind: "close",
      mark_applications_not_progressing: true,
    });
    expect(closed.status(), await closed.text()).toBe(200);
    const afterClose = await detail(world, n, closing);
    expect(afterClose.state).toBe("not_progressing");
    expect(afterClose.offers[0]?.status).toBe("withdrawn");
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

function answer(
  applicant: Applicant,
  verb: "accept" | "decline",
  body: RespondToOfferRequest,
  key = hubIdempotencyKey(),
): Promise<APIResponse> {
  const options = { token: applicant.token, idempotencyKey: key };
  return verb === "accept"
    ? applicant.hub.acceptApplicationOffer(body, options)
    : applicant.hub.declineApplicationOffer(body, options);
}

test("a local applicant reads the offer and its letter, then accepts it once", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withApplicant(request, "sgp", "sgp", async (applicant, world) => {
    const { reference, opening } = await shortlisted(applicant, world);
    const letter = offerLetter();
    await extend(world, opening, reference.application_number, { letter });

    const read = await myApplication(applicant, reference);
    expect(read).toMatchObject({
      status: "offered",
      pending_actions: ["offer_response"],
      offer: {
        offer_number: 1,
        status: "extended",
        letter_byte_size: letter.length,
        proposed_joining_date: utcDate(30),
      },
    });
    await expectLetter(read.offer?.letter_url ?? "", letter);
    await expectProjected(applicant, reference, "offered", ["offer_response"]);
    const counts = await applicant.hub.myApplicationCounts(applicant.token);
    expect(await counts.json()).toEqual({
      active: 1,
      closed: 0,
      awaiting_answer: 1,
    });

    await expectProblem(
      await answer(applicant, "accept", { ...reference, offer_number: 2 }),
      409,
      HUB_STATE_CONFLICT,
    );
    const key = hubIdempotencyKey();
    const body = { ...reference, offer_number: 1 };
    const accepted = await answer(applicant, "accept", body, key);
    expect(accepted.status(), await accepted.text()).toBe(200);
    expect(accepted.headers()["cache-control"]).toBe("no-store");
    expect(await accepted.json()).toEqual(reference);
    const replay = await answer(applicant, "accept", body, key);
    expect(replay.status(), await replay.text()).toBe(200);
    await expectProblem(
      await answer(applicant, "accept", { ...body, offer_number: 2 }, key),
      409,
      `${PREFIX}idempotency-key-conflict`,
    );
    await expectProblem(
      await answer(applicant, "decline", body),
      409,
      HUB_STATE_CONFLICT,
    );

    const after = await myApplication(applicant, reference);
    expect(after).toMatchObject({
      status: "offer_accepted",
      pending_actions: [],
      offer: { status: "accepted" },
    });
    const orgView = await detail(world, opening, reference.application_number);
    expect(orgView.state).toBe("offer_accepted");
    expect(orgView.offers[0]?.status).toBe("accepted");
    expect(
      (await history(world, opening, reference.application_number))[0],
    ).toMatchObject({ action: "offer_accepted", actor: "applicant" });
    await expectProjected(applicant, reference, "offer_accepted", []);
  });
});

test("an applicant in another region declines, opening the letter from the Org's region", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withApplicant(request, "usa1", "sgp", async (applicant, world) => {
    const { reference, opening } = await shortlisted(applicant, world);
    const letter = offerLetter();
    await extend(world, opening, reference.application_number, { letter });
    const read = await myApplication(applicant, reference);
    expect(new URL(read.offer?.letter_url ?? "").host).toContain("sgp");
    await expectLetter(read.offer?.letter_url ?? "", letter);
    await expectProjected(applicant, reference, "offered", ["offer_response"]);

    const declined = await answer(applicant, "decline", {
      ...reference,
      offer_number: 1,
    });
    expect(declined.status(), await declined.text()).toBe(200);
    expect((await myApplication(applicant, reference)).offer?.status).toBe(
      "declined",
    );
    const orgView = await detail(world, opening, reference.application_number);
    expect(orgView.state).toBe("offer_declined");
    expect(orgView.offers[0]?.status).toBe("declined");
    await expectProjected(applicant, reference, "declined", []);
  });
});

test("a withdrawn offer stays with the Org; others cannot read any letter", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withApplicant(request, "sgp", "sgp", async (applicant, world) => {
    const { reference, opening } = await shortlisted(applicant, world);
    const first = await extend(world, opening, reference.application_number);
    const withdrawn = await world.api.withdrawApplicationOffer(world.owner, {
      opening_number: opening,
      application_number: reference.application_number,
      version: first.version,
    });
    expect(withdrawn.status(), await withdrawn.text()).toBe(200);
    const hidden = await myApplication(applicant, reference);
    expect(hidden.offer).toBeUndefined();
    expect(hidden.pending_actions).toEqual([]);
    expect(hidden.status).toBe("interviewing");
    await expectProjected(applicant, reference, "interviewing", []);
    await expectProblem(
      await answer(applicant, "accept", { ...reference, offer_number: 1 }),
      409,
      HUB_STATE_CONFLICT,
    );

    const second = await extend(world, opening, reference.application_number);
    const shown = await myApplication(applicant, reference);
    expect(shown.offer?.offer_number).toBe(2);
    expect(second.offers).toHaveLength(2);

    // Another Hub user and another Org's user see no application at all.
    const stranger = seedApplicant(applicant.hub.request, "sgp");
    try {
      await expectProblem(
        await stranger.hub.getMyApplication(reference, stranger.token),
        404,
        HUB_NOT_FOUND,
      );
      await expectProblem(
        await answer(stranger, "accept", { ...reference, offer_number: 2 }),
        404,
        HUB_NOT_FOUND,
      );
    } finally {
      cleanupApplicant(stranger, [world]);
    }
    const other = await newOrg(world.api.request);
    try {
      await expectProblem(
        await other.api.getApplication(other.owner, {
          opening_number: opening,
          application_number: reference.application_number,
        }),
        404,
        NOT_FOUND,
      );
    } finally {
      await removeOrg(other);
    }
    // A link is only good as signed.
    const url = new URL(shown.offer?.letter_url ?? "");
    const tampered = new URL(url);
    tampered.searchParams.set(
      "X-Amz-Signature",
      "0".repeat(url.searchParams.get("X-Amz-Signature")?.length ?? 64),
    );
    expect((await fetch(tampered)).status).toBe(403);
    expect((await fetch(`${url.origin}${url.pathname}`)).status).toBe(403);

    // The applicant leaving withdraws the offer awaiting an answer.
    const left = await applicant.hub.withdrawApplication(reference, {
      token: applicant.token,
      idempotencyKey: hubIdempotencyKey(),
    });
    expect(left.status(), await left.text()).toBe(200);
    const orgView = await detail(world, opening, reference.application_number);
    expect(orgView.state).toBe("withdrawn");
    expect(orgView.offers.map((offer) => offer.status)).toEqual([
      "withdrawn",
      "withdrawn",
    ]);
    expect((await myApplication(applicant, reference)).offer).toBeUndefined();
  });
});

for (const verb of ["accept", "decline"] as const) {
  test(`an uncertain ${verb} is 202 and its replay returns the outcome`, async ({
    request,
  }) => {
    test.setTimeout(120_000);
    await withApplicant(request, "usa1", "sgp", async (applicant, world) => {
      const { reference, opening } = await shortlisted(applicant, world);
      await extend(world, opening, reference.application_number);
      // A stale route sends the command to deu, which does not home the Org.
      const setHome = (tenant: TestTenant) =>
        globalSQLScalar(
          `UPDATE vetchium.org_principals
         SET home_tenant_id = ${sqlLiteral(tenant)},
           routing_version = routing_version + 1
         WHERE org_did = ${sqlLiteral(world.did)}::uuid`,
        );
      const key = hubIdempotencyKey();
      const body = { ...reference, offer_number: 1 };
      setHome("deu");
      try {
        const pending = await answer(applicant, verb, body, key);
        expect(pending.status(), await pending.text()).toBe(202);
        expect(pending.headers()["cache-control"]).toBe("no-store");
      } finally {
        setHome("sgp");
      }
      const answered = await answer(applicant, verb, body, key);
      expect(answered.status(), await answered.text()).toBe(200);
      expect(
        (await detail(world, opening, reference.application_number)).state,
      ).toBe(verb === "accept" ? "offer_accepted" : "offer_declined");
    });
  });
}

test("an applicant whose region cannot reach the directory gets hub-org-unavailable", async ({
  request,
}) => {
  // ind1 cannot reach its directory, so nothing is sent.
  await withApplicant(request, "ind1", "usa1", async (applicant, world) => {
    for (const verb of ["accept", "decline"] as const) {
      await expectProblem(
        await answer(applicant, verb, {
          domain: world.org.domain,
          opening_number: 1,
          application_number: 1,
          offer_number: 1,
        }),
        503,
        `${PREFIX}hub-org-unavailable`,
      );
    }
  });
});

test("an unanswered offer expires as declined", async ({ request }) => {
  test.setTimeout(120_000);
  await withApplicant(request, "sgp", "sgp", async (applicant, world) => {
    const { reference, opening } = await shortlisted(applicant, world);
    await extend(world, opening, reference.application_number, { days: 1 });
    await expectProjected(applicant, reference, "offered", ["offer_response"]);
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
    expect(orgView.offers[0]?.status).toBe("expired");
    expect(
      (await history(world, opening, reference.application_number))[0],
    ).toMatchObject({ action: "offer_declined", actor: "system" });
    expect((await myApplication(applicant, reference)).offer?.status).toBe(
      "expired",
    );
    await expectProjected(applicant, reference, "declined", []);
    await expectProblem(
      await answer(applicant, "accept", { ...reference, offer_number: 1 }),
      409,
      HUB_STATE_CONFLICT,
    );
  });
});

test("offer answers reject malformed, unauthenticated, and unknown requests", async ({
  request,
}) => {
  await withApplicant(request, "sgp", "sgp", async (applicant, world) => {
    const hub = applicant.hub;
    const reference = {
      domain: world.org.domain,
      opening_number: 1,
      application_number: 1,
      offer_number: 1,
    };
    for (const path of [
      "/accept-application-offer",
      "/decline-application-offer",
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
          { ...reference, offer_number: 0 },
          { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
        ),
        400,
        VALIDATION,
        ["offer_number"],
      );
    }
    await expectProblem(
      await answer(applicant, "accept", reference),
      404,
      HUB_NOT_FOUND,
    );
    await expectProblem(
      await answer(applicant, "decline", {
        ...reference,
        domain: `unknown-${randomUUID()}.example.test`,
      }),
      404,
      HUB_NOT_FOUND,
    );
  });
});

test("a tenant that does not home an Org cannot report its applications", async ({
  request,
  apiCoverage,
}) => {
  await withApplicant(request, "usa1", "sgp", async (applicant, world) => {
    const applicationNumber = 1;
    const payload: HubApplicationChangedPayload = {
      org_did: world.did,
      org_domain: world.org.domain,
      org_display_name: "Forged Org",
      opening_number: 1,
      opening_title: "Forged",
      application_number: applicationNumber,
      status: "joined",
      pending_actions: [],
      applied_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    };
    const event = (): DeliverEventRequest => ({
      event_id: randomUUID(),
      kind: "hub-application-changed",
      destination_principal_type: "hub_user",
      destination_principal_did: applicant.did,
      aggregate_type: "org_application",
      aggregate_id: `${world.did}:1:${applicationNumber}`,
      aggregate_version: 1,
      payload: payload as unknown as Record<string, unknown>,
    });
    // deu presents its own certificate for an Org the directory homes at sgp.
    const forged = meshPeerRequest("deu", "usa1", event(), apiCoverage, {
      path: "/api/mesh/events/deliver",
    });
    expect(forged.status, JSON.stringify(forged.body)).toBe(403);
    expect((forged.body as { type: string }).type).toBe(
      `${PREFIX}federation-event-origin-mismatch`,
    );
    const projected = await applicant.hub.myApplicationCounts(applicant.token);
    expect(await projected.json()).toEqual({
      active: 0,
      closed: 0,
      awaiting_answer: 0,
    });
    // The Org's own tenant may.
    const genuine = meshPeerRequest("sgp", "usa1", event(), apiCoverage, {
      path: "/api/mesh/events/deliver",
    });
    expect(genuine.status, JSON.stringify(genuine.body)).toBe(200);
    expect(genuine.body).toEqual({ outcome: "applied" });
  });
});
