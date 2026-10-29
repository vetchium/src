import { randomBytes, randomUUID } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import type {
  ApplicationQuestion,
  OpeningContent,
} from "typespec/common/openings";
import type { CommandResult } from "typespec/federation/commands";
import type {
  HubApplyPayload,
  HubApplyResult,
} from "typespec/federation/hiring";
import type {
  ApplicationReference,
  ListMyApplicationsResponse,
  MyApplication,
  MyApplicationDetail,
} from "typespec/hub/applications/applications";
import type {
  OperationStatus,
  PendingOperation,
} from "typespec/hub/operations/operations";
import type {
  AnsweredQuestion,
  ApplicationAnswer,
} from "typespec/orgs/applications/answers";
import type { ApplicationDetail } from "typespec/orgs/applications/applications";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { expectProblem } from "../lib/admin-api.ts";
import {
  cleanupGlobalHubPrincipal,
  cleanupHubUser,
  globalSQLScalar,
  seedActiveHubUser,
  seedGlobalHubPrincipal,
  sqlLiteral,
  sqlScalarForTenant,
  type TestTenant,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import { offerLetter } from "../lib/hiring-seed.ts";
import { HubAPI, hubIdempotencyKey } from "../lib/hub-api.ts";
import {
  type MeshResponse,
  meshPeerRequest,
  meshRelayRequest,
} from "../lib/mesh.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgDID,
  orgSQL,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";

// Crockford base32 without i, l, o, u, the alias alphabet.
const ALIAS_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function randomAlias(): string {
  let out = "e2e-";
  for (const byte of randomBytes(20)) {
    out += ALIAS_ALPHABET[byte % ALIAS_ALPHABET.length];
  }
  return out;
}

interface Applicant {
  tenant: TestTenant;
  email: string;
  did: string;
  handle: string;
  token: string;
  alias?: string;
  hub: HubAPI;
}

/** A Hub user homed at tenant, also in the directory unless it is ind1,
 * whose coordinator is unreachable in CI. */
function seedApplicant(
  request: APIRequestContext,
  tenant: TestTenant,
  name = "Ada Applicant",
): Applicant {
  const email = `e2e+${randomUUID()}@e2e-hub-applications.example.test`;
  const seeded = seedActiveHubUser(tenant, email, name);
  const applicant: Applicant = {
    tenant,
    email,
    did: seeded.hubUserDID,
    handle: seeded.handle,
    token: seeded.sessionToken,
    hub: new HubAPI(request, tenant),
  };
  if (tenant !== "ind1") {
    applicant.alias = randomAlias();
    seedGlobalHubPrincipal(applicant.did, tenant, applicant.alias);
  }
  return applicant;
}

interface World {
  tenant: TestTenant;
  api: OrgsAPI;
  org: SignedUpOrg;
  owner: string;
  did: string;
}

async function newOrg(
  request: APIRequestContext,
  tenant: TestTenant,
): Promise<World> {
  const api = new OrgsAPI(request, tenant);
  const org = await signupOrg(api);
  const owner = await loginOrg(api, org);
  return { tenant, api, org, owner, did: orgDID(org.domain, tenant) };
}

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

async function publish(
  world: World,
  title: string,
  questions?: ApplicationQuestion[],
): Promise<OrgOpening> {
  const created = await world.api.createOpening(world.owner, {
    content: { ...content(title), ...(questions ? { questions } : {}) },
    hiring_manager_email: world.org.emailAddress,
    recruiter_email: world.org.emailAddress,
    team_member_emails: [],
  });
  expect(created.status(), await created.text()).toBe(201);
  const opening = (await created.json()) as OrgOpening;
  const published = await world.api.requestOpeningChange(world.owner, {
    opening_number: opening.opening_number,
    version: opening.version,
    kind: "publish",
  });
  expect(published.status(), await published.text()).toBe(200);
  return (await published.json()) as OrgOpening;
}

/** Removes the command results, outbox events, inbox receipts, and
 * watermarks an applicant's commands left at every tenant involved. */
function cleanupFederation(applicant: Applicant, worlds: World[]): void {
  const did = sqlLiteral(applicant.did);
  const commandIDs = sqlScalarForTenant(
    applicant.tenant,
    `SELECT coalesce(string_agg(quote_literal(command_id::text), ','), '')
     FROM vetchium.federation_operations
     WHERE owner_principal_type = 'hub_user' AND owner_principal_id = ${did}`,
  );
  for (const world of worlds) {
    sqlScalarForTenant(
      world.tenant,
      `${
        commandIDs === ""
          ? ""
          : `DELETE FROM vetchium.federation_command_ledger
             WHERE command_id::text IN (${commandIDs});`
      }
       DELETE FROM vetchium.federation_outbox
       WHERE destination_principal_did = ${did}::uuid;`,
    );
    const aggregates = sqlLiteral(`${world.did}:%`);
    sqlScalarForTenant(
      applicant.tenant,
      `DELETE FROM vetchium.audit_events
       WHERE entity_type = 'federation_event' AND entity_id IN (
         SELECT event_id::text FROM vetchium.federation_inbox
         WHERE aggregate_type = 'org_application'
           AND aggregate_id LIKE ${aggregates});
       DELETE FROM vetchium.federation_inbox
       WHERE aggregate_type = 'org_application'
         AND aggregate_id LIKE ${aggregates};
       DELETE FROM vetchium.federation_event_watermarks
       WHERE destination_principal_did = ${did}::uuid;`,
    );
  }
}

/** Runs body with a fresh applicant and Orgs, then removes all of it. */
async function withWorlds(
  request: APIRequestContext,
  applicantTenant: TestTenant,
  orgTenants: TestTenant[],
  body: (applicant: Applicant, worlds: World[], first: World) => Promise<void>,
): Promise<void> {
  const applicant = seedApplicant(request, applicantTenant);
  const worlds: World[] = [];
  try {
    for (const tenant of orgTenants) worlds.push(await newOrg(request, tenant));
    const [first] = worlds;
    if (!first) throw new Error("withWorlds needs an Org");
    await body(applicant, worlds, first);
  } finally {
    cleanupFederation(applicant, worlds);
    for (const world of worlds) {
      await deleteOrgVerificationRecord(world.org.domain);
      cleanupOrg(world.org.domain, world.tenant);
    }
    if (applicant.alias) {
      cleanupGlobalHubPrincipal(applicant.did, applicant.alias);
    }
    cleanupHubUser(applicant.email, applicant.tenant);
  }
}

async function apply(
  applicant: Applicant,
  domain: string,
  openingNumber: number,
  key = hubIdempotencyKey(),
  coverNote?: string,
  answers?: ApplicationAnswer[],
): Promise<APIResponse> {
  return applicant.hub.applyToOpening(
    {
      domain,
      opening_number: openingNumber,
      ...(coverNote === undefined ? {} : { cover_note: coverNote }),
      ...(answers === undefined ? {} : { answers }),
    },
    { token: applicant.token, idempotencyKey: key },
  );
}

async function withdraw(
  applicant: Applicant,
  reference: ApplicationReference,
  key = hubIdempotencyKey(),
): Promise<APIResponse> {
  return applicant.hub.withdrawApplication(reference, {
    token: applicant.token,
    idempotencyKey: key,
  });
}

async function expectCreated(
  response: APIResponse,
  domain: string,
  openingNumber: number,
): Promise<ApplicationReference> {
  expect(response.status(), await response.text()).toBe(201);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const body = (await response.json()) as ApplicationReference;
  expect(body).toEqual({
    domain,
    opening_number: openingNumber,
    application_number: body.application_number,
  });
  expect(body.application_number).toBeGreaterThanOrEqual(1);
  return body;
}

async function myApplications(
  applicant: Applicant,
): Promise<ListMyApplicationsResponse> {
  const response = await applicant.hub.listMyApplications({}, applicant.token);
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ListMyApplicationsResponse;
}

/** Waits for the projection to show reference with status. */
async function expectProjected(
  applicant: Applicant,
  reference: ApplicationReference,
  status: string,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await myApplications(applicant)).applications.find(
          (entry) =>
            entry.org_domain === reference.domain &&
            entry.opening_number === reference.opening_number &&
            entry.application_number === reference.application_number,
        )?.status,
      { timeout: 15_000 },
    )
    .toBe(status);
}

async function myApplication(
  applicant: Applicant,
  reference: ApplicationReference,
): Promise<MyApplication> {
  const response = await applicant.hub.getMyApplication(
    reference,
    applicant.token,
  );
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as MyApplication;
}

/** Fields an applicant must never see, from any Hub or mesh response. */
function expectNoInternals(text: string): void {
  for (const internal of [
    "Secret Panel",
    "stage",
    "version",
    "snapshot",
    "cover_note",
    "hub_user_did",
    "applicant_did",
    "org_did",
    "feedback",
    "routing",
  ]) {
    expect(text).not.toContain(internal);
  }
}

/** Takes the application to state through the Org's APIs, at a new
 * interview stage, and the applicant's acceptance for offer_accepted. */
async function moveToStage(
  world: World,
  applicant: Applicant,
  reference: ApplicationReference,
  state: "in_pipeline" | "offered" | "offer_accepted",
): Promise<void> {
  const { api, owner } = world;
  const n = reference.opening_number;
  const pipeline = (await (
    await api.getOpeningPipeline(owner, { opening_number: n })
  ).json()) as { version: number; stages: PipelineStage[] };
  const replaced = await api.replaceOpeningPipeline(owner, {
    opening_number: n,
    version: pipeline.version,
    stages: [
      ...pipeline.stages.map(({ id, name, kind }) => ({ id, name, kind })),
      { name: "Secret Panel", kind: "interview" },
    ],
  });
  expect(replaced.status(), await replaced.text()).toBe(200);
  const panel = (
    (await replaced.json()) as { stages: PipelineStage[] }
  ).stages.find((stage) => stage.name === "Secret Panel");
  const target = {
    opening_number: n,
    application_number: reference.application_number,
  };
  const current = async () =>
    (
      (await (
        await api.getApplication(owner, target)
      ).json()) as ApplicationDetail
    ).version;
  const shortlisted = await api.shortlistApplication(owner, {
    ...target,
    version: await current(),
    stage_id: panel?.id ?? "",
  });
  expect(shortlisted.status(), await shortlisted.text()).toBe(200);
  if (state === "in_pipeline") return;
  const letter = await api.uploadOfferLetter(owner, offerLetter());
  expect(letter.status(), await letter.text()).toBe(201);
  const extended = await api.extendApplicationOffer(owner, {
    ...target,
    version: await current(),
    letter_id: ((await letter.json()) as { letter_id: string }).letter_id,
    respond_within_days: 14,
  });
  expect(extended.status(), await extended.text()).toBe(200);
  if (state === "offered") return;
  const accepted = await applicant.hub.acceptApplicationOffer(
    { ...reference, offer_number: 1 },
    { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
  );
  expect(accepted.status(), await accepted.text()).toBe(200);
}

function setOrgHome(world: World, tenant: TestTenant): void {
  globalSQLScalar(
    `UPDATE vetchium.org_principals
     SET home_tenant_id = ${sqlLiteral(tenant)},
       routing_version = routing_version + 1
     WHERE org_did = ${sqlLiteral(world.did)}::uuid`,
  );
}

test("a Hub user applies to a local Org, reads, and withdraws with replays", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withWorlds(
    request,
    "sgp",
    ["sgp"],
    async (applicant, _worlds, world) => {
      const opening = await publish(world, "Local Engineer");
      const domain = world.org.domain;
      const key = hubIdempotencyKey();
      const created = await expectCreated(
        await apply(applicant, domain, opening.opening_number, key, " Hello "),
        domain,
        opening.opening_number,
      );
      const replayed = await apply(
        applicant,
        domain,
        opening.opening_number,
        key,
        "Hello",
      );
      expect(
        await expectCreated(replayed, domain, opening.opening_number),
      ).toEqual(created);
      await expectProblem(
        await apply(applicant, domain, opening.opening_number, key, "Changed"),
        409,
        "vetchium-problem-details/idempotency-key-conflict",
      );
      await expectProblem(
        await apply(applicant, domain, opening.opening_number),
        409,
        "vetchium-problem-details/hub-application-exists",
      );

      const detail = await world.api.getApplication(world.owner, {
        opening_number: opening.opening_number,
        application_number: created.application_number,
      });
      expect(detail.status(), await detail.text()).toBe(200);
      const orgView = (await detail.json()) as ApplicationDetail;
      expect(orgView.state).toBe("submitted");
      expect(orgView.cover_note).toBe("Hello");
      expect(orgView.snapshot.display_name).toBe("Ada Applicant");
      expect(orgView.snapshot.handle).toBe(applicant.handle);
      expect(JSON.stringify(orgView.snapshot)).not.toContain("picture");

      expect(await myApplication(applicant, created)).toEqual({
        org_domain: domain,
        org_display_name: "Playwright Org",
        opening_number: opening.opening_number,
        opening_title: "Local Engineer",
        application_number: created.application_number,
        status: "applied",
        pending_actions: [],
        interviews: [],
        answers: [],
      });
      await expectProjected(applicant, created, "applied");
      const listed = (await myApplications(applicant)).applications[0];
      expect(listed).toMatchObject({
        org_domain: domain,
        org_display_name: "Playwright Org",
        opening_title: "Local Engineer",
        pending_actions: [],
      });
      expect(listed?.applied_at).toBe(listed?.last_activity_at);
      expectNoInternals(JSON.stringify(listed));

      const withdrawKey = hubIdempotencyKey();
      const withdrawn = await withdraw(applicant, created, withdrawKey);
      expect(withdrawn.status(), await withdrawn.text()).toBe(200);
      expect(await withdrawn.json()).toEqual(created);
      const again = await withdraw(applicant, created, withdrawKey);
      expect(again.status()).toBe(200);
      await expectProblem(
        await withdraw(
          applicant,
          { ...created, application_number: created.application_number + 1 },
          withdrawKey,
        ),
        409,
        "vetchium-problem-details/idempotency-key-conflict",
      );
      await expectProblem(
        await withdraw(applicant, created),
        409,
        "vetchium-problem-details/hub-application-state-conflict",
      );
      expect((await myApplication(applicant, created)).status).toBe(
        "withdrawn",
      );
      await expectProjected(applicant, created, "withdrawn");
      const orgAfter = await world.api.getApplication(world.owner, {
        opening_number: opening.opening_number,
        application_number: created.application_number,
      });
      expect(((await orgAfter.json()) as ApplicationDetail).state).toBe(
        "withdrawn",
      );
      // One application per Opening ever, withdrawn ones included.
      await expectProblem(
        await apply(applicant, domain, opening.opening_number),
        409,
        "vetchium-problem-details/hub-application-exists",
      );
    },
  );
});

test("a Hub user applies to and withdraws from a remote Org, which shows only Hub status", async ({
  request,
  apiCoverage,
}) => {
  test.setTimeout(90_000);
  await withWorlds(
    request,
    "sgp",
    ["usa1"],
    async (applicant, _worlds, world) => {
      const opening = await publish(world, "Remote Engineer");
      const domain = world.org.domain;
      const created = await expectCreated(
        await apply(applicant, domain, opening.opening_number),
        domain,
        opening.opening_number,
      );
      await expectProjected(applicant, created, "applied");
      expect((await myApplication(applicant, created)).opening_title).toBe(
        "Remote Engineer",
      );

      await moveToStage(world, applicant, created, "in_pipeline");
      const detail = await applicant.hub.getMyApplication(
        created,
        applicant.token,
      );
      const text = await detail.text();
      expect(detail.status(), text).toBe(200);
      expect(JSON.parse(text)).toMatchObject({ status: "interviewing" });
      expectNoInternals(text);
      const peer = meshPeerRequest(
        "sgp",
        "usa1",
        { ...created, applicant_did: applicant.did },
        apiCoverage,
        { path: "/api/mesh/hub-applications/get" },
      );
      expect(peer.status, JSON.stringify(peer.body)).toBe(200);
      expect(peer.body).toMatchObject({ status: "interviewing" });
      expectNoInternals(JSON.stringify(peer.body));
      const relay = meshRelayRequest(
        "sgp",
        "/mesh/hub-applications/get",
        { ...created, applicant_did: applicant.did },
        apiCoverage,
      );
      expect(relay.status, JSON.stringify(relay.body)).toBe(200);
      expectNoInternals(JSON.stringify(relay.body));

      const withdrawn = await withdraw(applicant, created);
      expect(withdrawn.status(), await withdrawn.text()).toBe(200);
      expect((await myApplication(applicant, created)).status).toBe(
        "withdrawn",
      );
      await expectProjected(applicant, created, "withdrawn");
      expectNoInternals(JSON.stringify(await myApplications(applicant)));
    },
  );
});

test("an uncertain outcome is 202 with a pending operation and the original request recovers it", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withWorlds(
    request,
    "usa1",
    ["sgp"],
    async (applicant, _worlds, world) => {
      const opening = await publish(world, "Pending Engineer");
      const domain = world.org.domain;
      const pendingStatus = async (operationID: string) => {
        const response = await applicant.hub.operationStatus(
          { operation_id: operationID },
          applicant.token,
        );
        expect(response.status()).toBe(200);
        return ((await response.json()) as OperationStatus).state;
      };
      // A stale route sends the command to deu, which does not home the Org:
      // the command was sent, so its outcome stays unknown.
      setOrgHome(world, "deu");
      let restored = false;
      try {
        const key = hubIdempotencyKey();
        const pending = await apply(
          applicant,
          domain,
          opening.opening_number,
          key,
        );
        expect(pending.status(), await pending.text()).toBe(202);
        expect(pending.headers()["cache-control"]).toBe("no-store");
        const operation = (await pending.json()) as PendingOperation;
        expect(await pendingStatus(operation.operation_id)).toBe("pending");
        setOrgHome(world, "sgp");
        restored = true;
        const created = await expectCreated(
          await apply(applicant, domain, opening.opening_number, key),
          domain,
          opening.opening_number,
        );
        expect(await pendingStatus(operation.operation_id)).toBe("succeeded");
        await expectProjected(applicant, created, "applied");

        setOrgHome(world, "deu");
        restored = false;
        const withdrawKey = hubIdempotencyKey();
        const pendingWithdraw = await withdraw(applicant, created, withdrawKey);
        expect(pendingWithdraw.status(), await pendingWithdraw.text()).toBe(
          202,
        );
        setOrgHome(world, "sgp");
        restored = true;
        const withdrawn = await withdraw(applicant, created, withdrawKey);
        expect(withdrawn.status(), await withdrawn.text()).toBe(200);
        await expectProjected(applicant, created, "withdrawn");
      } finally {
        if (!restored) setOrgHome(world, "sgp");
      }
    },
  );
});

const askedQuestions: ApplicationQuestion[] = [
  { text: "Current role", type: "short_text", required: true },
  { text: "Why us?", type: "long_text", required: false },
  {
    text: "Years in the domain",
    type: "number",
    required: true,
    min: 2,
    max: 10,
  },
  { text: "Authorized to work?", type: "yes_no", required: false },
  {
    text: "Office",
    type: "single_choice",
    required: false,
    options: ["Raffles", "Jurong"],
  },
  {
    text: "Languages",
    type: "multiple_choice",
    required: false,
    options: ["English", "Tamil", "Malay"],
  },
];

/** The live questions the Hub reads, in order, with their ids. */
async function liveQuestionIDs(
  applicant: Applicant,
  domain: string,
  openingNumber: number,
): Promise<string[]> {
  const response = await applicant.hub.getOrgOpening(
    { domain, opening_number: openingNumber },
    applicant.token,
  );
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as {
    opening: { content?: { questions?: ApplicationQuestion[] } };
  };
  const questions = body.opening.content?.questions ?? [];
  expect(questions.map((question) => question.text)).toEqual(
    askedQuestions.map((question) => question.text),
  );
  return questions.map((question) => question.id ?? "");
}

async function expectAnswersInvalid(
  response: APIResponse,
  questionIDs: string[],
): Promise<void> {
  expect(response.status(), await response.text()).toBe(422);
  const body = await response.json();
  expect(body.type).toBe(
    "vetchium-problem-details/hub-application-answers-invalid",
  );
  expect(body.question_ids).toEqual(questionIDs);
}

function storedAnswers(
  world: World,
  reference: ApplicationReference,
): AnsweredQuestion[] {
  return JSON.parse(
    sqlScalarForTenant(
      world.tenant,
      `SELECT a.answers::text FROM vetchium.org_applications AS a
       JOIN vetchium.org_openings AS o USING (org_opening_id)
       WHERE o.org_did = ${sqlLiteral(world.did)}::uuid
         AND o.opening_number = ${reference.opening_number}
         AND a.application_number = ${reference.application_number}`,
    ),
  ) as AnsweredQuestion[];
}

test("the Org's tenant checks answers to live questions and stores them as asked", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withWorlds(
    request,
    "sgp",
    ["sgp", "usa1"],
    async (applicant, worlds) => {
      for (const world of worlds) {
        const opening = await publish(world, "Asking Engineer", askedQuestions);
        const domain = world.org.domain;
        const n = opening.opening_number;
        const ids = await liveQuestionIDs(applicant, domain, n);
        const [role, why, years, permit, office, languages] = ids as [
          string,
          string,
          string,
          string,
          string,
          string,
        ];
        const required: ApplicationAnswer[] = [
          { question_id: role, value: "Engineer" },
          { question_id: years, value: 5 },
        ];
        const unknown = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
        const refusals: [ApplicationAnswer[], string[]][] = [
          [[{ question_id: years, value: 5 }], [role]],
          [[...required, { question_id: unknown, value: true }], [unknown]],
          [
            [
              ...required,
              { question_id: permit, value: true },
              { question_id: permit, value: false },
            ],
            [permit],
          ],
          [
            [
              { question_id: role, value: "Engineer" },
              { question_id: years, value: 11 },
            ],
            [years],
          ],
          [[...required, { question_id: office, value: "Changi" }], [office]],
          [
            [
              ...required,
              { question_id: languages, value: ["English", "English"] },
            ],
            [languages],
          ],
          [
            [
              { question_id: role, value: "a".repeat(201) },
              { question_id: years, value: 1 },
              { question_id: languages, value: [] },
            ],
            [role, years, languages],
          ],
        ];
        for (const [answers, invalid] of refusals) {
          await expectAnswersInvalid(
            await apply(applicant, domain, n, undefined, undefined, answers),
            invalid,
          );
        }
        // hub-api bounds the shape before any command is sent.
        const tooLong = await apply(
          applicant,
          domain,
          n,
          undefined,
          undefined,
          [...required, { question_id: why, value: "a".repeat(2001) }],
        );
        await expectProblem(
          tooLong,
          400,
          "vetchium-problem-details/validation-failed",
          ["answers.2.value"],
        );

        const created = await expectCreated(
          await apply(applicant, domain, n, undefined, undefined, [
            { question_id: languages, value: [" Tamil ", "English"] },
            { question_id: why, value: "   " },
            ...required,
            { question_id: permit, value: false },
          ]),
          domain,
          n,
        );
        const stored = storedAnswers(world, created);
        expect(stored.map((entry) => entry.id)).toEqual(ids);
        expect(stored.map((entry) => entry.answer)).toEqual([
          "Engineer",
          undefined,
          5,
          false,
          undefined,
          ["Tamil", "English"],
        ]);
        expect(stored[2]).toMatchObject({ min: 2, max: 10, required: true });
        expect(stored[5]?.options).toEqual(["English", "Tamil", "Malay"]);
        // The applicant reads their own answers as asked, without currency.
        const mine = await applicant.hub.getMyApplication(
          created,
          applicant.token,
        );
        expect(mine.status(), await mine.text()).toBe(200);
        const { answers } = (await mine.json()) as MyApplicationDetail;
        expect(answers).toEqual(stored);
        expect(JSON.stringify(answers)).not.toContain("current");
      }
    },
  );
});

test("answers sent while the outcome is uncertain are checked when the original request recovers it", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withWorlds(
    request,
    "usa1",
    ["sgp"],
    async (applicant, _worlds, world) => {
      const opening = await publish(world, "Pending Asker", askedQuestions);
      const domain = world.org.domain;
      const n = opening.opening_number;
      const ids = await liveQuestionIDs(applicant, domain, n);
      const [role, , years] = ids as [string, string, string];
      setOrgHome(world, "deu");
      let restored = false;
      try {
        const refusedKey = hubIdempotencyKey();
        const refusedAnswers = [{ question_id: role, value: "Engineer" }];
        const createdKey = hubIdempotencyKey();
        const answers = [...refusedAnswers, { question_id: years, value: 2 }];
        for (const [key, sent] of [
          [refusedKey, refusedAnswers],
          [createdKey, answers],
        ] as const) {
          const pending = await apply(applicant, domain, n, key, undefined, [
            ...sent,
          ]);
          expect(pending.status(), await pending.text()).toBe(202);
        }
        setOrgHome(world, "sgp");
        restored = true;
        await expectAnswersInvalid(
          await apply(applicant, domain, n, refusedKey, undefined, [
            ...refusedAnswers,
          ]),
          [years],
        );
        const created = await expectCreated(
          await apply(applicant, domain, n, createdKey, undefined, [
            ...answers,
          ]),
          domain,
          n,
        );
        expect(
          storedAnswers(world, created)
            .filter((entry) => entry.answer !== undefined)
            .map((entry) => entry.answer),
        ).toEqual(["Engineer", 2]);
      } finally {
        if (!restored) setOrgHome(world, "sgp");
      }
    },
  );
});

test("concurrent applications to one Opening create exactly one", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withWorlds(
    request,
    "sgp",
    ["sgp"],
    async (applicant, _worlds, world) => {
      const opening = await publish(world, "Contested Engineer");
      const domain = world.org.domain;
      const distinct = await Promise.all(
        Array.from({ length: 5 }, () =>
          apply(applicant, domain, opening.opening_number),
        ),
      );
      const statuses = distinct.map((response) => response.status()).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      for (const response of distinct.filter((r) => r.status() === 409)) {
        await expectProblem(
          response,
          409,
          "vetchium-problem-details/hub-application-exists",
        );
      }
      const second = await publish(world, "Second Contested Engineer");
      const key = hubIdempotencyKey();
      const sameKey = await Promise.all(
        Array.from({ length: 3 }, () =>
          apply(applicant, domain, second.opening_number, key),
        ),
      );
      const numbers = new Set<number>();
      for (const response of sameKey) {
        const reference = await expectCreated(
          response,
          domain,
          second.opening_number,
        );
        numbers.add(reference.application_number);
      }
      expect(numbers.size).toBe(1);
      expect(
        orgSQL(
          `SELECT count(*) FROM vetchium.org_applications AS a
         JOIN vetchium.org_openings AS o USING (org_opening_id)
         WHERE o.org_did = ${sqlLiteral(world.did)}::uuid`,
        ),
      ).toBe("2");
    },
  );
});

test("withdraw works from every state the applicant may leave", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withWorlds(
    request,
    "sgp",
    ["sgp"],
    async (applicant, _worlds, world) => {
      for (const state of [
        "submitted",
        "in_pipeline",
        "offered",
        "offer_accepted",
      ] as const) {
        const opening = await publish(world, `Engineer ${state}`);
        const created = await expectCreated(
          await apply(applicant, world.org.domain, opening.opening_number),
          world.org.domain,
          opening.opening_number,
        );
        if (state !== "submitted") {
          await moveToStage(world, applicant, created, state);
        }
        const withdrawn = await withdraw(applicant, created);
        expect(withdrawn.status(), `${state}: ${await withdrawn.text()}`).toBe(
          200,
        );
        expect((await myApplication(applicant, created)).status).toBe(
          "withdrawn",
        );
      }
      const terminal = await publish(world, "Engineer not progressing");
      const created = await expectCreated(
        await apply(applicant, world.org.domain, terminal.opening_number),
        world.org.domain,
        terminal.opening_number,
      );
      const ended = await world.api.markApplicationNotProgressing(world.owner, {
        opening_number: terminal.opening_number,
        application_number: created.application_number,
        version: 1,
      });
      expect(ended.status(), await ended.text()).toBe(200);
      await expectProblem(
        await withdraw(applicant, created),
        409,
        "vetchium-problem-details/hub-application-state-conflict",
      );
      expect((await myApplication(applicant, created)).status).toBe(
        "not_progressing",
      );
    },
  );
});

test("Openings that are not accepting, unknown ones, and suspended Orgs refuse applications", async ({
  request,
}) => {
  test.setTimeout(120_000);
  await withWorlds(
    request,
    "sgp",
    ["sgp", "usa1"],
    async (applicant, worlds) => {
      const [local, remote] = worlds as [World, World];
      for (const world of worlds) {
        const paused = await publish(world, "Paused Engineer");
        const pause = await world.api.requestOpeningChange(world.owner, {
          opening_number: paused.opening_number,
          version: paused.version,
          kind: "pause",
        });
        expect(pause.status(), await pause.text()).toBe(200);
        await expectProblem(
          await apply(applicant, world.org.domain, paused.opening_number),
          409,
          "vetchium-problem-details/hub-opening-not-accepting",
        );
        await expectProblem(
          await apply(applicant, world.org.domain, 9999),
          404,
          "vetchium-problem-details/hub-opening-not-found",
        );
      }
      const closed = await publish(local, "Closed Engineer");
      const close = await local.api.requestOpeningChange(local.owner, {
        opening_number: closed.opening_number,
        version: closed.version,
        kind: "close",
      });
      expect(close.status(), await close.text()).toBe(200);
      await expectProblem(
        await apply(applicant, local.org.domain, closed.opening_number),
        409,
        "vetchium-problem-details/hub-opening-not-accepting",
      );
      await expectProblem(
        await apply(applicant, `org-${randomUUID()}.example.com`, 1),
        404,
        "vetchium-problem-details/hub-org-not-found",
      );

      // Suspension stops new applications; existing ones still show.
      const open = await publish(remote, "Open Engineer");
      const later = await publish(remote, "Later Engineer");
      const existing = await expectCreated(
        await apply(applicant, remote.org.domain, open.opening_number),
        remote.org.domain,
        open.opening_number,
      );
      await expectProjected(applicant, existing, "applied");
      orgSQL(
        `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
       WHERE org_did = ${sqlLiteral(remote.did)}::uuid`,
        "usa1",
      );
      await expectProblem(
        await apply(applicant, remote.org.domain, later.opening_number),
        409,
        "vetchium-problem-details/hub-opening-not-accepting",
      );
      expect((await myApplication(applicant, existing)).status).toBe("applied");
      expect(
        (await myApplications(applicant)).applications.map(
          (entry) => entry.opening_title,
        ),
      ).toEqual(["Open Engineer"]);
    },
  );
});

test("my applications list newest activity first with keyset pagination", async ({
  request,
}) => {
  test.setTimeout(90_000);
  await withWorlds(
    request,
    "sgp",
    ["sgp"],
    async (applicant, _worlds, world) => {
      const references: ApplicationReference[] = [];
      for (const title of ["First", "Second", "Third"]) {
        const opening = await publish(world, title);
        references.push(
          await expectCreated(
            await apply(applicant, world.org.domain, opening.opening_number),
            world.org.domain,
            opening.opening_number,
          ),
        );
      }
      for (const reference of references) {
        await expectProjected(applicant, reference, "applied");
      }
      // Withdrawing the first makes it the newest activity.
      const first = references[0] as ApplicationReference;
      expect((await withdraw(applicant, first)).status()).toBe(200);
      await expectProjected(applicant, first, "withdrawn");
      const page = await applicant.hub.listMyApplications(
        { limit: 2 },
        applicant.token,
      );
      expect(page.status()).toBe(200);
      const firstPage = (await page.json()) as ListMyApplicationsResponse;
      expect(
        firstPage.applications.map((entry) => entry.opening_title),
      ).toEqual(["First", "Third"]);
      const key = firstPage.next_pagination_key;
      if (key === undefined) throw new Error("missing pagination key");
      const next = await applicant.hub.listMyApplications(
        { limit: 2, pagination_key: key },
        applicant.token,
      );
      const secondPage = (await next.json()) as ListMyApplicationsResponse;
      expect(
        secondPage.applications.map((entry) => entry.opening_title),
      ).toEqual(["Second"]);
      expect(secondPage.next_pagination_key).toBeUndefined();
      await expectProblem(
        await applicant.hub.listMyApplications(
          { pagination_key: `${key}x` },
          applicant.token,
        ),
        400,
        "vetchium-problem-details/invalid-pagination-key",
      );
      // Another Hub user sees none of them.
      const stranger = seedApplicant(request, "sgp", "Stranger");
      try {
        expect((await myApplications(stranger)).applications).toEqual([]);
        await expectProblem(
          await stranger.hub.getMyApplication(first, stranger.token),
          404,
          "vetchium-problem-details/hub-application-not-found",
        );
        await expectProblem(
          await withdraw(stranger, references[1] as ApplicationReference),
          404,
          "vetchium-problem-details/hub-application-not-found",
        );
      } finally {
        if (stranger.alias)
          cleanupGlobalHubPrincipal(stranger.did, stranger.alias);
        cleanupHubUser(stranger.email, "sgp");
      }
    },
  );
});

test("Hub application endpoints reject malformed, unauthenticated, and unavailable requests", async ({
  request,
}) => {
  test.setTimeout(60_000);
  await withWorlds(
    request,
    "ind1",
    ["usa1"],
    async (applicant, _worlds, world) => {
      const hub = applicant.hub;
      const reference = {
        domain: world.org.domain,
        opening_number: 1,
        application_number: 1,
      };
      for (const path of [
        "/apply-to-opening",
        "/withdraw-application",
        "/list-my-applications",
        "/get-my-application",
      ]) {
        await expectProblem(
          await hub.post(path, {}, { idempotencyKey: hubIdempotencyKey() }),
          401,
          "vetchium-problem-details/hub-authentication-required",
        );
        await expectProblem(
          await hub.postRaw(path, "{not json", {
            token: applicant.token,
            idempotencyKey: hubIdempotencyKey(),
          }),
          400,
          "vetchium-problem-details/invalid-json",
        );
      }
      await expectProblem(
        await hub.applyToOpening(
          {
            domain: "not a domain",
            opening_number: 0,
            cover_note: "a".repeat(5001),
          },
          { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["domain", "opening_number", "cover_note"],
      );
      const withoutKey = await hub.post(
        "/apply-to-opening",
        { domain: world.org.domain, opening_number: 1 },
        { token: applicant.token },
      );
      expect(withoutKey.status()).toBe(400);
      await expectProblem(
        await hub.withdrawApplication(
          { ...reference, application_number: 0 },
          { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["application_number"],
      );
      await expectProblem(
        await hub.getMyApplication(
          { ...reference, opening_number: 0 },
          applicant.token,
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["opening_number"],
      );
      await expectProblem(
        await hub.listMyApplications({ limit: 51 }, applicant.token),
        400,
        "vetchium-problem-details/validation-failed",
        ["limit"],
      );
      // ind1 cannot reach its directory: nothing is sent and nothing is read.
      await expectProblem(
        await hub.applyToOpening(
          { domain: world.org.domain, opening_number: 1 },
          { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
        ),
        503,
        "vetchium-problem-details/hub-org-unavailable",
      );
      await expectProblem(
        await withdraw(applicant, reference),
        503,
        "vetchium-problem-details/hub-org-unavailable",
      );
      await expectProblem(
        await hub.getMyApplication(reference, applicant.token),
        503,
        "vetchium-problem-details/hub-org-unavailable",
      );
      expect(
        sqlScalarForTenant(
          "ind1",
          `SELECT count(*) FROM vetchium.federation_operations
         WHERE owner_principal_id = ${sqlLiteral(applicant.did)}`,
        ),
      ).toBe("0");
    },
  );
});

function expectMeshProblem(
  response: MeshResponse,
  status: number,
  type: string,
): void {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(response.body).toMatchObject({
    status,
    type: `vetchium-problem-details/${type}`,
  });
}

test("the mesh Hub application read answers only the applicant's own tenant", async ({
  request,
  apiCoverage,
}) => {
  test.setTimeout(90_000);
  await withWorlds(
    request,
    "sgp",
    ["usa1"],
    async (applicant, _worlds, world) => {
      const opening = await publish(world, "Mesh Engineer");
      const created = await expectCreated(
        await apply(applicant, world.org.domain, opening.opening_number),
        world.org.domain,
        opening.opening_number,
      );
      const body = { ...created, applicant_did: applicant.did };
      const peer = (
        from: TestTenant,
        to: TestTenant,
        payload: unknown,
        options: { rawBody?: string; certificate?: "health" } = {},
      ) =>
        meshPeerRequest(from, to, payload, apiCoverage, {
          path: "/api/mesh/hub-applications/get",
          ...options,
        });

      const own = peer("sgp", "usa1", body);
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      expect(own.body).toMatchObject({ status: "applied" });
      // deu asserting an sgp applicant learns nothing.
      expectMeshProblem(
        peer("deu", "usa1", body),
        404,
        "hub-application-not-found",
      );
      expectMeshProblem(
        peer("sgp", "usa1", { ...body, application_number: 99 }),
        404,
        "hub-application-not-found",
      );
      expectMeshProblem(
        peer("sgp", "usa1", body, { certificate: "health" }),
        401,
        "mesh-peer-authentication-required",
      );
      expectMeshProblem(
        peer("sgp", "usa1", undefined, { rawBody: "{not json" }),
        400,
        "invalid-json",
      );
      expectMeshProblem(
        peer("sgp", "usa1", { ...body, applicant_did: "x" }),
        400,
        "validation-failed",
      );
      // ind1 cannot reach its directory to check the applicant's home.
      expectMeshProblem(peer("sgp", "ind1", body), 503, "hub-org-unavailable");

      const relay = (
        tenant: TestTenant,
        payload: unknown,
        options: { rawBody?: string; authorization?: string | null } = {},
      ) =>
        meshRelayRequest(
          tenant,
          "/mesh/hub-applications/get",
          payload,
          apiCoverage,
          options,
        );
      expect(relay("sgp", body).status).toBe(200);
      expectMeshProblem(
        relay("sgp", { ...body, domain: `org-${randomUUID()}.example.com` }),
        404,
        "hub-application-not-found",
      );
      expectMeshProblem(
        relay("sgp", body, { authorization: null }),
        401,
        "mesh-relay-authentication-required",
      );
      expectMeshProblem(
        relay("sgp", undefined, { rawBody: "{not json" }),
        400,
        "invalid-json",
      );
      expectMeshProblem(
        relay("sgp", { ...body, opening_number: 0 }),
        400,
        "validation-failed",
      );
      expectMeshProblem(relay("ind1", body), 503, "hub-org-unavailable");
    },
  );
});

test("an authority refuses a command for an applicant the sending tenant does not home", async ({
  request,
  apiCoverage,
}) => {
  test.setTimeout(60_000);
  await withWorlds(
    request,
    "sgp",
    ["usa1"],
    async (applicant, _worlds, world) => {
      const opening = await publish(world, "Guarded Engineer");
      const payload: HubApplyPayload = {
        opening_number: opening.opening_number,
        applicant_did: applicant.did,
        snapshot: {
          display_name: "Impostor",
          handle: applicant.handle,
          resident_country: "US",
          websites: [],
          work_experiences: [],
          certifications: [],
          language_abilities: [],
          educational_qualifications: [],
        },
      };
      const commandIDs: string[] = [];
      const command = (aggregate: string) => {
        const commandID = randomUUID();
        commandIDs.push(commandID);
        return {
          command_id: commandID,
          correlation_id: randomUUID(),
          kind: "hub-apply",
          authority_principal_type: "org",
          authority_principal_did: world.did,
          aggregate_id: aggregate,
          payload,
        };
      };
      // deu claims a Hub user the directory homes at sgp.
      const forged = meshPeerRequest(
        "deu",
        "usa1",
        command(String(opening.opening_number)),
        apiCoverage,
        { path: "/api/mesh/commands/execute" },
      );
      expect(forged.status, JSON.stringify(forged.body)).toBe(200);
      const result = forged.body as CommandResult;
      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({
        type: "vetchium-problem-details/federation-initiator-mismatch",
      });
      const sent = meshPeerRequest(
        "sgp",
        "usa1",
        command(String(opening.opening_number)),
        apiCoverage,
        { path: "/api/mesh/commands/execute" },
      );
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      expect((sent.body as CommandResult).status).toBe(201);
      expect(
        ((sent.body as CommandResult).body as HubApplyResult)
          .application_number,
      ).toBe(1);
      expect(
        orgSQL(
          `SELECT count(*) FROM vetchium.org_applications AS a
         JOIN vetchium.org_openings AS o USING (org_opening_id)
         WHERE o.org_did = ${sqlLiteral(world.did)}::uuid`,
          "usa1",
        ),
      ).toBe("1");
      // The commands came straight from the test, so clean their results here.
      orgSQL(
        `DELETE FROM vetchium.federation_command_ledger
       WHERE command_id::text IN (${commandIDs.map(sqlLiteral).join(", ")})`,
        "usa1",
      );
    },
  );
});
