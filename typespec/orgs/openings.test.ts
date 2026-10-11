import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCreateOpeningRequest,
  normalizeRequestOpeningChangeRequest,
  validateCreateOpeningRequest,
  validateDecideOpeningRequestRequest,
  validateDiscardOpeningRequest,
  validateGetOpeningRequest,
  validateListOpeningsRequest,
  validateRequestOpeningChangeRequest,
} from "./openings/openings.ts";

test("Opening create normalization leaves the caller's values intact", () => {
  const request = {
    content: { title: "  Engineer  " },
    hiring_manager_email: " MANAGER@EXAMPLE.COM ",
    team_member_emails: [" PERSON@EXAMPLE.COM "],
  };
  const normalized = normalizeCreateOpeningRequest(request);
  assert.equal(normalized.content.title, "Engineer");
  assert.equal(normalized.hiring_manager_email, "manager@example.com");
  assert.deepEqual(normalized.team_member_emails, ["person@example.com"]);
  assert.equal(request.content.title, "  Engineer  ");
  assert.equal(request.team_member_emails[0], " PERSON@EXAMPLE.COM ");
});

test("Opening lifecycle requests validate kinds, decisions, notes, and approval filters", () => {
  assert.deepEqual(
    validateListOpeningsRequest({ pending_request_kinds: ["pause", "pause"] }),
    ["pending_request_kinds"],
  );
  const request = {
    opening_number: 1,
    version: 1,
    kind: "pause" as const,
    note: "  Later  ",
  };
  assert.equal(normalizeRequestOpeningChangeRequest(request).note, "Later");
  assert.equal(request.note, "  Later  ");
  assert.deepEqual(
    validateRequestOpeningChangeRequest({ ...request, note: " " }),
    ["note"],
  );
  assert.deepEqual(
    validateDecideOpeningRequestRequest({
      opening_number: 1,
      version: 1,
      decision: "reject",
    }),
    ["note"],
  );
  assert.deepEqual(
    validateDecideOpeningRequestRequest({
      opening_number: 1,
      version: 1,
      decision: "approve",
    }),
    [],
  );
});

test("Opening requests reject invalid team, number, version, and state filters", () => {
  assert.deepEqual(
    validateCreateOpeningRequest({ content: {}, team_member_emails: [] }),
    [],
  );
  assert.deepEqual(
    validateCreateOpeningRequest({
      content: {},
      team_member_emails: ["a@example.com", "a@example.com"],
    }),
    ["team_member_emails"],
  );
  assert.deepEqual(validateGetOpeningRequest({ opening_number: 0 }), [
    "opening_number",
  ]);
  assert.deepEqual(
    validateDiscardOpeningRequest({ opening_number: 1, version: 0 }),
    ["version"],
  );
  assert.deepEqual(validateListOpeningsRequest({ states: [] }), ["states"]);
  assert.deepEqual(
    validateListOpeningsRequest({ states: ["draft", "draft"] }),
    ["states"],
  );
});
