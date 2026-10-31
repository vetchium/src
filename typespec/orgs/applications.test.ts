import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationStateValues,
  assessmentOutcomeValues,
  checkOutcomeValues,
  consentStateValues,
  interviewModeValues,
  interviewRecommendationValues,
  interviewResponseValues,
  interviewStateValues,
  isApplicantNameQuery,
  isApplicationCoverNote,
  isAssessmentOutcome,
  isAssessmentScore,
  isBackgroundCheckNumber,
  isCandidacy,
  isCheckOutcome,
  isConsentState,
  isInterviewDurationMinutes,
  isInterviewFeedbackNotes,
  isInterviewLocation,
  isInterviewMode,
  isInterviewOutcome,
  isInterviewRescheduleNote,
  isOfferStatus,
  isPDF,
  isPendingApplicantAction,
  isResultNotes,
  isWorkPerformer,
  maxOfferLetterBytes,
  normalizeChangeInterviewRequest,
  normalizeListApplicationsRequest,
  normalizeRecordAssessmentResultRequest,
  normalizeRecordBackgroundCheckResultRequest,
  normalizeSubmitInterviewFeedbackRequest,
  offerStatusValues,
  validateApplicationActionRequest,
  validateApplicationJoinedOnRequest,
  validateApplicationSeparatedOnRequest,
  validateApplicationStageRequest,
  validateCancelInterviewRequest,
  validateChangeInterviewRequest,
  validateExtendApplicationOfferRequest,
  validateGetApplicationCountsRequest,
  validateGetApplicationRequest,
  validateListApplicationHistoryRequest,
  validateListApplicationsRequest,
  validateListMyInterviewsRequest,
  validateRecordAssessmentResultRequest,
  validateRecordBackgroundCheckResultRequest,
  validateRecordInterviewOutcomeRequest,
  validateRequestBackgroundCheckConsentRequest,
  validateScheduleInterviewRequest,
  validateSubmitInterviewFeedbackRequest,
} from "./applications/applications.ts";
import { validateRequestOpeningChangeRequest } from "./openings/openings.ts";

const stage = "01900000-0000-7000-8000-000000000000";

test("only shortlisted, unfinished applications are candidacies", () => {
  const candidacies = applicationStateValues.filter(isCandidacy);
  assert.deepEqual(candidacies, ["in_pipeline", "offered", "offer_accepted"]);
});

test("list normalization trims the name query and leaves the caller's request", () => {
  const request = {
    opening_number: 1,
    view: "applicants" as const,
    name_query: "  ada ",
  };
  assert.equal(normalizeListApplicationsRequest(request).name_query, "ada");
  assert.equal(request.name_query, "  ada ");
});

test("list requests validate the view and the candidacy filters", () => {
  const applicants = { opening_number: 1, view: "applicants" as const };
  const candidates = { opening_number: 1, view: "candidates" as const };
  assert.deepEqual(validateListApplicationsRequest(applicants), []);
  assert.deepEqual(validateListApplicationsRequest(candidates), []);
  assert.deepEqual(
    validateListApplicationsRequest({ ...applicants, opening_number: 0 }),
    ["opening_number"],
  );
  assert.deepEqual(
    validateListApplicationsRequest({ ...applicants, view: "x" as never }),
    ["view"],
  );
  assert.deepEqual(
    validateListApplicationsRequest({ ...candidates, states: ["joined"] }),
    [],
  );
  assert.deepEqual(
    validateListApplicationsRequest({ ...applicants, states: ["joined"] }),
    ["states"],
  );
  for (const states of [
    [],
    ["submitted"],
    ["x"],
    ["joined", "joined"],
  ] as never[]) {
    assert.deepEqual(
      validateListApplicationsRequest({ ...candidates, states }),
      ["states"],
    );
  }
  assert.deepEqual(
    validateListApplicationsRequest({ ...candidates, stage_id: stage }),
    [],
  );
  assert.deepEqual(
    validateListApplicationsRequest({ ...applicants, stage_id: stage }),
    ["stage_id"],
  );
  assert.deepEqual(
    validateListApplicationsRequest({ ...candidates, stage_id: "nope" }),
    ["stage_id"],
  );
});

test("name queries are 2 to 100 trimmed code points", () => {
  assert.equal(isApplicantNameQuery("ab"), true);
  assert.equal(isApplicantNameQuery("é".repeat(100)), true);
  assert.equal(isApplicantNameQuery("a"), false);
  assert.equal(isApplicantNameQuery(" ab "), false);
  assert.equal(isApplicantNameQuery("é".repeat(101)), false);
});

test("page size and pagination key bounds apply to every list", () => {
  const list = { opening_number: 1, view: "applicants" as const };
  assert.deepEqual(
    validateListApplicationsRequest({ ...list, limit: 100 }),
    [],
  );
  assert.deepEqual(validateListApplicationsRequest({ ...list, limit: 101 }), [
    "limit",
  ]);
  assert.deepEqual(
    validateListApplicationHistoryRequest({
      opening_number: 1,
      application_number: 1,
      pagination_key: "",
      limit: 0,
    }),
    ["pagination_key", "limit"],
  );
});

test("application numbers and the cover note are bounded", () => {
  assert.deepEqual(
    validateGetApplicationRequest({ opening_number: 1, application_number: 1 }),
    [],
  );
  assert.deepEqual(
    validateGetApplicationRequest({ opening_number: 0, application_number: 0 }),
    ["opening_number", "application_number"],
  );
  assert.deepEqual(validateGetApplicationCountsRequest({ opening_number: 0 }), [
    "opening_number",
  ]);
  assert.equal(isApplicationCoverNote("é".repeat(5000)), true);
  assert.equal(isApplicationCoverNote("é".repeat(5001)), false);
  assert.equal(isApplicationCoverNote(""), false);
});

test("write requests validate numbers, version, stage, and dates", () => {
  const base = { opening_number: 1, application_number: 2, version: 3 };
  assert.deepEqual(validateApplicationActionRequest(base), []);
  assert.deepEqual(
    validateApplicationActionRequest({
      opening_number: 0,
      application_number: 0,
      version: 0,
    }),
    ["opening_number", "application_number", "version"],
  );
  assert.deepEqual(
    validateApplicationStageRequest({ ...base, stage_id: stage }),
    [],
  );
  assert.deepEqual(
    validateApplicationStageRequest({ ...base, stage_id: "x" }),
    ["stage_id"],
  );
  assert.deepEqual(
    validateApplicationJoinedOnRequest({ ...base, joined_on: "2028-02-29" }),
    [],
  );
  for (const bad of ["2026-02-30", "2026-2-1", "", "2026-02-28T00:00:00Z"]) {
    assert.deepEqual(
      validateApplicationJoinedOnRequest({ ...base, joined_on: bad }),
      ["joined_on"],
    );
    assert.deepEqual(
      validateApplicationSeparatedOnRequest({ ...base, separated_on: bad }),
      ["separated_on"],
    );
  }
});

test("the bulk choice belongs to a close request", () => {
  const request = { opening_number: 1, version: 1 };
  assert.deepEqual(
    validateRequestOpeningChangeRequest({
      ...request,
      kind: "close",
      mark_applications_not_progressing: true,
    }),
    [],
  );
  assert.deepEqual(
    validateRequestOpeningChangeRequest({
      ...request,
      kind: "pause",
      mark_applications_not_progressing: false,
    }),
    ["mark_applications_not_progressing"],
  );
});

test("offer statuses, the letter limit, and the PDF signature match the contract", () => {
  assert.deepEqual(offerStatusValues, [
    "extended",
    "accepted",
    "declined",
    "expired",
    "withdrawn",
  ]);
  assert.equal(isOfferStatus("pending"), false);
  assert.equal(maxOfferLetterBytes, 5242880);
  const encode = (text: string) => new TextEncoder().encode(text);
  assert.equal(isPDF(encode("%PDF-1.7\n")), true);
  assert.equal(isPDF(encode("%PDF")), false);
  assert.equal(isPDF(encode("GIF89a")), false);
});

test("extending an offer validates the letter, the date, and the deadline", () => {
  const valid = {
    opening_number: 1,
    application_number: 2,
    version: 3,
    letter_id: "01900000-0000-4000-8000-000000000000",
    proposed_joining_date: "2026-12-01",
    respond_within_days: 60,
  };
  assert.deepEqual(validateExtendApplicationOfferRequest(valid), []);
  const { proposed_joining_date: _, ...withoutDate } = valid;
  assert.deepEqual(
    validateExtendApplicationOfferRequest({
      ...withoutDate,
      respond_within_days: 1,
    }),
    [],
  );
  assert.deepEqual(
    validateExtendApplicationOfferRequest({
      opening_number: 0,
      application_number: 0,
      version: 0,
      letter_id: "01900000-0000-4000-8000-00000000000A",
      proposed_joining_date: "2026-12-1",
      respond_within_days: 61,
    }),
    [
      "opening_number",
      "application_number",
      "version",
      "letter_id",
      "proposed_joining_date",
      "respond_within_days",
    ],
  );
});

const interviewBase = {
  opening_number: 1,
  application_number: 2,
  version: 3,
  start_time: "2026-12-01T09:00:00Z",
  duration_minutes: 60,
  mode: "video" as const,
  video_url: "https://meet.example.com/room",
  interviewer_emails: ["a@example.com", "b@example.com"],
};

test("interview vocabularies match the contract and reject unknown values", () => {
  assert.deepEqual(interviewModeValues, ["video", "in_person"]);
  assert.deepEqual(interviewStateValues, [
    "scheduled",
    "completed",
    "no_show",
    "cancelled",
  ]);
  assert.deepEqual(interviewResponseValues, [
    "pending",
    "accepted",
    "reschedule_requested",
  ]);
  assert.deepEqual(interviewRecommendationValues, [
    "strong_yes",
    "yes",
    "no",
    "strong_no",
  ]);
  assert.equal(isInterviewMode("phone"), false);
  assert.equal(isInterviewOutcome("cancelled"), false);
  assert.equal(isInterviewOutcome("no_show"), true);
  assert.equal(isPendingApplicantAction("sign"), false);
});

test("interview bounds are inclusive", () => {
  assert.deepEqual([14, 15, 480, 481].map(isInterviewDurationMinutes), [
    false,
    true,
    true,
    false,
  ]);
  assert.equal(isInterviewLocation("é".repeat(500)), true);
  assert.equal(isInterviewLocation("é".repeat(501)), false);
  assert.equal(isInterviewLocation(" room"), false);
  assert.equal(isInterviewRescheduleNote("é".repeat(501)), false);
  assert.equal(isInterviewFeedbackNotes("é".repeat(10000)), true);
  assert.equal(isInterviewFeedbackNotes("é".repeat(10001)), false);
});

test("scheduling validates the mode details and the interviewers", () => {
  assert.deepEqual(validateScheduleInterviewRequest(interviewBase), []);
  assert.deepEqual(
    validateScheduleInterviewRequest({
      ...interviewBase,
      mode: "in_person",
      video_url: undefined,
      location: "Room 4",
    }),
    [],
  );
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ video_url: undefined }, "video_url"],
    [{ location: "Room 4" }, "location"],
    [{ video_url: "http://meet.example.com/room" }, "video_url"],
    [{ mode: "in_person", video_url: undefined }, "location"],
    [{ mode: "phone" }, "mode"],
    [{ duration_minutes: 5 }, "duration_minutes"],
    [{ start_time: "soon" }, "start_time"],
    [{ interviewer_emails: [] }, "interviewer_emails"],
    [
      { interviewer_emails: ["a@example.com", " A@example.com "] },
      "interviewer_emails",
    ],
  ];
  for (const [change, field] of cases) {
    assert.ok(
      validateScheduleInterviewRequest({
        ...interviewBase,
        ...change,
      } as never).includes(field),
      field,
    );
  }
  const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@example.com`);
  assert.ok(
    validateScheduleInterviewRequest({
      ...interviewBase,
      interviewer_emails: eleven,
    }).includes("interviewer_emails"),
  );
  assert.deepEqual(
    validateScheduleInterviewRequest({
      ...interviewBase,
      interviewer_emails: eleven.slice(0, 10),
    }),
    [],
  );
});

test("changing an interview normalizes a copy", () => {
  const request = {
    ...interviewBase,
    interview_number: 1,
    video_url: " HTTPS://Meet.Example.com/Room/ ",
    interviewer_emails: [" A@Example.com "],
  };
  const normalized = normalizeChangeInterviewRequest(request);
  assert.equal(normalized.video_url, "https://meet.example.com/Room");
  assert.deepEqual(normalized.interviewer_emails, ["a@example.com"]);
  assert.equal(request.interviewer_emails[0], " A@Example.com ");
  assert.deepEqual(validateChangeInterviewRequest(request), []);
  assert.deepEqual(
    validateChangeInterviewRequest({ ...request, interview_number: 0 }),
    ["interview_number"],
  );
});

test("interview actions validate their fields", () => {
  const cancel = {
    opening_number: 1,
    application_number: 2,
    version: 3,
    interview_number: 4,
  };
  assert.deepEqual(validateCancelInterviewRequest(cancel), []);
  assert.deepEqual(
    validateCancelInterviewRequest({ ...cancel, interview_number: 0 }),
    ["interview_number"],
  );
  assert.deepEqual(
    validateRecordInterviewOutcomeRequest({ ...cancel, outcome: "completed" }),
    [],
  );
  assert.deepEqual(
    validateRecordInterviewOutcomeRequest({
      ...cancel,
      outcome: "cancelled" as never,
    }),
    ["outcome"],
  );
  const feedback = { ...cancel, recommendation: "yes" as const, notes: " ok " };
  assert.equal(normalizeSubmitInterviewFeedbackRequest(feedback).notes, "ok");
  assert.deepEqual(validateSubmitInterviewFeedbackRequest(feedback), []);
  assert.deepEqual(
    validateSubmitInterviewFeedbackRequest({
      ...feedback,
      recommendation: "maybe" as never,
      notes: " ",
    }),
    ["recommendation", "notes"],
  );
});

test("the candidates view accepts the pending applicant action filter", () => {
  const request = {
    opening_number: 1,
    view: "candidates" as const,
    pending_applicant_action: "interview_response" as const,
  };
  assert.deepEqual(validateListApplicationsRequest(request), []);
  assert.deepEqual(
    validateListApplicationsRequest({
      ...request,
      pending_applicant_action: "background_check_consent",
    }),
    [],
  );
  assert.deepEqual(
    validateListApplicationsRequest({ ...request, view: "applicants" }),
    ["pending_applicant_action"],
  );
  assert.deepEqual(
    validateListApplicationsRequest({
      ...request,
      pending_applicant_action: "sign" as never,
    }),
    ["pending_applicant_action"],
  );
});

test("my interviews validate pagination", () => {
  assert.deepEqual(validateListMyInterviewsRequest({}), []);
  assert.deepEqual(validateListMyInterviewsRequest({ limit: 0 }), ["limit"]);
});

const reference = { opening_number: 1, application_number: 2, version: 3 };

test("result vocabularies match the contract and reject unknown values", () => {
  assert.deepEqual(assessmentOutcomeValues, ["pass", "fail", "inconclusive"]);
  assert.deepEqual(checkOutcomeValues, [
    "clear",
    "discrepancy",
    "unable_to_verify",
  ]);
  assert.deepEqual(consentStateValues, [
    "requested",
    "given",
    "declined",
    "ended",
  ]);
  assert.equal(isAssessmentOutcome("pass"), true);
  assert.equal(isAssessmentOutcome("x"), false);
  assert.equal(isCheckOutcome("clear"), true);
  assert.equal(isCheckOutcome("x"), false);
  assert.equal(isConsentState("ended"), true);
  assert.equal(isConsentState("x"), false);
  assert.equal(isWorkPerformer("org"), true);
  assert.equal(isWorkPerformer("provider"), true);
  assert.equal(isWorkPerformer("stranger"), false);
  assert.equal(isPendingApplicantAction("background_check_consent"), true);
});

test("result bounds are inclusive", () => {
  assert.deepEqual([-1, 0, 100, 101, 1.5].map(isAssessmentScore), [
    false,
    true,
    true,
    false,
    false,
  ]);
  assert.equal(isResultNotes("é".repeat(2000)), true);
  assert.equal(isResultNotes("é".repeat(2001)), false);
  assert.equal(isResultNotes(" note"), false);
  assert.equal(isResultNotes(""), false);
  assert.equal(isBackgroundCheckNumber(1), true);
  assert.equal(isBackgroundCheckNumber(0), false);
});

test("assessment results normalize a copy and validate every field", () => {
  const request = {
    ...reference,
    outcome: "pass" as const,
    notes: "  solid ",
    report_url: "HTTPS://Reports.Example.com/a/",
  };
  const normalized = normalizeRecordAssessmentResultRequest(request);
  assert.equal(normalized.notes, "solid");
  assert.equal(normalized.report_url, "https://reports.example.com/a");
  assert.equal(request.notes, "  solid ");
  assert.equal(
    normalizeRecordAssessmentResultRequest({ ...request, notes: " " }).notes,
    undefined,
  );
  assert.deepEqual(validateRecordAssessmentResultRequest(request), []);
  assert.deepEqual(
    validateRecordAssessmentResultRequest({
      opening_number: 0,
      application_number: 0,
      version: 0,
      outcome: "maybe" as never,
      score: 101,
      notes: "x".repeat(2001),
      report_url: "http://x.example.com",
    }),
    [
      "opening_number",
      "application_number",
      "version",
      "outcome",
      "score",
      "notes",
      "report_url",
    ],
  );
});

test("consent requests name 1 to 20 unique known check types", () => {
  const request = {
    ...reference,
    check_types: ["identity", "criminal"] as const,
  };
  assert.deepEqual(
    validateRequestBackgroundCheckConsentRequest({
      ...request,
      check_types: [...request.check_types],
    }),
    [],
  );
  for (const types of [[], ["astrology"], ["identity", "identity"]]) {
    assert.deepEqual(
      validateRequestBackgroundCheckConsentRequest({
        ...reference,
        check_types: types as never,
      }),
      ["check_types"],
    );
  }
});

test("background-check results normalize a copy and validate", () => {
  const request = {
    ...reference,
    check_type: "identity" as const,
    outcome: "clear" as const,
    notes: "  fine ",
  };
  assert.equal(
    normalizeRecordBackgroundCheckResultRequest(request).notes,
    "fine",
  );
  assert.equal(request.notes, "  fine ");
  assert.deepEqual(validateRecordBackgroundCheckResultRequest(request), []);
  assert.deepEqual(
    validateRecordBackgroundCheckResultRequest({
      ...request,
      check_type: "astrology" as never,
      outcome: "ok" as never,
      report_url: "ftp://x.example.com",
    }),
    ["check_type", "outcome", "report_url"],
  );
});

test("answer columns are at most three distinct question ids", () => {
  const request = { opening_number: 1, view: "applicants" as const };
  const id = (n: number) =>
    `0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a${String(n).padStart(2, "0")}`;
  assert.deepEqual(
    validateListApplicationsRequest({
      ...request,
      answer_columns: [id(1), id(2), id(3)],
    }),
    [],
  );
  assert.deepEqual(
    validateListApplicationsRequest({
      ...request,
      answer_columns: [id(1), id(2), id(3), id(4)],
    }),
    ["answer_columns"],
  );
  assert.deepEqual(
    validateListApplicationsRequest({
      ...request,
      answer_columns: [id(1), id(1), "Q1"],
    }),
    ["answer_columns.1", "answer_columns.2"],
  );
});
