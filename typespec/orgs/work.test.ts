import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeWorkActor,
  normalizeWorkScheduleInterviewPayload,
  validateWorkAssessmentPayload,
  validateWorkBackgroundCheckResultPayload,
  validateWorkInterviewOutcomePayload,
  validateWorkInterviewReferencePayload,
  validateWorkScheduleInterviewPayload,
} from "../federation/marketplace.ts";
import {
  validatePeerListWorkRequest,
  validateRelayListWorkRequest,
} from "./marketplace/work/federation.ts";
import {
  isWorkID,
  isWorkStatus,
  maxPage,
  normalizeListJobsRequest,
  normalizeListWorkQueueRequest,
  normalizeScheduleInterviewRequest,
  validateInterviewReference,
  validateJobReference,
  validateListJobsRequest,
  validateListWorkQueueRequest,
  validateRecordAssessmentRequest,
  validateRecordBackgroundCheckResultRequest,
  validateRecordInterviewOutcomeRequest,
  validateScheduleInterviewRequest,
  validateSubmitInterviewFeedbackRequest,
  workStatusValues,
} from "./marketplace/work/work.ts";

const engagement_id = "01900000-0000-7000-8000-000000000001";
const work_id = "01900000-0000-7000-8000-0000000000aa";
const provider_org_did = "01900000-0000-7000-8000-000000000002";
const details = () => ({
  start_time: new Date(Date.now() + 3_600_000).toISOString(),
  duration_minutes: 45,
  mode: "video" as const,
  video_url: "https://meet.example.test/x",
  interviewer_emails: ["a@acme.test"],
});

test("work statuses and ids are the contract's", () => {
  assert.deepEqual(
    [...workStatusValues],
    ["pending", "scheduled", "awaiting_consent", "in_progress", "completed"],
  );
  assert.equal(isWorkStatus("completed"), true);
  assert.equal(isWorkStatus("done"), false);
  assert.equal(isWorkID(work_id), true);
  assert.equal(isWorkID(work_id.toUpperCase()), false);
  assert.equal(maxPage, 50);
});

test("the work queue request normalizes filters and validates them", () => {
  const request = normalizeListWorkQueueRequest({
    client_domain: " ACME.test ",
    stage_name: " Panel ",
  });
  assert.equal(request.client_domain, "acme.test");
  assert.equal(request.stage_name, "Panel");
  assert.deepEqual(validateListWorkQueueRequest(request), []);
  assert.deepEqual(validateListWorkQueueRequest({ opening_number: 1 }), [
    "opening_number",
  ]);
  assert.deepEqual(
    validateListWorkQueueRequest({ client_domain: "x", limit: 0 }),
    ["client_domain", "limit"],
  );
  assert.deepEqual(
    normalizeListJobsRequest({ client_domain: "ACME.test" }).client_domain,
    "acme.test",
  );
  assert.deepEqual(validateListJobsRequest({}), []);
  assert.deepEqual(validateListJobsRequest({ state: "open" as never }), [
    "state",
  ]);
  assert.deepEqual(validateJobReference({ engagement_id, opening_number: 0 }), [
    "opening_number",
  ]);
});

test("work writes check their own fields and borrow nothing of the client's records", () => {
  const schedule = { engagement_id, work_id, ...details() };
  assert.deepEqual(validateScheduleInterviewRequest(schedule), []);
  const bad = validateScheduleInterviewRequest({
    ...schedule,
    work_id: "x",
    interviewer_emails: [],
  });
  assert.ok(bad.includes("work_id") && bad.includes("interviewer_emails"));
  for (const field of ["opening_number", "application_number", "version"]) {
    assert.equal(bad.includes(field), false);
  }
  const normalized = normalizeScheduleInterviewRequest(schedule);
  assert.equal("opening_number" in normalized, false);
  assert.equal("version" in normalized, false);
  assert.deepEqual(
    validateInterviewReference({ engagement_id, work_id, interview_number: 0 }),
    ["interview_number"],
  );
  assert.deepEqual(
    validateRecordInterviewOutcomeRequest({
      engagement_id,
      work_id,
      interview_number: 1,
      outcome: "late" as never,
    }),
    ["outcome"],
  );
  assert.deepEqual(
    validateSubmitInterviewFeedbackRequest({
      engagement_id,
      work_id,
      interview_number: 1,
      recommendation: "meh" as never,
      notes: "ok",
    }),
    ["recommendation"],
  );
  assert.deepEqual(
    validateRecordAssessmentRequest({
      engagement_id,
      work_id,
      outcome: "pass",
      score: 101,
    }),
    ["score"],
  );
  assert.deepEqual(
    validateRecordBackgroundCheckResultRequest({
      engagement_id,
      work_id,
      check_type: "x" as never,
      outcome: "clear",
    }),
    ["check_type"],
  );
});

test("peer reads name the provider and bound their pages", () => {
  assert.deepEqual(
    validatePeerListWorkRequest({ provider_org_did, limit: 10 }),
    [],
  );
  assert.deepEqual(
    validatePeerListWorkRequest({ provider_org_did: "x", limit: 0 }),
    ["provider_org_did", "limit"],
  );
  assert.deepEqual(
    validatePeerListWorkRequest({
      provider_org_did,
      limit: 10,
      after: { bucket: 2, sort: 1, work_id },
    }),
    ["after"],
  );
  assert.deepEqual(
    validateRelayListWorkRequest({
      tenant: "Bad",
      request: { provider_org_did, limit: 10 },
    }),
    ["tenant"],
  );
});

test("work command payloads validate the actor and the write", () => {
  const actor = normalizeWorkActor({
    engagement_id,
    work_id,
    provider_org_did,
    actor_email: " Ada@Acme.Test ",
  });
  assert.equal(actor.actor_email, "ada@acme.test");
  assert.deepEqual(
    validateWorkInterviewReferencePayload({ ...actor, interview_number: 1 }),
    [],
  );
  assert.deepEqual(
    validateWorkInterviewReferencePayload({
      engagement_id: "",
      work_id: "",
      provider_org_did: "",
      actor_email: "",
      interview_number: 1,
    }),
    ["engagement_id", "work_id", "provider_org_did", "actor_email"],
  );
  const schedule = normalizeWorkScheduleInterviewPayload({
    ...actor,
    ...details(),
  });
  assert.deepEqual(validateWorkScheduleInterviewPayload(schedule), []);
  assert.deepEqual(
    validateWorkInterviewReferencePayload({ ...actor, interview_number: 0 }),
    ["interview_number"],
  );
  assert.deepEqual(
    validateWorkInterviewOutcomePayload({
      ...actor,
      interview_number: 1,
      outcome: "late" as never,
    }),
    ["outcome"],
  );
  assert.deepEqual(
    validateWorkAssessmentPayload({ ...actor, outcome: "pass" }),
    [],
  );
  assert.deepEqual(
    validateWorkBackgroundCheckResultPayload({
      ...actor,
      check_type: "x" as never,
      outcome: "clear",
    }),
    ["check_type"],
  );
});
