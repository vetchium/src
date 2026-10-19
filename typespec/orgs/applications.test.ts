import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationStateValues,
  isApplicantNameQuery,
  isApplicationCoverNote,
  isCandidacy,
  isOfferStatus,
  isPDF,
  maxOfferLetterBytes,
  normalizeListApplicationsRequest,
  offerStatusValues,
  validateApplicationActionRequest,
  validateApplicationJoinedOnRequest,
  validateApplicationSeparatedOnRequest,
  validateApplicationStageRequest,
  validateExtendApplicationOfferRequest,
  validateGetApplicationCountsRequest,
  validateGetApplicationRequest,
  validateListApplicationHistoryRequest,
  validateListApplicationsRequest,
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
