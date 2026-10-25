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
  isCreditedPosition,
  normalizeRelayListCreditedApplicationsRequest,
  validatePeerCountCreditedApplicationsRequest,
  validatePeerListCreditedApplicationsRequest,
  validatePeerListWorkRequest,
  validateRelayCountCreditedApplicationsRequest,
  validateRelayListCreditedApplicationsRequest,
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

test("credited reads resume at a position and name at most a page of applicants", () => {
  const applicant = "01900000-0000-7000-8000-000000000004";
  const position = {
    applied_at: "2026-10-01T10:00:00Z",
    engagement_id,
    opening_number: 3,
    application_number: 7,
  };
  assert.equal(isCreditedPosition(position), true);
  assert.equal(isCreditedPosition({ ...position, applied_at: "soon" }), false);
  assert.equal(isCreditedPosition({ ...position, opening_number: 0 }), false);
  assert.equal(
    isCreditedPosition({ ...position, application_number: 1.5 }),
    false,
  );
  const list = {
    provider_org_did,
    applicant_dids: [applicant],
    after: position,
    limit: 50,
  };
  assert.deepEqual(validatePeerListCreditedApplicationsRequest(list), []);
  assert.deepEqual(
    validatePeerListCreditedApplicationsRequest({
      provider_org_did: "x",
      client_domain: "not a domain",
      opening_number: 0,
      route: "invited" as never,
      status: "pending" as never,
      applicant_dids: [],
      after: { ...position, engagement_id: "y" },
      limit: 0,
    }),
    [
      "provider_org_did",
      "client_domain",
      "opening_number",
      "route",
      "status",
      "applicant_dids",
      "after",
      "limit",
    ],
  );
  assert.deepEqual(
    validatePeerListCreditedApplicationsRequest({
      ...list,
      applicant_dids: Array.from({ length: 101 }, () => applicant),
    }),
    ["applicant_dids"],
  );
  const relay = {
    tenant: "sgp",
    request: { ...list, client_domain: " Client.Example " },
  };
  const normalized = normalizeRelayListCreditedApplicationsRequest(relay);
  assert.equal(normalized.request.client_domain, "client.example");
  assert.equal(relay.request.client_domain, " Client.Example ");
  assert.deepEqual(
    validateRelayListCreditedApplicationsRequest(normalized),
    [],
  );

  const count = { provider_org_did, applicant_dids: [applicant] };
  assert.deepEqual(validatePeerCountCreditedApplicationsRequest(count), []);
  assert.deepEqual(
    validatePeerCountCreditedApplicationsRequest({
      provider_org_did: "x",
      applicant_dids: ["y"],
    }),
    ["provider_org_did", "applicant_dids"],
  );
  assert.deepEqual(
    validateRelayCountCreditedApplicationsRequest({
      tenant: "sgp",
      request: count,
    }),
    [],
  );
  assert.deepEqual(
    validateRelayCountCreditedApplicationsRequest({
      tenant: "Nope!",
      request: { provider_org_did, applicant_dids: [] },
    }),
    ["tenant", "request.applicant_dids"],
  );
});
