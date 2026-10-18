import assert from "node:assert/strict";
import test from "node:test";

import { isCommandKind } from "./commands.ts";
import {
  HubApplyKind,
  type HubApplyPayload,
  normalizeHubApplyPayload,
  validateHubApplyPayload,
} from "./hiring.ts";

const payload: HubApplyPayload = {
  opening_number: 1,
  applicant_did: "01900000-0000-7000-8000-000000000001",
  snapshot: {
    display_name: "Ada",
    handle: "abcd1234-0123456789a",
    resident_country: "GB",
    websites: [],
    work_experiences: [],
    certifications: [],
    language_abilities: [],
    educational_qualifications: [],
  },
};

test("hub-apply is a valid command kind", () => {
  assert.equal(HubApplyKind, "hub-apply");
  assert.equal(isCommandKind(HubApplyKind), true);
});

test("hub-apply normalization trims the note and leaves the caller's payload", () => {
  const withNote = { ...payload, cover_note: "  hello " };
  assert.equal(normalizeHubApplyPayload(withNote).cover_note, "hello");
  assert.equal(withNote.cover_note, "  hello ");
  assert.equal(
    "cover_note" in normalizeHubApplyPayload({ ...payload, cover_note: "  " }),
    false,
  );
});

test("hub-apply validation reports each invalid field", () => {
  assert.deepEqual(validateHubApplyPayload(payload), []);
  assert.deepEqual(
    validateHubApplyPayload({
      ...payload,
      opening_number: 0,
      applicant_did: "x",
      cover_note: "a".repeat(5001),
      snapshot: { ...payload.snapshot, display_name: "" },
    }),
    ["opening_number", "applicant_did", "cover_note", "snapshot.display_name"],
  );
});
