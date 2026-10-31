import { randomBytes, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type { ApplicationReference } from "typespec/hub/applications/applications";
import type {
  ApplicationDetail,
  ApplicationHistoryEntry,
  ListApplicationHistoryResponse,
  ListApplicationsResponse,
  OfferLetterUploaded,
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
  type TestTenant,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import { HubAPI, hubIdempotencyKey, MAILPIT_ORIGIN } from "../lib/hub-api.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgDID,
  orgSQL,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";

const PREFIX = "vetchium-problem-details/";
const HUB_NOT_FOUND = `${PREFIX}hub-application-not-found`;

const ALIAS_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function randomAlias(): string {
  let out = "e2e-";
  for (const byte of randomBytes(20)) {
    out += ALIAS_ALPHABET[byte % ALIAS_ALPHABET.length];
  }
  return out;
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
    questions: [
      { text: "Notice period?", type: "short_text", required: false },
    ],
  };
}

function pdf(): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% ${randomUUID()}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`,
  );
}

function inFuture(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

interface World {
  tenant: TestTenant;
  api: OrgsAPI;
  org: SignedUpOrg;
  owner: string;
  did: string;
}

interface Applicant {
  tenant: TestTenant;
  email: string;
  did: string;
  token: string;
  alias: string;
  hub: HubAPI;
}

async function newOrg(
  request: APIRequestContext,
  tenant: TestTenant,
): Promise<World> {
  const api = new OrgsAPI(request, tenant);
  const org = await signupOrg(api);
  const owner = await loginOrg(api, org);
  const upgraded = await api.setSubscriptionPlan(owner, {
    plan_oid: "org-silver-tier",
    billing_interval: "month",
  });
  expect(upgraded.status(), await upgraded.text()).toBe(200);
  return { tenant, api, org, owner, did: orgDID(org.domain, tenant) };
}

function seedApplicant(
  request: APIRequestContext,
  tenant: TestTenant,
): Applicant {
  const email = `e2e+${randomUUID()}@e2e-application-retention.example.test`;
  const seeded = seedActiveHubUser(tenant, email, "Ada Applicant");
  const applicant: Applicant = {
    tenant,
    email,
    did: seeded.hubUserDID,
    token: seeded.sessionToken,
    alias: randomAlias(),
    hub: new HubAPI(request, tenant),
  };
  seedGlobalHubPrincipal(applicant.did, tenant, applicant.alias);
  return applicant;
}

function cleanupApplicant(applicant: Applicant, world: World | undefined) {
  const did = sqlLiteral(applicant.did);
  if (world) {
    const commandIDs = sqlScalarForTenant(
      applicant.tenant,
      `SELECT coalesce(string_agg(quote_literal(command_id::text), ','), '')
       FROM vetchium.federation_operations
       WHERE owner_principal_type = 'hub_user' AND owner_principal_id = ${did}`,
    );
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
    sqlScalarForTenant(
      applicant.tenant,
      `DELETE FROM vetchium.audit_events
       WHERE entity_type = 'federation_event' AND entity_id IN (
         SELECT event_id::text FROM vetchium.federation_inbox
         WHERE aggregate_type = 'org_application'
           AND aggregate_id LIKE ${sqlLiteral(`${world.did}:%`)});
       DELETE FROM vetchium.federation_inbox
       WHERE aggregate_type = 'org_application'
         AND aggregate_id LIKE ${sqlLiteral(`${world.did}:%`)};
       DELETE FROM vetchium.federation_event_watermarks
       WHERE destination_principal_did = ${did}::uuid;`,
    );
  }
  cleanupGlobalHubPrincipal(applicant.did, applicant.alias);
  cleanupHubUser(applicant.email, applicant.tenant);
}

async function removeOrg(world: World): Promise<void> {
  orgSQL(
    `DELETE FROM vetchium.federation_outbox
     WHERE aggregate_type = 'org_application'
       AND aggregate_id LIKE ${sqlLiteral(`${world.did}:%`)};`,
    world.tenant,
  );
  await deleteOrgVerificationRecord(world.org.domain);
  cleanupOrg(world.org.domain, world.tenant);
}

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
    cleanupApplicant(applicant, world);
    if (world) await removeOrg(world);
  }
}

/** A published Opening whose pipeline is Panel (interview) and Checks
 * (background_check). */
async function publishedOpening(
  world: World,
): Promise<{ opening: OrgOpening; stages: PipelineStage[] }> {
  const { api, owner, org } = world;
  const created = await api.createOpening(owner, {
    content: content("Retention Engineer"),
    hiring_manager_email: org.emailAddress,
    recruiter_email: org.emailAddress,
    team_member_emails: [],
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
      {
        name: "Panel",
        kind: "interview",
        feedback_form: [{ text: "Depth", type: "text", required: true }],
      },
      { name: "Checks", kind: "background_check" },
    ],
  });
  expect(replaced.status(), await replaced.text()).toBe(200);
  const stages = ((await replaced.json()) as { stages: PipelineStage[] })
    .stages;
  return { opening, stages };
}

function stageOf(stages: PipelineStage[], index: number): PipelineStage {
  const stage = stages[index];
  if (!stage) throw new Error(`expected stage ${index}`);
  return stage;
}

async function detail(
  world: World,
  opening: number,
  application: number,
): Promise<ApplicationDetail> {
  const response = await world.api.getApplication(world.owner, {
    opening_number: opening,
    application_number: application,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as ApplicationDetail;
}

async function version(
  world: World,
  opening: number,
  application: number,
): Promise<number> {
  return (await detail(world, opening, application)).version;
}

async function apply(
  applicant: Applicant,
  world: World,
  opening: OrgOpening,
  coverNote?: string,
): Promise<ApplicationReference> {
  const notice = opening.live_content?.questions?.[0]?.id ?? "";
  const response = await applicant.hub.applyToOpening(
    {
      domain: world.org.domain,
      opening_number: opening.opening_number,
      ...(coverNote ? { cover_note: coverNote } : {}),
      answers: [{ question_id: notice, value: "Thirty days" }],
    },
    { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
  );
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as ApplicationReference;
}

async function uploadLetter(world: World): Promise<string> {
  const response = await world.api.uploadOfferLetter(world.owner, pdf());
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as OfferLetterUploaded).letter_id;
}

async function extendOffer(
  world: World,
  opening: number,
  application: number,
  days: number,
): Promise<void> {
  const response = await world.api.extendApplicationOffer(world.owner, {
    opening_number: opening,
    application_number: application,
    version: await version(world, opening, application),
    letter_id: await uploadLetter(world),
    respond_within_days: days,
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** Moves the application's age into the past so retention finds it due. */
function ageApplication(
  world: World,
  opening: number,
  application: number,
  days: number,
): void {
  orgSQL(
    `UPDATE vetchium.org_applications AS a
     SET created_at = now() - interval '${days + 30} days',
         updated_at = now() - interval '${days} days'
     FROM vetchium.org_openings AS o
     WHERE o.org_opening_id = a.org_opening_id
       AND o.org_did = ${sqlLiteral(world.did)}::uuid
       AND o.opening_number = ${opening}
       AND a.application_number = ${application}`,
    world.tenant,
  );
}

async function expectMyListing(
  applicant: Applicant,
  reference: ApplicationReference,
  listed: boolean,
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
        return response.status() === 200;
      },
      { timeout: 20_000 },
    )
    .toBe(listed);
}

for (const [applicantTenant, orgTenant, label] of [
  ["sgp", "sgp", "a local"],
  ["usa1", "sgp", "a remote"],
] as const) {
  test(`retention removes ${label} applicant's data and keeps the facts on both sides`, async ({
    request,
  }) => {
    await withApplicant(
      request,
      applicantTenant,
      orgTenant,
      async (applicant, world) => {
        const { opening, stages } = await publishedOpening(world);
        const reference = await apply(
          applicant,
          world,
          opening,
          "Please consider my application",
        );
        const number = reference.application_number;
        const shortlist = await world.api.shortlistApplication(world.owner, {
          opening_number: opening.opening_number,
          application_number: number,
          version: 1,
          stage_id: stageOf(stages, 0).id,
        });
        expect(shortlist.status(), await shortlist.text()).toBe(200);
        const scheduled = await world.api.scheduleInterview(world.owner, {
          opening_number: opening.opening_number,
          application_number: number,
          version: await version(world, opening.opening_number, number),
          start_time: inFuture(120),
          duration_minutes: 45,
          mode: "video",
          video_url: "https://meet.example.com/retention-room",
          interviewer_emails: [world.org.emailAddress],
        });
        expect(scheduled.status(), await scheduled.text()).toBe(200);
        orgSQL(
          `UPDATE vetchium.org_interviews AS i
           SET starts_at = now() - interval '1 hour'
           FROM vetchium.org_applications AS a
           JOIN vetchium.org_openings AS o USING (org_opening_id)
           WHERE a.org_application_id = i.org_application_id
             AND o.org_did = ${sqlLiteral(world.did)}::uuid
             AND o.opening_number = ${opening.opening_number}
             AND a.application_number = ${number}`,
          world.tenant,
        );
        const interview = {
          opening_number: opening.opening_number,
          application_number: number,
          interview_number: 1,
        };
        const completed = await world.api.recordInterviewOutcome(world.owner, {
          ...interview,
          version: await version(world, opening.opening_number, number),
          outcome: "completed",
        });
        expect(completed.status(), await completed.text()).toBe(200);
        const criterion = stageOf(stages, 0).feedback_form?.[0]?.id ?? "";
        const feedback = await world.api.submitInterviewFeedback(world.owner, {
          ...interview,
          version: await version(world, opening.opening_number, number),
          recommendation: "yes",
          notes: "Hire",
          criteria_answers: [
            { criterion_id: criterion, value: "Unusually deep reasoning" },
          ],
        });
        expect(feedback.status(), await feedback.text()).toBe(200);
        await extendOffer(world, opening.opening_number, number, 14);
        const before = await detail(world, opening.opening_number, number);
        expect(before.offers).toHaveLength(1);
        expect(before.interviews).toHaveLength(1);
        expect(before.cover_note).toBe("Please consider my application");
        expect(before.answers[0]?.answer).toBe("Thirty days");
        expect(
          before.interviews[0]?.feedback[0]?.criteria_answers[0]?.answer,
        ).toBe("Unusually deep reasoning");
        const letterIDs = orgSQL(
          `SELECT coalesce(string_agg(letter_object_id::text, ','), '')
         FROM vetchium.org_application_offers AS f
         JOIN vetchium.org_applications AS a USING (org_application_id)
         JOIN vetchium.org_openings AS o USING (org_opening_id)
         WHERE o.org_did = ${sqlLiteral(world.did)}::uuid`,
          world.tenant,
        );
        expect(letterIDs).not.toBe("");

        // The Org ends the candidacy; only then does retention apply.
        const ended = await world.api.markApplicationNotProgressing(
          world.owner,
          {
            opening_number: opening.opening_number,
            application_number: number,
            version: await version(world, opening.opening_number, number),
          },
        );
        expect(ended.status(), await ended.text()).toBe(200);
        await expectMyListing(applicant, reference, true);

        ageApplication(world, opening.opening_number, number, 366);
        await expect
          .poll(
            async () =>
              (await detail(world, opening.opening_number, number)).removed,
            { timeout: 20_000 },
          )
          .toBe(true);

        // The Org keeps numbers, state, and history; the personal data is gone.
        const removed = await detail(world, opening.opening_number, number);
        expect(removed).toMatchObject({
          application_number: number,
          state: "not_progressing",
          removed: true,
          offers: [],
          interviews: [],
          assessments: [],
          background_checks: [],
        });
        expect(removed.cover_note).toBeUndefined();
        expect(removed.answers).toEqual([]);
        expect(JSON.stringify(removed)).not.toContain("Unusually deep");
        expect(removed.snapshot.display_name).toBe("Removed applicant");
        expect(JSON.stringify(removed)).not.toContain("Ada");
        expect(JSON.stringify(removed)).not.toContain("Please consider");
        expect(JSON.stringify(removed)).not.toContain("Thirty days");
        expect(JSON.stringify(removed)).not.toContain("retention-room");

        const listed = await world.api.listApplications(world.owner, {
          opening_number: opening.opening_number,
          view: "candidates",
          states: ["not_progressing"],
        });
        expect(listed.status(), await listed.text()).toBe(200);
        const summary = (
          (await listed.json()) as ListApplicationsResponse
        ).applications.find((entry) => entry.application_number === number);
        expect(summary).toMatchObject({
          removed: true,
          display_name: "Removed applicant",
          state: "not_progressing",
        });

        // A removed applicant is not found by name.
        const byName = await world.api.listApplications(world.owner, {
          opening_number: opening.opening_number,
          view: "candidates",
          states: ["not_progressing"],
          name_query: "Removed",
        });
        expect(
          ((await byName.json()) as ListApplicationsResponse).applications,
        ).toHaveLength(0);

        const entries = (
          (await (
            await world.api.listApplicationHistory(world.owner, {
              opening_number: opening.opening_number,
              application_number: number,
            })
          ).json()) as ListApplicationHistoryResponse
        ).entries;
        const last: ApplicationHistoryEntry | undefined = entries[0];
        expect(last).toMatchObject({ action: "removed", actor: "system" });

        // The applicant's tenant dropped the projection, and the live read
        // no longer finds the application.
        await expectMyListing(applicant, reference, false);
        await expectProblem(
          await applicant.hub.getMyApplication(reference, applicant.token),
          404,
          HUB_NOT_FOUND,
        );

        // The letter's bytes left through the deletion queue.
        await expect
          .poll(
            () =>
              orgSQL(
                `SELECT count(*) FROM vetchium.org_offer_letter_objects
               WHERE org_did = ${sqlLiteral(world.did)}::uuid`,
                world.tenant,
              ),
            { timeout: 30_000 },
          )
          .toBe("0");
      },
    );
  });
}

/** Counts the messages to `email` whose subject contains `subject`. Mailpit
 * is called with plain fetch so API-coverage tracking ignores it. */
async function mailCount(email: string, subject: string): Promise<number> {
  const response = await fetch(
    `${MAILPIT_ORIGIN}/api/v1/search?query=${encodeURIComponent(
      `to:${email} subject:"${subject}"`,
    )}`,
  );
  const body = (await response.json()) as { messages_count: number };
  return body.messages_count;
}

async function allMailTexts(email: string): Promise<string[]> {
  const search = await fetch(
    `${MAILPIT_ORIGIN}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
  const { messages } = (await search.json()) as { messages: { ID: string }[] };
  return Promise.all(
    messages.map(async ({ ID }) => {
      const message = await fetch(`${MAILPIT_ORIGIN}/view/${ID}.txt`);
      return message.ok ? message.text() : "";
    }),
  );
}

async function expectMail(
  email: string,
  subject: string,
  count = 1,
): Promise<void> {
  await expect
    .poll(() => mailCount(email, subject), {
      message: `mail "${subject}"`,
      timeout: 30_000,
    })
    .toBe(count);
}

for (const [applicantTenant, orgTenant, label] of [
  ["sgp", "sgp", "a local"],
  ["usa1", "sgp", "a remote"],
] as const) {
  test(`${label} applicant is emailed about changes, never their content`, async ({
    request,
  }) => {
    await withApplicant(
      request,
      applicantTenant,
      orgTenant,
      async (applicant, world) => {
        const orgName = orgSQL(
          `SELECT display_name FROM vetchium.orgs
         WHERE org_did = ${sqlLiteral(world.did)}::uuid`,
          world.tenant,
        );
        const { opening, stages } = await publishedOpening(world);
        const n = opening.opening_number;
        const reference = await apply(applicant, world, opening);
        const number = reference.application_number;
        // Applying and the applicant's own actions send nothing.
        expect(await mailCount(applicant.email, orgName)).toBe(0);

        const shortlist = await world.api.shortlistApplication(world.owner, {
          opening_number: n,
          application_number: number,
          version: 1,
          stage_id: stageOf(stages, 0).id,
        });
        expect(shortlist.status(), await shortlist.text()).toBe(200);
        await expectMail(applicant.email, "has an update", 1);

        const scheduled = await world.api.scheduleInterview(world.owner, {
          opening_number: n,
          application_number: number,
          version: await version(world, n, number),
          start_time: inFuture(120),
          duration_minutes: 45,
          mode: "video",
          video_url: "https://meet.example.com/secret-room",
          interviewer_emails: [world.org.emailAddress],
        });
        expect(scheduled.status(), await scheduled.text()).toBe(200);
        await expectMail(applicant.email, "An interview was scheduled", 1);

        const changed = await world.api.changeInterview(world.owner, {
          opening_number: n,
          application_number: number,
          version: await version(world, n, number),
          interview_number: 1,
          start_time: inFuture(180),
          duration_minutes: 30,
          mode: "in_person",
          location: "Secret Room 42",
          interviewer_emails: [world.org.emailAddress],
        });
        expect(changed.status(), await changed.text()).toBe(200);
        await expectMail(applicant.email, "changed", 1);

        const cancelled = await world.api.cancelInterview(world.owner, {
          opening_number: n,
          application_number: number,
          version: await version(world, n, number),
          interview_number: 1,
        });
        expect(cancelled.status(), await cancelled.text()).toBe(200);
        await expectMail(applicant.email, "was cancelled", 1);

        const moved = await world.api.moveApplicationStage(world.owner, {
          opening_number: n,
          application_number: number,
          version: await version(world, n, number),
          stage_id: stageOf(stages, 1).id,
        });
        expect(moved.status(), await moved.text()).toBe(200);
        await expectMail(applicant.email, "has an update", 2);

        const asked = await world.api.requestBackgroundCheckConsent(
          world.owner,
          {
            opening_number: n,
            application_number: number,
            version: await version(world, n, number),
            check_types: ["identity", "criminal"] as never,
          },
        );
        expect(asked.status(), await asked.text()).toBe(200);
        await expectMail(applicant.email, "asked for your consent", 1);

        await extendOffer(world, n, number, 3);
        await expectMail(applicant.email, "extended an offer", 1);
        const withdrawn = await world.api.withdrawApplicationOffer(
          world.owner,
          {
            opening_number: n,
            application_number: number,
            version: await version(world, n, number),
          },
        );
        expect(withdrawn.status(), await withdrawn.text()).toBe(200);
        await expectMail(applicant.email, "withdrew an offer", 1);

        await extendOffer(world, n, number, 3);
        await expectMail(applicant.email, "extended an offer", 2);

        // Under a day left: the applicant is warned once.
        const offerSQL = (set: string) =>
          orgSQL(
            `UPDATE vetchium.org_application_offers AS f SET ${set}
           FROM vetchium.org_applications AS a
           JOIN vetchium.org_openings AS o USING (org_opening_id)
           WHERE f.org_application_id = a.org_application_id
             AND f.offer_status = 'extended'
             AND o.org_did = ${sqlLiteral(world.did)}::uuid`,
            world.tenant,
          );
        offerSQL(
          "extended_at = now() - interval '3 days', respond_by = now() + interval '12 hours'",
        );
        await expectMail(applicant.email, "is about to expire", 1);
        // The deadline passes unanswered.
        offerSQL("respond_by = now() - interval '1 second'");
        await expectMail(applicant.email, "expired", 1);
        expect((await detail(world, n, number)).state).toBe("offer_declined");

        // Each message names the Org and the Opening, links to the
        // application, and carries nothing the Org entered.
        const texts = await allMailTexts(applicant.email);
        expect(texts).toHaveLength(11);
        for (const text of texts) {
          expect(text).toContain(orgName);
          expect(text).toContain("Retention Engineer");
          expect(text).toContain(`/applications?region=${applicantTenant}`);
          for (const secret of [
            "secret-room",
            "Secret Room",
            "identity",
            "criminal",
            "Panel",
            "Checks",
            "pdf",
          ]) {
            expect(text, `message leaked ${secret}`).not.toContain(secret);
          }
        }
      },
    );
  });
}
