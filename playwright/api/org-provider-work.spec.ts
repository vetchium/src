import { randomUUID } from "node:crypto";
import type {
  ApplicationDetail,
  ListApplicationHistoryResponse,
} from "typespec/orgs/applications/applications";
import type { Engagement } from "typespec/orgs/marketplace/engagements";
import type {
  JobDetail,
  ListJobsResponse,
  ListWorkQueueRequest,
  ListWorkQueueResponse,
  WorkDetail,
  WorkItem,
  WriteResult,
} from "typespec/orgs/marketplace/work/work";
import { expectProblem } from "../lib/admin-api.ts";
import type { TestTenant } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { hubIdempotencyKey } from "../lib/hub-api.ts";
import {
  apply,
  cleanupApplicant,
  myApplication,
  seedApplicant,
} from "../lib/hub-applicant.ts";
import { meshPeerRequest, meshRelayRequest } from "../lib/mesh.ts";
import {
  addOrgMember,
  inviteeAddress,
  OrgsAPI,
  orgDID,
  orgSQL,
  orgsIdempotencyKey,
} from "../lib/orgs-api.ts";
import {
  cleanupOutbox,
  detailOf,
  shortlist,
} from "../lib/orgs-applications.ts";
import {
  activate,
  asConsumer,
  asProvider,
  type Provider,
  problems,
  setOrgHome,
  withProvider,
} from "../lib/orgs-marketplace.ts";
import {
  assign,
  candidate,
  routed,
  seedEngagements,
  type World,
  withWorld,
} from "../lib/orgs-routing.ts";

const base = "vetchium-problem-details/";
const work = {
  notFound: `${base}org-engagement-work-not-found`,
  applicationState: `${base}org-application-state-conflict`,
  interviewNotFound: `${base}org-interview-not-found`,
  interviewState: `${base}org-interview-state-conflict`,
  feedbackExists: `${base}org-interview-feedback-exists`,
  interviewers: `${base}org-interview-interviewers-invalid`,
  limit: `${base}org-interview-limit-reached`,
  paginationKey: `${base}invalid-pagination-key`,
};

// A second sgp API process whose region catalog also names `gone`, a tenant
// that never answers.
const unavailableOrigin = "http://127.0.0.1:18084";

const inFuture = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();

function interview(provider: Provider, minutes = 120) {
  return {
    start_time: inFuture(minutes),
    duration_minutes: 45,
    mode: "video" as const,
    video_url: "https://meet.example.test/panel",
    interviewer_emails: [provider.org.emailAddress],
  };
}

async function queue(
  provider: Provider,
  request: ListWorkQueueRequest = {},
  api: OrgsAPI = provider.api,
): Promise<ListWorkQueueResponse> {
  const response = await api.listWorkQueue(provider.owner, request);
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ListWorkQueueResponse;
}

/** The queue entry for the applicant, once the provider's tenant lists it. */
async function itemOf(provider: Provider, name: string): Promise<WorkItem> {
  const found = (await queue(provider)).items.find(
    (item) => item.applicant_name === name,
  );
  if (found === undefined) throw new Error(`${name} is not in the queue`);
  return found;
}

const reference = (item: Pick<WorkItem, "engagement_id" | "work_id">) => ({
  engagement_id: item.engagement_id,
  work_id: item.work_id,
});

async function detailAs(
  provider: Provider,
  item: Pick<WorkItem, "engagement_id" | "work_id">,
): Promise<WorkDetail> {
  const response = await provider.api.getWorkItem(provider.owner, {
    engagement_id: item.engagement_id,
    work_id: item.work_id,
  });
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as WorkDetail;
}

interface Scene {
  world: World;
  engagement: Engagement;
  application: ApplicationDetail;
  item: WorkItem;
}

/**
 * The provider's engagement of `capability` assigned to the stage, and a
 * candidate named `name` at it, routed to the provider.
 */
async function routedScene(
  world: World,
  capability: "interviewing" | "assessment" | "background_check",
  stageKey: "panel" | "final" | "assess" | "check",
  name: string,
): Promise<Scene> {
  const { pair } = world;
  const engagement = await activate(pair, capability);
  await asProvider(pair, engagement.id, engagement.version);
  const stage = world[stageKey];
  await assign(world, engagement.id, stage);
  const waiting = await candidate(world, stage, name);
  const application = await routed(world, waiting, engagement.id);
  return {
    world,
    engagement,
    application,
    item: await itemOf(pair.provider, name),
  };
}

const consumerView = (scene: Scene) =>
  detailOf(
    scene.world.pair.consumer.api,
    scene.world.pair.consumer.owner,
    scene.world.opening.opening_number,
    scene.application.application_number,
  );

async function expectInaccessible(
  provider: Provider,
  item: Pick<WorkItem, "engagement_id" | "work_id">,
  label: string,
): Promise<void> {
  await expectProblem(
    await provider.api.getWorkItem(provider.owner, {
      engagement_id: item.engagement_id,
      work_id: item.work_id,
    }),
    404,
    work.notFound,
  );
  await expectProblem(
    await provider.api.scheduleWorkInterview(provider.owner, {
      engagement_id: item.engagement_id,
      work_id: item.work_id,
      ...interview(provider),
    }),
    404,
    work.notFound,
  );
  expect(
    (await queue(provider)).items.map((entry) => entry.work_id),
    label,
  ).not.toContain(item.work_id);
}

test("a provider performs a routed interview stage and the client sees all of it", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer, provider } = pair;
    const scene = await routedScene(
      world,
      "interviewing",
      "panel",
      "Ada Lovelace",
    );
    const { item } = scene;
    expect(item).toMatchObject({
      engagement_id: scene.engagement.id,
      client: { domain: consumer.org.domain },
      capability: "interviewing",
      opening: { number: opening.opening_number, title: "Engineer" },
      stage_name: "Panel",
      status: "pending",
      applicant_name: "Ada Lovelace",
    });
    expect(item.next_interview_at).toBeUndefined();

    // The provider sees the snapshot and its own work, nothing of the
    // client's other records.
    const pending = await detailAs(provider, item);
    expect(pending.snapshot.display_name).toBe("Ada Lovelace");
    expect(pending.interviews).toEqual([]);
    const text = JSON.stringify(pending);
    expect(text).not.toMatch(/application_number|version|internal_notes|offer/);

    // The client's own writes on a routed stage are refused.
    await expectProblem(
      await consumer.api.scheduleInterview(consumer.owner, {
        opening_number: opening.opening_number,
        application_number: scene.application.application_number,
        version: scene.application.version,
        start_time: inFuture(90),
        duration_minutes: 30,
        mode: "video",
        video_url: "https://meet.example.test/x",
        interviewer_emails: [consumer.org.emailAddress],
      }),
      409,
      work.applicationState,
    );

    // Interviewers must be the provider's own users.
    const stranger = await pair.provider.api.scheduleWorkInterview(
      provider.owner,
      {
        engagement_id: item.engagement_id,
        work_id: item.work_id,
        ...interview(provider),
        interviewer_emails: [consumer.org.emailAddress],
      },
    );
    expect(stranger.status(), await stranger.text()).toBe(422);
    expect(await stranger.json()).toMatchObject({
      type: work.interviewers,
      email_addresses: [consumer.org.emailAddress],
    });

    const key = orgsIdempotencyKey();
    const body = {
      engagement_id: item.engagement_id,
      work_id: item.work_id,
      ...interview(provider),
    };
    const scheduled = await provider.api.scheduleWorkInterview(
      provider.owner,
      body,
      key,
    );
    expect(scheduled.status(), await scheduled.text()).toBe(200);
    expect(scheduled.headers()["cache-control"]).toBe("no-store");
    const result = (await scheduled.json()) as WriteResult;
    expect(result).toEqual({
      work_id: item.work_id,
      status: "scheduled",
      interview_number: 1,
    });
    // Replay returns the stored result; another request on the key conflicts.
    const replay = await provider.api.scheduleWorkInterview(
      provider.owner,
      body,
      key,
    );
    expect(await replay.json()).toEqual(result);
    expect(
      (await consumerView(scene)).interviews,
      "a replay schedules once",
    ).toHaveLength(1);
    await expectProblem(
      await provider.api.scheduleWorkInterview(
        provider.owner,
        { ...body, duration_minutes: 60 },
        key,
      ),
      409,
      problems.keyConflict,
    );

    // The client sees all of it, and the history names the provider.
    const seen = await consumerView(scene);
    expect(seen.interviews[0]).toMatchObject({
      interview_number: 1,
      state: "scheduled",
      interviewers: [{ email: provider.org.emailAddress }],
      provider: { domain: provider.org.domain },
    });
    expect(seen.route?.provider.domain).toBe(provider.org.domain);
    const history = (await (
      await consumer.api.listApplicationHistory(consumer.owner, {
        opening_number: opening.opening_number,
        application_number: scene.application.application_number,
      })
    ).json()) as ListApplicationHistoryResponse;
    expect(
      history.entries.find((entry) => entry.action === "interview_scheduled"),
    ).toMatchObject({ actor: "provider", interview_number: 1 });
    expect(
      history.entries.find((entry) => entry.action === "interview_scheduled")
        ?.actor_email,
    ).toBeUndefined();

    // A scheduled candidacy lists first, with its next interview.
    const grace = await routed(
      world,
      await candidate(world, world.panel, "Grace Hopper Two"),
      scene.engagement.id,
    );
    expect(grace.route).toBeDefined();
    const listed = await queue(provider);
    expect(listed.items[0]).toMatchObject({
      work_id: item.work_id,
      status: "scheduled",
    });
    expect(listed.items[0]?.next_interview_at).toBeDefined();

    // Change, then cancel, then schedule again.
    const changed = await provider.api.changeWorkInterview(provider.owner, {
      engagement_id: item.engagement_id,
      work_id: item.work_id,
      interview_number: 1,
      ...interview(provider, 180),
    });
    expect(changed.status(), await changed.text()).toBe(200);
    await expectProblem(
      await provider.api.changeWorkInterview(provider.owner, {
        engagement_id: item.engagement_id,
        work_id: item.work_id,
        interview_number: 9,
        ...interview(provider, 180),
      }),
      404,
      work.interviewNotFound,
    );
    const cancelled = await provider.api.cancelWorkInterview(provider.owner, {
      engagement_id: item.engagement_id,
      work_id: item.work_id,
      interview_number: 1,
    });
    expect(cancelled.status(), await cancelled.text()).toBe(200);
    expect(((await cancelled.json()) as WriteResult).status).toBe("pending");
    await expectProblem(
      await provider.api.cancelWorkInterview(provider.owner, {
        engagement_id: item.engagement_id,
        work_id: item.work_id,
        interview_number: 1,
      }),
      409,
      work.interviewState,
    );
    const second = (await (
      await provider.api.scheduleWorkInterview(provider.owner, {
        engagement_id: item.engagement_id,
        work_id: item.work_id,
        ...interview(provider, 30),
      })
    ).json()) as WriteResult;
    expect(second.interview_number).toBe(2);

    // Nothing is recorded before the start; after it, the outcome, then the
    // interviewer's feedback, once.
    await expectProblem(
      await provider.api.recordWorkInterviewOutcome(provider.owner, {
        engagement_id: item.engagement_id,
        work_id: item.work_id,
        interview_number: 2,
        outcome: "completed",
      }),
      409,
      work.interviewState,
    );
    orgSQL(
      `UPDATE vetchium.org_interviews SET starts_at = now() - interval '1 hour'
       WHERE interview_number = 2 AND performer_engagement_id = '${scene.engagement.id}'
         AND org_application_id = (
           SELECT a.org_application_id FROM vetchium.org_applications AS a
           JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
           WHERE o.opening_number = ${opening.opening_number}
             AND a.application_number = ${scene.application.application_number}
             AND o.org_did = '${orgDID(consumer.org.domain)}')`,
    );
    await expectProblem(
      await provider.api.submitWorkInterviewFeedback(provider.owner, {
        engagement_id: item.engagement_id,
        work_id: item.work_id,
        interview_number: 2,
        recommendation: "yes",
        notes: "Strong",
      }),
      409,
      work.interviewState,
    );
    const completed = await provider.api.recordWorkInterviewOutcome(
      provider.owner,
      {
        engagement_id: item.engagement_id,
        work_id: item.work_id,
        interview_number: 2,
        outcome: "completed",
      },
    );
    expect(completed.status(), await completed.text()).toBe(200);
    expect(((await completed.json()) as WriteResult).status).toBe(
      "in_progress",
    );
    const feedbackBody = {
      engagement_id: item.engagement_id,
      work_id: item.work_id,
      interview_number: 2,
      recommendation: "strong_yes" as const,
      notes: "Clear thinker",
    };
    const feedback = await provider.api.submitWorkInterviewFeedback(
      provider.owner,
      feedbackBody,
    );
    expect(feedback.status(), await feedback.text()).toBe(200);
    await expectProblem(
      await provider.api.submitWorkInterviewFeedback(
        provider.owner,
        feedbackBody,
      ),
      409,
      work.feedbackExists,
    );

    const own = await detailAs(provider, item);
    // Interviews list by start, so the one that already happened is first.
    expect(own.interviews.map((entry) => entry.state)).toEqual([
      "completed",
      "cancelled",
    ]);
    expect(own.interviews[0]?.feedback).toMatchObject([
      { recommendation: "strong_yes", notes: "Clear thinker" },
    ]);
    // The consumer sees the same feedback; a second candidacy sees none.
    const final = await consumerView(scene);
    expect(final.interviews[0]?.feedback).toHaveLength(1);
    expect(final.interviews[0]?.interviewers[0]).toMatchObject({
      feedback_submitted: true,
    });
    expect(
      (await detailAs(provider, await itemOf(provider, "Grace Hopper Two")))
        .interviews,
    ).toEqual([]);

    // Each write refuses an interview that is not the provider's own, one
    // that cannot take it, and interviewers who are not its users.
    const unknown = { ...reference(item), interview_number: 9 };
    await expectProblem(
      await provider.api.cancelWorkInterview(provider.owner, unknown),
      404,
      work.interviewNotFound,
    );
    await expectProblem(
      await provider.api.recordWorkInterviewOutcome(provider.owner, {
        ...unknown,
        outcome: "completed",
      }),
      404,
      work.interviewNotFound,
    );
    await expectProblem(
      await provider.api.submitWorkInterviewFeedback(provider.owner, {
        ...unknown,
        recommendation: "yes",
        notes: "Good",
      }),
      404,
      work.interviewNotFound,
    );
    await expectProblem(
      await provider.api.changeWorkInterview(provider.owner, {
        ...reference(item),
        interview_number: 1,
        ...interview(provider, 240),
      }),
      409,
      work.interviewState,
    );
    await expectProblem(
      await provider.api.changeWorkInterview(provider.owner, {
        ...reference(item),
        interview_number: 1,
        ...interview(provider, 240),
        interviewer_emails: [consumer.org.emailAddress],
      }),
      422,
      work.interviewers,
    );
    // A candidacy holds a limited number of interviews at a stage.
    let last = await provider.api.scheduleWorkInterview(provider.owner, {
      ...reference(item),
      ...interview(provider, 300),
    });
    for (let count = 0; count < 12 && last.status() === 200; count += 1) {
      last = await provider.api.scheduleWorkInterview(provider.owner, {
        ...reference(item),
        ...interview(provider, 300 + count),
      });
    }
    expect(last.status(), await last.text()).toBe(409);
    expect(await last.json()).toMatchObject({ type: work.limit, limit: 10 });
  });
});

test("a provider reaches a candidacy only while it is routed to its engagement", async ({
  request,
}) => {
  test.setTimeout(300_000);
  await withWorld(request, async (world) => {
    const { pair, opening, panel, final } = world;
    const { consumer, provider } = pair;
    const engagement = await activate(pair, "interviewing");
    await asProvider(pair, engagement.id, engagement.version);
    await assign(world, engagement.id, panel);
    const [other] = await seedEngagements(world, "interviewing", 1);
    if (other === undefined) throw new Error("no second engagement");
    await assign(world, other, panel);

    const fresh = async (name: string, stage = panel) => {
      const waiting = await candidate(world, stage, name);
      const application = await routed(world, waiting, engagement.id);
      return { application, item: await itemOf(provider, name) };
    };

    // Rerouted in-house.
    const inHouse = await fresh("Rerouted In House");
    await routed(world, inHouse.application);
    await expectInaccessible(provider, inHouse.item, "in-house");

    // Rerouted to another provider; routing back makes new work.
    const away = await fresh("Rerouted Away");
    const toOther = await routed(world, away.application, other);
    await expectInaccessible(provider, away.item, "another provider");
    await routed(world, toOther, engagement.id);
    const back = await itemOf(provider, "Rerouted Away");
    expect(back.work_id).not.toBe(away.item.work_id);
    await expectInaccessible(provider, away.item, "the old work id");
    expect((await detailAs(provider, back)).snapshot.display_name).toBe(
      "Rerouted Away",
    );

    // Moved to another stage.
    const moved = await fresh("Moved On");
    const afterMove = await consumer.api.moveApplicationStage(consumer.owner, {
      opening_number: opening.opening_number,
      application_number: moved.application.application_number,
      version: moved.application.version,
      stage_id: final.id,
    });
    expect(afterMove.status(), await afterMove.text()).toBe(200);
    await expectInaccessible(provider, moved.item, "moved stage");

    // Out of the pipeline.
    const stopped = await fresh("Stopped");
    const notProgressing = await consumer.api.markApplicationNotProgressing(
      consumer.owner,
      {
        opening_number: opening.opening_number,
        application_number: stopped.application.application_number,
        version: stopped.application.version,
      },
    );
    expect(notProgressing.status(), await notProgressing.text()).toBe(200);
    await expectInaccessible(provider, stopped.item, "not progressing");

    // Unassigned from the stage.
    const unassigned = await fresh("Unassigned");
    const removed = await consumer.api.unassignOpeningProvider(consumer.owner, {
      opening_number: opening.opening_number,
      engagement_id: engagement.id,
      stage_id: panel.id,
    });
    expect(removed.status(), await removed.text()).toBe(200);
    await expectInaccessible(provider, unassigned.item, "unassigned");

    // Another provider's engagement does not reach this provider's work, and
    // neither does a made-up id.
    await assign(world, engagement.id, panel);
    const mine = await fresh("Mine Only");
    await expectProblem(
      await provider.api.getWorkItem(provider.owner, {
        engagement_id: randomUUID(),
        work_id: mine.item.work_id,
      }),
      404,
      work.notFound,
    );
    await expectProblem(
      await provider.api.getWorkItem(provider.owner, {
        engagement_id: mine.item.engagement_id,
        work_id: randomUUID(),
      }),
      404,
      work.notFound,
    );
    await expectProblem(
      await consumer.api.getWorkItem(consumer.owner, {
        engagement_id: mine.item.engagement_id,
        work_id: mine.item.work_id,
      }),
      404,
      work.notFound,
    );

    // An ended engagement ends access at once.
    const current = await asConsumer(pair, engagement.id);
    const ended = await consumer.api.endEngagement(consumer.owner, {
      engagement_id: engagement.id,
      version: current.version,
    });
    expect(ended.status(), await ended.text()).toBe(200);
    await expectInaccessible(provider, mine.item, "ended engagement");
  });
});

test("another provider reaches nothing of a candidacy routed elsewhere", async ({
  request,
}) => {
  test.setTimeout(300_000);
  await withWorld(request, async (world) => {
    const scene = await routedScene(
      world,
      "interviewing",
      "panel",
      "Only Mine",
    );
    await withProvider(
      request,
      async (stranger) => {
        await expectProblem(
          await stranger.api.getWorkItem(stranger.owner, {
            engagement_id: scene.item.engagement_id,
            work_id: scene.item.work_id,
          }),
          404,
          work.notFound,
        );
        await expectProblem(
          await stranger.api.scheduleWorkInterview(stranger.owner, {
            engagement_id: scene.item.engagement_id,
            work_id: scene.item.work_id,
            ...interview(stranger),
          }),
          404,
          work.notFound,
        );
        expect((await queue(stranger)).items).toEqual([]);
      },
      { tenant: "usa1" },
    );
    expect((await queue(world.pair.provider)).items).toHaveLength(1);
  });
});

test("a provider records the result of an assessment stage", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withWorld(request, async (world) => {
    const { pair } = world;
    const { provider } = pair;
    const scene = await routedScene(
      world,
      "assessment",
      "assess",
      "Ada Lovelace",
    );
    const { item } = scene;
    expect(item).toMatchObject({ stage_name: "Assess", status: "pending" });
    const body = {
      engagement_id: item.engagement_id,
      work_id: item.work_id,
      outcome: "pass" as const,
      score: 87,
      notes: "Solid across the board",
      report_url: "https://reports.example.test/ada",
    };
    await expectProblem(
      await provider.api.recordWorkAssessment(provider.owner, {
        ...body,
        score: 101,
      }),
      400,
      problems.validation,
    );
    // Interview work does not belong to an assessment stage.
    await expectProblem(
      await provider.api.scheduleWorkInterview(provider.owner, {
        engagement_id: item.engagement_id,
        work_id: item.work_id,
        ...interview(provider),
      }),
      409,
      work.applicationState,
    );
    const recorded = await provider.api.recordWorkAssessment(
      provider.owner,
      body,
    );
    expect(recorded.status(), await recorded.text()).toBe(200);
    expect(await recorded.json()).toEqual({
      work_id: item.work_id,
      status: "completed",
    });
    await expectProblem(
      await provider.api.recordWorkAssessment(provider.owner, body),
      409,
      work.applicationState,
    );
    const own = await detailAs(provider, item);
    expect(own.assessment).toMatchObject({
      outcome: "pass",
      score: 87,
      recorded_by_email: provider.org.emailAddress,
    });
    const seen = await consumerView(scene);
    expect(seen.assessments).toMatchObject([
      {
        outcome: "pass",
        recorded_by_email: provider.org.emailAddress,
        provider: { domain: provider.org.domain },
      },
    ]);
    expect(
      seen.stage_records.find((record) => record.stage.name === "Assess")
        ?.status,
    ).toBe("completed");
  });
});

test("a provider records background checks only after the applicant consents", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer, provider } = pair;
    const scene = await routedScene(
      world,
      "background_check",
      "check",
      "Ada Lovelace",
    );
    const { item } = scene;
    const consent = (types: string[]) =>
      consumer.api.requestBackgroundCheckConsent(consumer.owner, {
        opening_number: opening.opening_number,
        application_number: scene.application.application_number,
        version: scene.application.version,
        check_types: types,
      } as never);
    await expectProblem(await consent(["criminal"]), 400, problems.validation);
    const requested = await consent(["identity", "education"]);
    expect(requested.status(), await requested.text()).toBe(200);
    const seen = (await requested.json()) as ApplicationDetail;
    expect(seen.background_checks[0]).toMatchObject({
      performer: "provider",
      provider: { domain: provider.org.domain },
      consent_disclosure: "We verify what you tell us.",
      consent_state: "requested",
    });
    expect((await itemOf(provider, "Ada Lovelace")).status).toBe(
      "awaiting_consent",
    );

    const result = (type: string) => ({
      engagement_id: item.engagement_id,
      work_id: item.work_id,
      check_type: type as "identity",
      outcome: "clear" as const,
      notes: "Verified",
    });
    await expectProblem(
      await provider.api.recordWorkBackgroundCheckResult(
        provider.owner,
        result("identity"),
      ),
      409,
      work.applicationState,
    );
    // The applicant answers through the Hub.
    const applicant = world.hiring.applicants.at(-1);
    if (applicant === undefined) throw new Error("no applicant was seeded");
    const consented = await applicant.hub.giveApplicationBackgroundCheckConsent(
      {
        domain: consumer.org.domain,
        opening_number: opening.opening_number,
        application_number: scene.application.application_number,
        check_number: 1,
      },
      { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
    );
    expect(consented.status(), await consented.text()).toBe(200);
    expect((await itemOf(provider, "Ada Lovelace")).status).toBe("in_progress");
    await expectProblem(
      await provider.api.recordWorkBackgroundCheckResult(
        provider.owner,
        result("criminal"),
      ),
      400,
      problems.validation,
    );
    await expectProblem(
      await provider.api.recordWorkBackgroundCheckResult(
        provider.owner,
        result("address"),
      ),
      400,
      problems.validation,
    );
    const first = await provider.api.recordWorkBackgroundCheckResult(
      provider.owner,
      result("identity"),
    );
    expect(first.status(), await first.text()).toBe(200);
    expect(((await first.json()) as WriteResult).status).toBe("in_progress");
    await expectProblem(
      await provider.api.recordWorkBackgroundCheckResult(
        provider.owner,
        result("identity"),
      ),
      409,
      work.applicationState,
    );
    const last = await provider.api.recordWorkBackgroundCheckResult(
      provider.owner,
      result("education"),
    );
    expect(((await last.json()) as WriteResult).status).toBe("completed");

    const own = await detailAs(provider, item);
    expect(own.background_check).toMatchObject({
      consent_state: "given",
      performer: "provider",
      results: [{ check_type: "identity" }, { check_type: "education" }],
    });
    expect(own.background_check?.results[0]?.recorded_by_email).toBe(
      provider.org.emailAddress,
    );
    const final = await consumerView(scene);
    expect(final.background_checks[0]?.results).toHaveLength(2);
  });
});

test("a provider lists the Openings assigned to its sourcing engagement", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer, provider } = pair;
    const engagement = await activate(pair, "sourcing");
    await asProvider(pair, engagement.id, engagement.version);
    expect(
      (
        (await (
          await provider.api.listJobs(provider.owner, {})
        ).json()) as ListJobsResponse
      ).jobs,
    ).toEqual([]);
    await assign(world, engagement.id);

    const response = await provider.api.listJobs(provider.owner, {});
    expect(response.status(), await response.text()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const jobs = (await response.json()) as ListJobsResponse;
    expect(jobs.jobs).toMatchObject([
      {
        engagement_id: engagement.id,
        client: { domain: consumer.org.domain },
        opening: { number: opening.opening_number, title: "Engineer" },
        state: "published",
      },
    ]);
    expect(JSON.stringify(jobs)).not.toMatch(
      /application|candidate|internal_notes|hiring_manager|recruiter/,
    );
    const detail = await provider.api.getJob(provider.owner, {
      engagement_id: engagement.id,
      opening_number: opening.opening_number,
    });
    expect(detail.status(), await detail.text()).toBe(200);
    const job = (await detail.json()) as JobDetail;
    expect(job.content).toMatchObject({
      title: "Engineer",
      description: "Build reliable services",
    });
    expect(JSON.stringify(job)).not.toMatch(
      /internal_notes|hiring_manager|recruiter|team_members/,
    );
    await expectProblem(
      await provider.api.listJobs(provider.owner, { pagination_key: "nope" }),
      400,
      work.paginationKey,
    );
    const did = orgDID(consumer.org.domain, consumer.tenant);
    try {
      setOrgHome(did, "gone");
      await expectProblem(
        await provider.api.getJob(provider.owner, {
          engagement_id: engagement.id,
          opening_number: opening.opening_number,
        }),
        503,
        problems.unavailable,
      );
    } finally {
      setOrgHome(did, consumer.tenant);
    }
    expect(
      (
        (await (
          await provider.api.listJobs(provider.owner, {
            client_domain: consumer.org.domain,
            state: "closed",
          })
        ).json()) as ListJobsResponse
      ).jobs,
    ).toEqual([]);
    await expectProblem(
      await provider.api.getJob(provider.owner, {
        engagement_id: engagement.id,
        opening_number: opening.opening_number + 5,
      }),
      404,
      work.notFound,
    );

    // A stage Capability's engagement has no jobs, and unassigning ends them.
    const interviewing = await activate(pair, "interviewing");
    await asProvider(pair, interviewing.id, interviewing.version);
    await assign(world, interviewing.id, world.panel);
    expect(
      (
        (await (
          await provider.api.listJobs(provider.owner, {})
        ).json()) as ListJobsResponse
      ).jobs,
    ).toHaveLength(1);
    await expectProblem(
      await provider.api.getJob(provider.owner, {
        engagement_id: interviewing.id,
        opening_number: opening.opening_number,
      }),
      404,
      work.notFound,
    );
    const removed = await consumer.api.unassignOpeningProvider(consumer.owner, {
      opening_number: opening.opening_number,
      engagement_id: engagement.id,
    });
    expect(removed.status(), await removed.text()).toBe(200);
    expect(
      (
        (await (
          await provider.api.listJobs(provider.owner, {})
        ).json()) as ListJobsResponse
      ).jobs,
    ).toEqual([]);
    await expectProblem(
      await provider.api.getJob(provider.owner, {
        engagement_id: engagement.id,
        opening_number: opening.opening_number,
      }),
      404,
      work.notFound,
    );
  });
});

test("the work queue filters, pages, and names a tenant that does not answer", async ({
  request,
}) => {
  test.setTimeout(300_000);
  await withWorld(
    request,
    async (world) => {
      const { pair, opening } = world;
      const { consumer, provider } = pair;
      const engagement = await activate(pair, "interviewing");
      await asProvider(pair, engagement.id, engagement.version);
      await assign(world, engagement.id, world.panel);
      await assign(world, engagement.id, world.final);
      const names = ["Alpha One", "Beta Two", "Gamma Three"];
      for (const name of names) {
        await routed(
          world,
          await candidate(world, world.panel, name),
          engagement.id,
        );
      }
      await routed(
        world,
        await candidate(world, world.final, "Delta Four"),
        engagement.id,
      );
      const everything = await queue(provider);
      // The CI stack's ind1 has no directory to check callers against, so it
      // never answers; every tenant that matters here does.
      expect(everything.unavailable_tenants).not.toContain("sgp");
      expect(everything.items).toHaveLength(4);
      // Newest routed first when nothing is scheduled.
      expect(everything.items.map((item) => item.applicant_name)).toEqual([
        "Delta Four",
        "Gamma Three",
        "Beta Two",
        "Alpha One",
      ]);

      const filtered = async (request: ListWorkQueueRequest) =>
        (await queue(provider, request)).items.map(
          (item) => item.applicant_name,
        );
      expect(await filtered({ stage_name: "Final" })).toEqual(["Delta Four"]);
      expect(await filtered({ capability: "assessment" })).toEqual([]);
      expect(await filtered({ capability: "interviewing" })).toHaveLength(4);
      expect(await filtered({ status: "scheduled" })).toEqual([]);
      expect(await filtered({ status: "pending" })).toHaveLength(4);
      expect(await filtered({ client_domain: "nobody.example.test" })).toEqual(
        [],
      );
      expect(
        await filtered({
          client_domain: consumer.org.domain,
          opening_number: opening.opening_number,
          stage_name: "Panel",
        }),
      ).toHaveLength(3);
      expect(
        await filtered({
          client_domain: consumer.org.domain,
          opening_number: opening.opening_number + 1,
        }),
      ).toEqual([]);

      // An upcoming interview moves a candidacy to the front.
      const beta = await itemOf(provider, "Beta Two");
      const scheduled = await provider.api.scheduleWorkInterview(
        provider.owner,
        {
          engagement_id: beta.engagement_id,
          work_id: beta.work_id,
          ...interview(provider, 600),
        },
      );
      expect(scheduled.status(), await scheduled.text()).toBe(200);
      const gamma = await itemOf(provider, "Gamma Three");
      expect(
        (
          await provider.api.scheduleWorkInterview(provider.owner, {
            engagement_id: gamma.engagement_id,
            work_id: gamma.work_id,
            ...interview(provider, 60),
          })
        ).status(),
      ).toBe(200);
      expect(await filtered({})).toEqual([
        "Gamma Three",
        "Beta Two",
        "Delta Four",
        "Alpha One",
      ]);
      expect(await filtered({ status: "scheduled" })).toEqual([
        "Gamma Three",
        "Beta Two",
      ]);

      // Pages resume where the last stopped, and a key fits its own filters.
      const first = await queue(provider, { limit: 3 });
      expect(first.items.map((item) => item.applicant_name)).toEqual([
        "Gamma Three",
        "Beta Two",
        "Delta Four",
      ]);
      expect(first.next_pagination_key).toBeDefined();
      const second = await queue(provider, {
        limit: 3,
        pagination_key: first.next_pagination_key as string,
      });
      expect(second.items.map((item) => item.applicant_name)).toEqual([
        "Alpha One",
      ]);
      expect(second.next_pagination_key).toBeUndefined();
      await expectProblem(
        await provider.api.listWorkQueue(provider.owner, {
          limit: 3,
          status: "pending",
          pagination_key: first.next_pagination_key as string,
        }),
        400,
        work.paginationKey,
      );
      await expectProblem(
        await provider.api.listWorkQueue(provider.owner, {
          pagination_key: "not-a-key",
        }),
        400,
        work.paginationKey,
      );

      // A tenant that does not answer is named, and the rest is listed.
      const degraded = new OrgsAPI(request, "sgp", unavailableOrigin);
      const partial = await queue(provider, {}, degraded);
      expect(partial.unavailable_tenants).toContain("gone");
      expect(partial.unavailable_tenants).not.toContain("sgp");
      expect(partial.items).toHaveLength(4);
    },
    { tenants: { consumer: "sgp", provider: "sgp" } },
  );
});

test("a client tenant that cannot be reached is unavailable, and an uncertain command is pending", async ({
  request,
}) => {
  test.setTimeout(300_000);
  await withWorld(request, async (world) => {
    const { pair } = world;
    const { consumer, provider } = pair;
    const scene = await routedScene(
      world,
      "interviewing",
      "panel",
      "Ada Lovelace",
    );
    const reference = {
      engagement_id: scene.item.engagement_id,
      work_id: scene.item.work_id,
    };
    const numbered = { ...reference, interview_number: 1 };
    // Bodies are fixed, so a repeat of a key is the same request.
    const scheduleBody = { ...reference, ...interview(provider) };
    const changeBody = { ...numbered, ...interview(provider, 200) };
    const sends = [
      {
        name: "schedule",
        send: (key: string) =>
          provider.api.scheduleWorkInterview(provider.owner, scheduleBody, key),
      },
      {
        name: "change",
        send: (key: string) =>
          provider.api.changeWorkInterview(provider.owner, changeBody, key),
      },
      {
        name: "cancel",
        send: (key: string) =>
          provider.api.cancelWorkInterview(provider.owner, numbered, key),
      },
      {
        name: "outcome",
        send: (key: string) =>
          provider.api.recordWorkInterviewOutcome(
            provider.owner,
            { ...numbered, outcome: "completed" },
            key,
          ),
      },
      {
        name: "feedback",
        send: (key: string) =>
          provider.api.submitWorkInterviewFeedback(
            provider.owner,
            { ...numbered, recommendation: "yes", notes: "Good" },
            key,
          ),
      },
      {
        name: "assessment",
        send: (key: string) =>
          provider.api.recordWorkAssessment(
            provider.owner,
            { ...reference, outcome: "pass" },
            key,
          ),
      },
      {
        name: "check result",
        send: (key: string) =>
          provider.api.recordWorkBackgroundCheckResult(
            provider.owner,
            { ...reference, check_type: "identity", outcome: "clear" },
            key,
          ),
      },
    ].map((item) => ({ ...item, key: orgsIdempotencyKey() }));
    const did = orgDID(consumer.org.domain, consumer.tenant);
    try {
      // The route names a tenant that does not exist: nothing is sent, and
      // reads say the tenant did not answer rather than that work is missing.
      setOrgHome(did, "gone");
      for (const item of sends) {
        await expectProblem(
          await item.send(orgsIdempotencyKey()),
          503,
          problems.unavailable,
        );
      }
      await expectProblem(
        await provider.api.getWorkItem(provider.owner, reference),
        503,
        problems.unavailable,
      );
      // The route names a tenant that does not home the client: the command
      // was sent, so its outcome is unknown.
      setOrgHome(did, "usa1");
      for (const item of sends) {
        const pending = await item.send(item.key);
        expect(pending.status(), `${item.name}: ${await pending.text()}`).toBe(
          202,
        );
        expect(pending.headers()["cache-control"]).toBe("no-store");
      }
      // Once the client is reachable the same keys finish, each as the
      // client's tenant decides it.
      setOrgHome(did, consumer.tenant);
      const recovered = await sends[0]?.send(sends[0].key);
      expect(recovered?.status(), await recovered?.text()).toBe(200);
      for (const item of sends.slice(1)) {
        const finished = await item.send(item.key);
        expect([200, 404, 409, 422], `${item.name}`).toContain(
          finished.status(),
        );
      }
    } finally {
      setOrgHome(did, consumer.tenant);
    }
    // Work is readable again once the Org is reachable.
    expect((await detailAs(provider, scene.item)).interviews).toBeDefined();
  });
});

test("provider work routes authenticate, authorize, validate, and refuse suspended Orgs", async ({
  request,
}) => {
  test.setTimeout(300_000);
  await withWorld(request, async (world) => {
    const { pair } = world;
    const { provider, consumer } = pair;
    const scene = await routedScene(
      world,
      "interviewing",
      "panel",
      "Ada Lovelace",
    );
    const { item } = scene;
    const viewer = await addOrgMember(
      provider.api,
      provider.owner,
      provider.org.domain,
      inviteeAddress(provider.org.domain, "viewer"),
      ["org:view_openings"],
    );
    const worker = await addOrgMember(
      provider.api,
      provider.owner,
      provider.org.domain,
      inviteeAddress(provider.org.domain, "worker"),
      ["org:fulfil_engagements"],
    );
    const reference = {
      engagement_id: item.engagement_id,
      work_id: item.work_id,
    };
    const interviewReference = { ...reference, interview_number: 1 };
    const routes: Array<{ path: string; body: unknown; write: boolean }> = [
      { path: "/list-work-queue", body: {}, write: false },
      { path: "/get-work-item", body: reference, write: false },
      { path: "/list-jobs", body: {}, write: false },
      {
        path: "/get-job",
        body: { engagement_id: item.engagement_id, opening_number: 1 },
        write: false,
      },
      {
        path: "/schedule-work-interview",
        body: { ...reference, ...interview(provider) },
        write: true,
      },
      {
        path: "/change-work-interview",
        body: { ...interviewReference, ...interview(provider) },
        write: true,
      },
      { path: "/cancel-work-interview", body: interviewReference, write: true },
      {
        path: "/record-work-interview-outcome",
        body: { ...interviewReference, outcome: "completed" },
        write: true,
      },
      {
        path: "/submit-work-interview-feedback",
        body: { ...interviewReference, recommendation: "yes", notes: "ok" },
        write: true,
      },
      {
        path: "/record-work-assessment",
        body: { ...reference, outcome: "pass" },
        write: true,
      },
      {
        path: "/record-work-background-check-result",
        body: { ...reference, check_type: "identity", outcome: "clear" },
        write: true,
      },
    ];
    const keyed = (write: boolean) =>
      write ? { idempotencyKey: orgsIdempotencyKey() } : {};
    for (const entry of routes) {
      await expectProblem(
        await provider.api.post(entry.path, entry.body, keyed(entry.write)),
        401,
        problems.authentication,
      );
      await expectProblem(
        await provider.api.postRaw(entry.path, "{", {
          token: provider.owner,
          ...keyed(entry.write),
        }),
        400,
        problems.invalidJSON,
      );
      await expectProblem(
        await provider.api.post(entry.path, entry.body, {
          token: viewer.token,
          ...keyed(entry.write),
        }),
        403,
        problems.permission,
      );
      if (entry.write) {
        expect(
          (
            await provider.api.post(entry.path, entry.body, {
              token: provider.owner,
            })
          ).status(),
          `${entry.path} needs an Idempotency-Key`,
        ).toBe(400);
      }
    }
    for (const [path, bad] of [
      ["/list-work-queue", { limit: 0 }],
      ["/list-work-queue", { status: "done" }],
      ["/list-work-queue", { opening_number: 3 }],
      ["/list-jobs", { state: "unknown" }],
      ["/get-work-item", { ...reference, work_id: "x" }],
      ["/get-job", { engagement_id: item.engagement_id, opening_number: 0 }],
      [
        "/schedule-work-interview",
        { ...reference, ...interview(provider), duration_minutes: 5 },
      ],
      [
        "/schedule-work-interview",
        { ...reference, ...interview(provider), interviewer_emails: [] },
      ],
      [
        "/change-work-interview",
        { ...interviewReference, interview_number: 0, ...interview(provider) },
      ],
      ["/cancel-work-interview", { ...reference, interview_number: 0 }],
      [
        "/record-work-interview-outcome",
        { ...interviewReference, outcome: "late" },
      ],
      [
        "/submit-work-interview-feedback",
        { ...interviewReference, recommendation: "meh", notes: "ok" },
      ],
      ["/record-work-assessment", { ...reference, outcome: "pass", score: -1 }],
      [
        "/record-work-background-check-result",
        { ...reference, check_type: "x", outcome: "clear" },
      ],
    ] as const) {
      await expectProblem(
        await provider.api.marketplaceWriteRaw(path, provider.owner, bad),
        400,
        problems.validation,
      );
    }
    // Every write on work that is not the provider's is one answer, and a
    // key stays bound to the request it first carried.
    for (const entry of routes.filter((route) => route.write)) {
      const key = orgsIdempotencyKey();
      const made = { ...(entry.body as object), work_id: randomUUID() };
      await expectProblem(
        await provider.api.post(entry.path, made, {
          token: provider.owner,
          idempotencyKey: key,
        }),
        404,
        work.notFound,
      );
      const other = {
        "/schedule-work-interview": { duration_minutes: 60 },
        "/change-work-interview": { duration_minutes: 60 },
        "/cancel-work-interview": { interview_number: 2 },
        "/record-work-interview-outcome": { outcome: "no_show" },
        "/submit-work-interview-feedback": { notes: "Other" },
        "/record-work-assessment": { outcome: "fail" },
        "/record-work-background-check-result": { outcome: "discrepancy" },
      }[entry.path];
      await expectProblem(
        await provider.api.post(
          entry.path,
          { ...made, ...other },
          { token: provider.owner, idempotencyKey: key },
        ),
        409,
        problems.keyConflict,
      );
    }
    // A user with the permission may read the queue and schedule.
    expect(
      (await queue({ ...provider, owner: worker.token })).items,
    ).toHaveLength(1);
    const asWorker = await provider.api.scheduleWorkInterview(worker.token, {
      ...reference,
      ...interview(provider),
      interviewer_emails: [worker.emailAddress],
    });
    expect(asWorker.status(), await asWorker.text()).toBe(200);
    // Only an interviewer of the interview may give feedback on it.
    await expectProblem(
      await provider.api.submitWorkInterviewFeedback(provider.owner, {
        ...reference,
        interview_number: 1,
        recommendation: "yes",
        notes: "Not mine to give",
      }),
      403,
      problems.permission,
    );
    // Interviewers must hold the permission themselves.
    const viewerAsInterviewer = await provider.api.scheduleWorkInterview(
      worker.token,
      {
        ...reference,
        ...interview(provider, 400),
        interviewer_emails: [viewer.emailAddress],
      },
    );
    expect(viewerAsInterviewer.status()).toBe(422);
    expect(await viewerAsInterviewer.json()).toMatchObject({
      type: work.interviewers,
    });

    orgSQL(
      `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
       WHERE org_did = (SELECT org_did FROM vetchium.org_domains
         WHERE domain = '${provider.org.domain}')`,
      provider.tenant,
    );
    for (const entry of routes) {
      await expectProblem(
        await provider.api.post(entry.path, entry.body, {
          token: provider.owner,
          ...keyed(entry.write),
        }),
        403,
        problems.suspended,
      );
    }
    cleanupOutbox(consumer.org.domain);
  });
});

test("the mesh reads of provider work answer only the tenant that homes the provider", async ({
  request,
  apiCoverage,
}) => {
  test.setTimeout(300_000);
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer, provider } = pair;
    const scene = await routedScene(
      world,
      "interviewing",
      "panel",
      "Ada Lovelace",
    );
    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);
    await assign(world, sourcing.id);

    const providerDID = orgDID(provider.org.domain, provider.tenant);
    const homes = provider.tenant;
    const stranger = (["sgp", "usa1", "deu", "ind1"] as const).find(
      (tenant) => tenant !== homes && tenant !== consumer.tenant,
    );
    if (stranger === undefined) throw new Error("no stranger tenant");
    const workGet = {
      provider_org_did: providerDID,
      engagement_id: scene.item.engagement_id,
      work_id: scene.item.work_id,
    };
    const jobGet = {
      provider_org_did: providerDID,
      engagement_id: sourcing.id,
      opening_number: opening.opening_number,
    };
    const reads = [
      {
        name: "work list",
        path: "provider-work/list",
        body: { provider_org_did: providerDID, limit: 10 },
        bad: { provider_org_did: providerDID, limit: 0 },
        found: { items: [{ item: { work_id: scene.item.work_id } }] },
        empty: { items: [], has_more: false },
      },
      {
        name: "work get",
        path: "provider-work/get",
        body: workGet,
        bad: { ...workGet, work_id: "x" },
        found: { item: { work_id: scene.item.work_id } },
        missing: { ...workGet, work_id: randomUUID() },
      },
      {
        name: "jobs list",
        path: "provider-jobs/list",
        body: { provider_org_did: providerDID, state: "published", limit: 10 },
        bad: { provider_org_did: providerDID, state: "published", limit: 0 },
        found: { jobs: [{ job: { engagement_id: sourcing.id } }] },
        empty: { jobs: [], has_more: false },
      },
      {
        name: "jobs get",
        path: "provider-jobs/get",
        body: jobGet,
        bad: { ...jobGet, opening_number: 0 },
        found: { job: { engagement_id: sourcing.id } },
        missing: { ...jobGet, opening_number: opening.opening_number + 9 },
      },
    ];
    const relay = (
      path: string,
      request: unknown,
      options: { tenant?: string; authorization?: string | null } = {},
    ) =>
      meshRelayRequest(
        consumer.tenant,
        `/mesh/${path}`,
        { tenant: options.tenant ?? consumer.tenant, request },
        apiCoverage,
        options.authorization === undefined
          ? {}
          : { authorization: options.authorization },
      );
    const peer = (
      from: TestTenant,
      path: string,
      body: unknown,
      options: Parameters<typeof meshPeerRequest>[4] = {},
    ) =>
      meshPeerRequest(from, consumer.tenant, body, apiCoverage, {
        path: `/api/mesh/${path}`,
        ...options,
      });
    for (const read of reads) {
      const label = read.name;
      // The relay serves the local orgs-api: this tenant, or a named one.
      const found = relay(read.path, read.body);
      expect(found.status, `${label}: ${JSON.stringify(found.body)}`).toBe(200);
      expect(found.body, label).toMatchObject(read.found);
      expect(
        relay(read.path, read.body, { authorization: null }).status,
        label,
      ).toBe(401);
      expect(relay(read.path, read.bad).status, label).toBe(400);
      expect(
        meshRelayRequest(
          consumer.tenant,
          `/mesh/${read.path}`,
          {},
          apiCoverage,
          {
            rawBody: "{",
          },
        ).status,
        label,
      ).toBe(400);
      const unreachable = relay(read.path, read.body, { tenant: "gone" });
      expect(unreachable.status, label).toBe(503);
      expect(unreachable.body, label).toMatchObject({
        type: problems.unavailable,
      });
      if ("missing" in read) {
        const missing = relay(read.path, read.missing);
        expect(missing.status, label).toBe(404);
        expect(missing.body, label).toMatchObject({ type: work.notFound });
      }

      // The peer listener admits the tenant that homes the provider; any
      // other is told what a provider with nothing routed is told.
      const direct = peer(homes, read.path, read.body);
      expect(direct.status, `${label}: ${JSON.stringify(direct.body)}`).toBe(
        200,
      );
      expect(direct.body, label).toMatchObject(read.found);
      const refused = peer(stranger, read.path, read.body);
      if ("empty" in read) {
        expect(refused.status, label).toBe(200);
        expect(refused.body, label).toEqual(read.empty);
      } else {
        expect(refused.status, label).toBe(404);
        expect(refused.body, label).toMatchObject({ type: work.notFound });
        const absent = peer(homes, read.path, read.missing);
        expect(absent.status, label).toBe(404);
        expect(absent.body, label).toMatchObject({ type: work.notFound });
      }
      expect(peer(homes, read.path, read.bad).status, label).toBe(400);
      expect(peer(homes, read.path, {}, { rawBody: "{" }).status, label).toBe(
        400,
      );
      expect(
        meshPeerRequest(homes, consumer.tenant, read.body, [], {
          path: `/api/mesh/${read.path}`,
          withoutCertificate: true,
        }).status,
        label,
      ).toBe(0);
      expect(
        peer(homes, read.path, read.body, { certificate: "health" }).status,
        label,
      ).toBe(401);
      expect(JSON.stringify([found.body, direct.body]), label).not.toMatch(
        /org_did|application_number|email|session|credential|password/,
      );
    }
  });
});

test("the Hub names the provider that interviews and checks the applicant", async ({
  request,
}) => {
  test.setTimeout(300_000);
  const applicant = seedApplicant(request, "sgp");
  let cleanup: Array<{ tenant: TestTenant; did: string }> = [];
  try {
    await withWorld(
      request,
      async (world) => {
        const { pair, opening } = world;
        const { consumer, provider } = pair;
        cleanup = [
          {
            tenant: consumer.tenant,
            did: orgDID(consumer.org.domain, consumer.tenant),
          },
        ];
        {
          const reference = await apply(
            applicant,
            consumer.org.domain,
            opening.opening_number,
          );
          const number = reference.application_number;
          await shortlist(
            consumer.api,
            consumer.owner,
            opening.opening_number,
            number,
            world.panel,
          );
          const interviewing = await activate(pair, "interviewing");
          const checking = await activate(pair, "background_check");
          await asProvider(pair, interviewing.id, interviewing.version);
          await asProvider(pair, checking.id, checking.version);
          await assign(world, interviewing.id, world.panel);
          await assign(world, checking.id, world.check);
          await routed(
            world,
            await detailOf(
              consumer.api,
              consumer.owner,
              opening.opening_number,
              number,
            ),
            interviewing.id,
          );

          const item = await itemOf(provider, "Ada Applicant");
          const scheduled = await provider.api.scheduleWorkInterview(
            provider.owner,
            {
              engagement_id: item.engagement_id,
              work_id: item.work_id,
              ...interview(provider),
            },
          );
          expect(scheduled.status(), await scheduled.text()).toBe(200);
          const hubView = await myApplication(applicant, reference);
          expect(hubView.interviews).toMatchObject([
            { interview_number: 1, provider: { domain: provider.org.domain } },
          ]);

          // The applicant's consent is to the provider's own disclosure.
          const cancel = await provider.api.cancelWorkInterview(
            provider.owner,
            {
              engagement_id: item.engagement_id,
              work_id: item.work_id,
              interview_number: 1,
            },
          );
          expect(cancel.status(), await cancel.text()).toBe(200);
          const before = await detailOf(
            consumer.api,
            consumer.owner,
            opening.opening_number,
            number,
          );
          const moved = await consumer.api.moveApplicationStage(
            consumer.owner,
            {
              opening_number: opening.opening_number,
              application_number: number,
              version: before.version,
              stage_id: world.check.id,
            },
          );
          expect(moved.status(), await moved.text()).toBe(200);
          let current = (await moved.json()) as ApplicationDetail;
          current = await routed(world, current, checking.id);
          const requested = await consumer.api.requestBackgroundCheckConsent(
            consumer.owner,
            {
              opening_number: opening.opening_number,
              application_number: number,
              version: current.version,
              check_types: ["identity"],
            } as never,
          );
          expect(requested.status(), await requested.text()).toBe(200);
          const asked = await myApplication(applicant, reference);
          expect(asked.background_check_consent).toMatchObject({
            performer: "provider",
            provider: { domain: provider.org.domain },
            disclosure: "We verify what you tell us.",
          });
          const given =
            await applicant.hub.giveApplicationBackgroundCheckConsent(
              { ...reference, check_number: 1 },
              { token: applicant.token, idempotencyKey: hubIdempotencyKey() },
            );
          expect(given.status(), await given.text()).toBe(200);
          const checkItem = await itemOf(provider, "Ada Applicant");
          expect(checkItem.status).toBe("in_progress");
          const recorded = await provider.api.recordWorkBackgroundCheckResult(
            provider.owner,
            {
              engagement_id: checkItem.engagement_id,
              work_id: checkItem.work_id,
              check_type: "identity",
              outcome: "clear",
            },
          );
          expect(recorded.status(), await recorded.text()).toBe(200);
          expect(((await recorded.json()) as WriteResult).status).toBe(
            "completed",
          );
        }
      },
      { tenants: { consumer: "usa1", provider: "deu" } },
    );
  } finally {
    cleanupApplicant(applicant, cleanup);
  }
});
