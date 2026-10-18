import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationStateValues,
  isApplicantNameQuery,
  isApplicationCoverNote,
  isCandidacy,
  normalizeListApplicationsRequest,
  validateGetApplicationCountsRequest,
  validateGetApplicationRequest,
  validateListApplicationHistoryRequest,
  validateListApplicationsRequest,
} from "./applications/applications.ts";

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
