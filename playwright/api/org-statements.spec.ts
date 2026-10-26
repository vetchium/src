import { randomUUID } from "node:crypto";
import type { GetActivityStatementResponse } from "typespec/orgs/marketplace/statements";
import type {
  ListWorkQueueResponse,
  WriteResult,
} from "typespec/orgs/marketplace/work/work";
import { expectProblem } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { seedApplication } from "../lib/hiring-seed.ts";
import { hubIdempotencyKey } from "../lib/hub-api.ts";
import { meshPeerRequest, meshRelayRequest } from "../lib/mesh.ts";
import {
  addOrgMember,
  inviteeAddress,
  orgDID,
  orgSQL,
  orgsIdempotencyKey,
} from "../lib/orgs-api.ts";
import { detailOf, utcDate } from "../lib/orgs-applications.ts";
import { activate, asProvider, setOrgHome } from "../lib/orgs-marketplace.ts";
import { assign, candidate, routed, withWorld } from "../lib/orgs-routing.ts";

const BASE = "vetchium-problem-details/";
const PROBLEMS = {
  notFound: `${BASE}org-engagement-not-found`,
  validation: `${BASE}validation-failed`,
  invalidPaginationKey: `${BASE}invalid-pagination-key`,
  meshPeerAuth: `${BASE}mesh-peer-authentication-required`,
  meshRelayAuth: `${BASE}mesh-relay-authentication-required`,
};

test("activity statements: sourcing facts, corrections, provider work facts, pagination, month boundaries, retention, and access", async ({
  request,
  apiCoverage,
}) => {
  test.setTimeout(240_000);
  await withWorld(request, async (world) => {
    const { pair, opening } = world;
    const { consumer, provider } = pair;

    const openingTitle = opening.live_content?.title ?? "Software Engineer";
    const currentMonth = new Date().toISOString().slice(0, 7);
    const today = new Date().toISOString().slice(0, 10);
    const joinDate = utcDate(-3);
    const fixedJoinDate = utcDate(-4);
    const separationDate = utcDate(-1);
    const fixedSeparationDate = utcDate(-2);

    // =========================================================================
    // 1. SOURCING ENGAGEMENT: joined, separated, and corrections (MKT-STM-001, HP-STA-005)
    // =========================================================================
    const sourcing = await activate(pair, "sourcing");
    await asProvider(pair, sourcing.id, sourcing.version);
    await assign(world, sourcing.id);

    {
      // The applicant names the agency and accepts an offer extended 10
      // days ago, so the joining date may lie in the past.
      const seeded = await seedApplication(
        world.hiring,
        opening.opening_number,
        {
          state: "offer_accepted",
          stageId: world.final.id,
          referralAgencyDomain: provider.org.domain,
          offerExtendedDaysAgo: 10,
        },
      );
      const ref1 = { application_number: seeded.number };
      const v = (k: number) => seeded.version + k - 1;

      // Record joined
      const joinedRes = await consumer.api.recordApplicationJoined(
        consumer.owner,
        {
          opening_number: opening.opening_number,
          application_number: ref1.application_number,
          version: v(1),
          joined_on: joinDate,
        },
        orgsIdempotencyKey(),
      );
      expect(joinedRes.status(), await joinedRes.text()).toBe(200);

      // Both sides read statement: joined fact appears with corrected: false (MKT-STM-002, MKT-STM-003)
      const consumerStmt1Res = await consumer.api.getEngagementStatement(
        consumer.owner,
        {
          engagement_id: sourcing.id,
          month: currentMonth,
        },
      );
      expect(consumerStmt1Res.status(), await consumerStmt1Res.text()).toBe(
        200,
      );
      expect(consumerStmt1Res.headers()["cache-control"]).toBe("no-store");
      const consumerStmt1 =
        (await consumerStmt1Res.json()) as GetActivityStatementResponse;

      const providerStmt1Res = await provider.api.getClientEngagementStatement(
        provider.owner,
        {
          engagement_id: sourcing.id,
          month: currentMonth,
        },
      );
      expect(providerStmt1Res.status(), await providerStmt1Res.text()).toBe(
        200,
      );
      expect(providerStmt1Res.headers()["cache-control"]).toBe("no-store");
      const providerStmt1 =
        (await providerStmt1Res.json()) as GetActivityStatementResponse;

      expect(consumerStmt1.items).toHaveLength(1);
      expect(consumerStmt1.items[0]).toMatchObject({
        fact: "joined",
        date: joinDate,
        opening_number: opening.opening_number,
        opening_title: openingTitle,
        application_number: ref1.application_number,
        applicant_display_name: "Ada Applicant",
        corrected: false,
      });
      // Both sides read the exact same statement items
      expect(providerStmt1.items).toEqual(consumerStmt1.items);

      // Correct joined_on: fact marked corrected: true
      const correctJoinRes = await consumer.api.correctApplicationJoinedOn(
        consumer.owner,
        {
          opening_number: opening.opening_number,
          application_number: ref1.application_number,
          version: v(2),
          joined_on: fixedJoinDate,
        },
        orgsIdempotencyKey(),
      );
      expect(correctJoinRes.status(), await correctJoinRes.text()).toBe(200);

      const consumerStmt2Res = await consumer.api.getEngagementStatement(
        consumer.owner,
        {
          engagement_id: sourcing.id,
          month: currentMonth,
        },
      );
      const consumerStmt2 =
        (await consumerStmt2Res.json()) as GetActivityStatementResponse;
      expect(consumerStmt2.items).toHaveLength(1);
      expect(consumerStmt2.items[0]).toMatchObject({
        fact: "joined",
        date: fixedJoinDate,
        corrected: true,
      });

      const providerStmt2Res = await provider.api.getClientEngagementStatement(
        provider.owner,
        {
          engagement_id: sourcing.id,
          month: currentMonth,
        },
      );
      const providerStmt2 =
        (await providerStmt2Res.json()) as GetActivityStatementResponse;
      expect(providerStmt2.items).toEqual(consumerStmt2.items);

      // Record separated
      const sepRes = await consumer.api.recordApplicationSeparated(
        consumer.owner,
        {
          opening_number: opening.opening_number,
          application_number: ref1.application_number,
          version: v(3),
          separated_on: separationDate,
        },
        orgsIdempotencyKey(),
      );
      expect(sepRes.status(), await sepRes.text()).toBe(200);

      const consumerStmt3Res = await consumer.api.getEngagementStatement(
        consumer.owner,
        {
          engagement_id: sourcing.id,
          month: currentMonth,
        },
      );
      const consumerStmt3 =
        (await consumerStmt3Res.json()) as GetActivityStatementResponse;
      expect(consumerStmt3.items).toHaveLength(2);
      const sepFact = consumerStmt3.items.find((i) => i.fact === "separated");
      expect(sepFact).toBeDefined();
      expect(sepFact).toMatchObject({
        fact: "separated",
        date: separationDate,
        corrected: false,
      });

      // Correct separated_on: marked corrected: true
      const correctSepRes = await consumer.api.correctApplicationSeparatedOn(
        consumer.owner,
        {
          opening_number: opening.opening_number,
          application_number: ref1.application_number,
          version: v(4),
          separated_on: fixedSeparationDate,
        },
        orgsIdempotencyKey(),
      );
      expect(correctSepRes.status(), await correctSepRes.text()).toBe(200);

      const consumerStmt4Res = await consumer.api.getEngagementStatement(
        consumer.owner,
        {
          engagement_id: sourcing.id,
          month: currentMonth,
        },
      );
      const consumerStmt4 =
        (await consumerStmt4Res.json()) as GetActivityStatementResponse;
      expect(consumerStmt4.items).toHaveLength(2);
      const fixedSepFact = consumerStmt4.items.find(
        (i) => i.fact === "separated",
      );
      expect(fixedSepFact).toMatchObject({
        fact: "separated",
        date: fixedSeparationDate,
        corrected: true,
      });

      const providerStmt4Res = await provider.api.getClientEngagementStatement(
        provider.owner,
        {
          engagement_id: sourcing.id,
          month: currentMonth,
        },
      );
      const providerStmt4 =
        (await providerStmt4Res.json()) as GetActivityStatementResponse;
      expect(providerStmt4.items).toEqual(consumerStmt4.items);

      // No field carries money (MKT-STM-002). Field names, not values: an
      // identifier may happen to spell one of the words.
      const fieldNames = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.flatMap(fieldNames)
          : typeof value === "object" && value !== null
            ? Object.entries(value).flatMap(([key, inner]) => [
                key,
                ...fieldNames(inner),
              ])
            : [];
      for (const body of [consumerStmt4, providerStmt4]) {
        expect(
          fieldNames(body).filter((name) =>
            /amount|price|currency|fee|invoice/.test(name),
          ),
        ).toEqual([]);
      }

      // =======================================================================
      // 2. RETENTION: facts outlive applicant retention with numbers only (MKT-STM-004)
      // =======================================================================
      // Retention runs 365 days after joined_on (HP-RET-001): move the
      // application's dates back past it and let the job remove it.
      orgSQL(
        `UPDATE vetchium.org_applications AS a
         SET created_at = a.created_at - interval '400 days',
           offer_extended_at = a.offer_extended_at - interval '400 days',
           joined_on = a.joined_on - 400,
           separated_on = a.separated_on - 400
         FROM vetchium.org_openings AS o
         WHERE o.org_opening_id = a.org_opening_id
           AND o.org_did = '${orgDID(consumer.org.domain)}'::uuid
           AND o.opening_number = ${opening.opening_number}
           AND a.application_number = ${ref1.application_number}`,
        consumer.tenant,
      );
      await expect
        .poll(
          async () =>
            (
              await detailOf(
                consumer.api,
                consumer.owner,
                opening.opening_number,
                ref1.application_number,
              )
            ).removed,
          { timeout: 30_000 },
        )
        .toBe(true);

      const retainedStmtRes = await consumer.api.getEngagementStatement(
        consumer.owner,
        {
          engagement_id: sourcing.id,
          month: currentMonth,
        },
      );
      const retainedStmt =
        (await retainedStmtRes.json()) as GetActivityStatementResponse;
      expect(retainedStmt.items).toHaveLength(2);
      for (const item of retainedStmt.items) {
        expect(item.application_number).toBe(ref1.application_number);
        expect(item.opening_number).toBe(opening.opening_number);
        expect(item.opening_title).toBe(openingTitle);
        // Display name wiped to empty string
        expect(item.applicant_display_name).toBe("");
      }

      const retainedProviderRes =
        await provider.api.getClientEngagementStatement(provider.owner, {
          engagement_id: sourcing.id,
          month: currentMonth,
        });
      const retainedProviderStmt =
        (await retainedProviderRes.json()) as GetActivityStatementResponse;
      expect(retainedProviderStmt.items).toEqual(retainedStmt.items);
    }

    // =========================================================================
    // 3. PROVIDER WORK ENGAGEMENTS: interview, assessment, background check (MKT-STM-001)
    // =========================================================================

    // --- Interviewing engagement ---
    const interviewing = await activate(pair, "interviewing");
    await asProvider(pair, interviewing.id, interviewing.version);
    await assign(world, interviewing.id, world.panel);

    const cand1 = await candidate(world, world.panel, "Ada Lovelace");
    await routed(world, cand1, interviewing.id);

    const queueRes1 = await provider.api.listWorkQueue(provider.owner, {});
    const queueData1 = (await queueRes1.json()) as ListWorkQueueResponse;
    const workItem1 = queueData1.items.find(
      (i) => i.engagement_id === interviewing.id,
    );
    expect(workItem1).toBeDefined();
    if (workItem1 === undefined) {
      throw new Error("workItem1 not found");
    }

    const scheduleRes = await provider.api.scheduleWorkInterview(
      provider.owner,
      {
        engagement_id: interviewing.id,
        work_id: workItem1.work_id,
        start_time: new Date(Date.now() + 3600_000).toISOString(),
        duration_minutes: 45,
        mode: "video",
        video_url: "https://meet.example.test/panel",
        interviewer_emails: [provider.org.emailAddress],
      },
    );
    expect(scheduleRes.status(), await scheduleRes.text()).toBe(200);
    const scheduleData = (await scheduleRes.json()) as WriteResult;
    const interviewNumber1 = scheduleData.interview_number ?? 1;

    // Move start time to past so outcome can be recorded
    orgSQL(
      `UPDATE vetchium.org_interviews SET starts_at = now() - interval '1 hour'
       WHERE performer_engagement_id = '${interviewing.id}'`,
      consumer.tenant,
    );

    // Record interview outcome: completed
    const outcomeRes = await provider.api.recordWorkInterviewOutcome(
      provider.owner,
      {
        engagement_id: interviewing.id,
        work_id: workItem1.work_id,
        interview_number: interviewNumber1,
        outcome: "completed",
      },
    );
    expect(outcomeRes.status(), await outcomeRes.text()).toBe(200);

    // Verify interview_completed fact recorded and visible to both sides
    const intConsumerStmtRes = await consumer.api.getEngagementStatement(
      consumer.owner,
      {
        engagement_id: interviewing.id,
        month: currentMonth,
      },
    );
    const intConsumerStmt =
      (await intConsumerStmtRes.json()) as GetActivityStatementResponse;
    expect(intConsumerStmt.items).toHaveLength(1);
    expect(intConsumerStmt.items[0]).toMatchObject({
      fact: "interview_completed",
      date: today,
      opening_number: opening.opening_number,
      application_number: cand1.application_number,
      corrected: false,
    });

    const intProviderStmtRes = await provider.api.getClientEngagementStatement(
      provider.owner,
      {
        engagement_id: interviewing.id,
        month: currentMonth,
      },
    );
    const intProviderStmt =
      (await intProviderStmtRes.json()) as GetActivityStatementResponse;
    expect(intProviderStmt.items).toEqual(intConsumerStmt.items);

    // Schedule second interview and record no-show
    const scheduleRes2 = await provider.api.scheduleWorkInterview(
      provider.owner,
      {
        engagement_id: interviewing.id,
        work_id: workItem1.work_id,
        start_time: new Date(Date.now() + 7200_000).toISOString(),
        duration_minutes: 30,
        mode: "video",
        video_url: "https://meet.example.test/panel-2",
        interviewer_emails: [provider.org.emailAddress],
      },
    );
    const scheduleData2 = (await scheduleRes2.json()) as WriteResult;
    const interviewNumber2 = scheduleData2.interview_number ?? 2;
    orgSQL(
      `UPDATE vetchium.org_interviews SET starts_at = now() - interval '30 minutes'
       WHERE performer_engagement_id = '${interviewing.id}' AND interview_number = ${interviewNumber2}`,
      consumer.tenant,
    );

    const noShowRes = await provider.api.recordWorkInterviewOutcome(
      provider.owner,
      {
        engagement_id: interviewing.id,
        work_id: workItem1.work_id,
        interview_number: interviewNumber2,
        outcome: "no_show",
      },
    );
    expect(noShowRes.status(), await noShowRes.text()).toBe(200);

    const intConsumerStmt2Res = await consumer.api.getEngagementStatement(
      consumer.owner,
      {
        engagement_id: interviewing.id,
        month: currentMonth,
      },
    );
    const intConsumerStmt2 =
      (await intConsumerStmt2Res.json()) as GetActivityStatementResponse;
    expect(intConsumerStmt2.items).toHaveLength(2);
    expect(
      intConsumerStmt2.items.some((i) => i.fact === "interview_no_show"),
    ).toBe(true);

    // --- Assessment engagement ---
    const assessment = await activate(pair, "assessment");
    await asProvider(pair, assessment.id, assessment.version);
    await assign(world, assessment.id, world.assess);

    const cand2 = await candidate(world, world.assess, "Charles Babbage");
    await routed(world, cand2, assessment.id);

    const queueRes2 = await provider.api.listWorkQueue(provider.owner, {});
    const queueData2 = (await queueRes2.json()) as ListWorkQueueResponse;
    const workItem2 = queueData2.items.find(
      (i) => i.engagement_id === assessment.id,
    );
    expect(workItem2).toBeDefined();
    if (workItem2 === undefined) {
      throw new Error("workItem2 not found");
    }

    const assessRes = await provider.api.recordWorkAssessment(provider.owner, {
      engagement_id: assessment.id,
      work_id: workItem2.work_id,
      outcome: "pass",
      score: 92,
      notes: "Excellent candidate",
    });
    expect(assessRes.status(), await assessRes.text()).toBe(200);

    const assessConsumerStmtRes = await consumer.api.getEngagementStatement(
      consumer.owner,
      {
        engagement_id: assessment.id,
        month: currentMonth,
      },
    );
    const assessConsumerStmt =
      (await assessConsumerStmtRes.json()) as GetActivityStatementResponse;
    expect(assessConsumerStmt.items).toHaveLength(1);
    expect(assessConsumerStmt.items[0]).toMatchObject({
      fact: "assessment_result",
      date: today,
      opening_number: opening.opening_number,
      application_number: cand2.application_number,
      corrected: false,
    });

    const assessProviderStmtRes =
      await provider.api.getClientEngagementStatement(provider.owner, {
        engagement_id: assessment.id,
        month: currentMonth,
      });
    const assessProviderStmt =
      (await assessProviderStmtRes.json()) as GetActivityStatementResponse;
    expect(assessProviderStmt.items).toEqual(assessConsumerStmt.items);

    // --- Background check engagement ---
    const bgCheck = await activate(pair, "background_check");
    await asProvider(pair, bgCheck.id, bgCheck.version);
    await assign(world, bgCheck.id, world.check);

    const cand3 = await candidate(world, world.check, "Grace Hopper");
    const routedCand3 = await routed(world, cand3, bgCheck.id);

    // Request consent for background check
    const consentRes = await consumer.api.requestBackgroundCheckConsent(
      consumer.owner,
      {
        opening_number: opening.opening_number,
        application_number: cand3.application_number,
        version: routedCand3.version,
        check_types: ["identity", "education"],
      },
    );
    expect(consentRes.status(), await consentRes.text()).toBe(200);

    const queueRes3 = await provider.api.listWorkQueue(provider.owner, {});
    const queueData3 = (await queueRes3.json()) as ListWorkQueueResponse;
    const workItem3 = queueData3.items.find(
      (i) => i.engagement_id === bgCheck.id,
    );
    expect(workItem3).toBeDefined();
    if (workItem3 === undefined) {
      throw new Error("workItem3 not found");
    }

    // The applicant gives consent through the Hub.
    const checked = world.hiring.applicants.at(-1);
    if (checked === undefined) throw new Error("no applicant was seeded");
    const consented = await checked.hub.giveApplicationBackgroundCheckConsent(
      {
        domain: consumer.org.domain,
        opening_number: opening.opening_number,
        application_number: cand3.application_number,
        check_number: 1,
      },
      { token: checked.token, idempotencyKey: hubIdempotencyKey() },
    );
    expect(consented.status(), await consented.text()).toBe(200);

    // Provider records two check outcomes
    const bg1 = await provider.api.recordWorkBackgroundCheckResult(
      provider.owner,
      {
        engagement_id: bgCheck.id,
        work_id: workItem3.work_id,
        check_type: "identity",
        outcome: "clear",
        notes: "Identity verified",
      },
    );
    expect(bg1.status(), await bg1.text()).toBe(200);

    const bg2 = await provider.api.recordWorkBackgroundCheckResult(
      provider.owner,
      {
        engagement_id: bgCheck.id,
        work_id: workItem3.work_id,
        check_type: "education",
        outcome: "clear",
        notes: "Degree confirmed",
      },
    );
    expect(bg2.status(), await bg2.text()).toBe(200);

    const bgConsumerStmtRes = await consumer.api.getEngagementStatement(
      consumer.owner,
      {
        engagement_id: bgCheck.id,
        month: currentMonth,
      },
    );
    const bgConsumerStmt =
      (await bgConsumerStmtRes.json()) as GetActivityStatementResponse;
    expect(bgConsumerStmt.items).toHaveLength(2);
    expect(
      bgConsumerStmt.items.every((i) => i.fact === "background_check_outcome"),
    ).toBe(true);

    const bgProviderStmtRes = await provider.api.getClientEngagementStatement(
      provider.owner,
      {
        engagement_id: bgCheck.id,
        month: currentMonth,
      },
    );
    const bgProviderStmt =
      (await bgProviderStmtRes.json()) as GetActivityStatementResponse;
    expect(bgProviderStmt.items).toEqual(bgConsumerStmt.items);

    // =========================================================================
    // 4. MONTH BOUNDARIES & PAGINATION (MKT-STM-002, MKT-STM-003)
    // =========================================================================

    // Pagination test on background check (2 items in current month, page with limit 1)
    const page1Res = await consumer.api.getEngagementStatement(consumer.owner, {
      engagement_id: bgCheck.id,
      month: currentMonth,
      limit: 1,
    });
    expect(page1Res.status()).toBe(200);
    const page1 = (await page1Res.json()) as GetActivityStatementResponse;
    expect(page1.items).toHaveLength(1);
    expect(page1.next_pagination_key).toBeDefined();

    const page2Res = await consumer.api.getEngagementStatement(consumer.owner, {
      engagement_id: bgCheck.id,
      month: currentMonth,
      ...(page1.next_pagination_key
        ? { pagination_key: page1.next_pagination_key }
        : {}),
      limit: 1,
    });
    expect(page2Res.status()).toBe(200);
    const page2 = (await page2Res.json()) as GetActivityStatementResponse;
    expect(page2.items).toHaveLength(1);
    expect(page2.next_pagination_key).toBeUndefined();

    // Verify pagination items match unpaginated items
    expect([...page1.items, ...page2.items]).toEqual(bgConsumerStmt.items);

    // Provider pages identically
    const providerPage1Res = await provider.api.getClientEngagementStatement(
      provider.owner,
      {
        engagement_id: bgCheck.id,
        month: currentMonth,
        limit: 1,
      },
    );
    const providerPage1 =
      (await providerPage1Res.json()) as GetActivityStatementResponse;
    expect(providerPage1.items).toEqual(page1.items);

    // An outcome dated in another month stays out of this one.
    orgSQL(
      `UPDATE vetchium.org_activity_facts SET fact_date = '2025-01-15'
       WHERE engagement_id = '${bgCheck.id}'::uuid
         AND reference_id = 'education'`,
      consumer.tenant,
    );

    // Current month query does not include 2025-01 fact
    const bgCurrentMonthRes = await consumer.api.getEngagementStatement(
      consumer.owner,
      {
        engagement_id: bgCheck.id,
        month: currentMonth,
      },
    );
    const bgCurrentMonth =
      (await bgCurrentMonthRes.json()) as GetActivityStatementResponse;
    expect(bgCurrentMonth.items).toHaveLength(1);
    expect(
      bgCurrentMonth.items.every((i) => i.date.startsWith(currentMonth)),
    ).toBe(true);

    // 2025-01 query includes only the 2025-01 fact
    const bgPastMonthRes = await consumer.api.getEngagementStatement(
      consumer.owner,
      {
        engagement_id: bgCheck.id,
        month: "2025-01",
      },
    );
    const bgPastMonth =
      (await bgPastMonthRes.json()) as GetActivityStatementResponse;
    expect(bgPastMonth.items).toHaveLength(1);
    expect(bgPastMonth.items[0]?.date).toBe("2025-01-15");

    // Provider sees same month filtering
    const bgProviderPastMonthRes =
      await provider.api.getClientEngagementStatement(provider.owner, {
        engagement_id: bgCheck.id,
        month: "2025-01",
      });
    const bgProviderPastMonth =
      (await bgProviderPastMonthRes.json()) as GetActivityStatementResponse;
    expect(bgProviderPastMonth.items).toEqual(bgPastMonth.items);

    // Tampered pagination key
    const tamperedKeyRes = await consumer.api.getEngagementStatement(
      consumer.owner,
      {
        engagement_id: bgCheck.id,
        month: currentMonth,
        pagination_key: "dGFtcGVyZWRfa2V5",
      },
    );
    await expectProblem(tamperedKeyRes, 400, PROBLEMS.invalidPaginationKey);

    // Invalid month format
    const invalidMonthRes = await consumer.api.getEngagementStatement(
      consumer.owner,
      {
        engagement_id: bgCheck.id,
        month: "2026-13",
      },
    );
    await expectProblem(invalidMonthRes, 400, PROBLEMS.validation);

    // =========================================================================
    // 5. AUTHORIZATION & MESH SECURITY (MKT-AUTH-001, FED-SEC-001)
    // =========================================================================

    // Non-existent engagement
    const unknownEngagement = "00000000-0000-0000-0000-000000000001";
    const unknownConsumerRes = await consumer.api.getEngagementStatement(
      consumer.owner,
      {
        engagement_id: unknownEngagement,
        month: currentMonth,
      },
    );
    await expectProblem(unknownConsumerRes, 404, PROBLEMS.notFound);

    const unknownProviderRes = await provider.api.getClientEngagementStatement(
      provider.owner,
      {
        engagement_id: unknownEngagement,
        month: currentMonth,
      },
    );
    await expectProblem(unknownProviderRes, 404, PROBLEMS.notFound);

    // Both reads need a session and their permission.
    const read = { engagement_id: bgCheck.id, month: currentMonth };
    for (const [side, path] of [
      [consumer, "/get-engagement-statement"],
      [provider, "/get-client-engagement-statement"],
    ] as const) {
      await expectProblem(
        await side.api.post(path, read),
        401,
        `${BASE}org-authentication-required`,
      );
      const plain = await addOrgMember(
        side.api,
        side.owner,
        side.org.domain,
        inviteeAddress(side.org.domain, "plain"),
        [],
      );
      await expectProblem(
        await side.api.post(path, read, { token: plain.token }),
        403,
        `${BASE}org-permission-required`,
      );
    }
    await expectProblem(
      await provider.api.getClientEngagementStatement(provider.owner, {
        ...read,
        month: "2026-13",
      }),
      400,
      PROBLEMS.validation,
    );
    // The client's tenant answers the provider's read; when it cannot, the
    // read is unavailable.
    const consumerDID = orgDID(consumer.org.domain, consumer.tenant);
    setOrgHome(consumerDID, "gone");
    try {
      await expectProblem(
        await provider.api.getClientEngagementStatement(provider.owner, read),
        503,
        `${BASE}org-tenant-unavailable`,
      );
    } finally {
      setOrgHome(consumerDID, consumer.tenant);
    }

    const providerDID = orgDID(provider.org.domain, provider.tenant);

    // Mesh relay endpoint succeeds with valid auth
    const relayRes = meshRelayRequest(
      provider.tenant,
      "/mesh/provider-statements/get",
      {
        tenant: consumer.tenant,
        request: {
          provider_org_did: providerDID,
          engagement_id: bgCheck.id,
          month: currentMonth,
          limit: 10,
        },
      },
      apiCoverage,
    );
    expect(relayRes.status, JSON.stringify(relayRes.body)).toBe(200);

    // Direct mesh peer call with valid mTLS certificate
    const peerRes = meshPeerRequest(
      provider.tenant,
      consumer.tenant,
      {
        provider_org_did: providerDID,
        engagement_id: bgCheck.id,
        month: currentMonth,
        limit: 10,
      },
      apiCoverage,
      { path: "/api/mesh/provider-statements/get" },
    );
    expect(peerRes.status, JSON.stringify(peerRes.body)).toBe(200);

    // Direct mesh peer call without tenant certificate fails authentication
    const unauthPeerRes = meshPeerRequest(
      provider.tenant,
      consumer.tenant,
      {
        provider_org_did: providerDID,
        engagement_id: bgCheck.id,
        month: currentMonth,
        limit: 10,
      },
      apiCoverage,
      {
        path: "/api/mesh/provider-statements/get",
        certificate: "health",
      },
    );
    expect(unauthPeerRes.status).toBe(401);

    const statement = {
      provider_org_did: providerDID,
      engagement_id: bgCheck.id,
      month: currentMonth,
      limit: 10,
    };
    const expectType = (
      response: { status: number; body: unknown },
      status: number,
      type: string,
    ) => {
      expect(response.status, JSON.stringify(response.body)).toBe(status);
      expect(response.body).toMatchObject({ type, status });
    };
    const statements = "/mesh/provider-statements/get";
    const peerPath = { path: "/api/mesh/provider-statements/get" };
    expectType(
      meshRelayRequest(
        provider.tenant,
        statements,
        {
          tenant: consumer.tenant,
          request: { ...statement, month: "2026-13" },
        },
        apiCoverage,
      ),
      400,
      PROBLEMS.validation,
    );
    expectType(
      meshPeerRequest(
        provider.tenant,
        consumer.tenant,
        { ...statement, month: "2026-13" },
        apiCoverage,
        peerPath,
      ),
      400,
      PROBLEMS.validation,
    );
    // An engagement the provider is not party to is not found.
    for (const response of [
      meshRelayRequest(
        provider.tenant,
        statements,
        {
          tenant: consumer.tenant,
          request: { ...statement, engagement_id: randomUUID() },
        },
        apiCoverage,
      ),
      meshPeerRequest(
        provider.tenant,
        consumer.tenant,
        { ...statement, engagement_id: randomUUID() },
        apiCoverage,
        peerPath,
      ),
    ]) {
      expect(response.status, JSON.stringify(response.body)).toBe(404);
    }
    expectType(
      meshRelayRequest(
        provider.tenant,
        statements,
        { tenant: "gone", request: statement },
        apiCoverage,
      ),
      503,
      `${BASE}org-tenant-unavailable`,
    );

    // Direct mesh relay call without authorization fails
    const unauthRelayRes = meshRelayRequest(
      provider.tenant,
      "/mesh/provider-statements/get",
      {
        tenant: consumer.tenant,
        request: {
          provider_org_did: providerDID,
          engagement_id: bgCheck.id,
          month: currentMonth,
          limit: 10,
        },
      },
      apiCoverage,
      { authorization: null },
    );
    expect(unauthRelayRes.status).toBe(401);
  });
});
