import assert from "node:assert/strict";
import test from "node:test";

import { isCommandKind } from "./commands.ts";
import { isAggregateType, isEventKind } from "./events.ts";
import {
  HubApplicationChangedKind,
  HubApplyKind,
  type HubApplyPayload,
  HubWithdrawKind,
  normalizeHubApplyPayload,
  OrgApplicationAggregate,
  validateHubApplicationChangedPayload,
  validateHubApplyPayload,
  validateHubWithdrawPayload,
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

test("hub-withdraw is a valid command kind and validates its payload", () => {
  assert.equal(HubWithdrawKind, "hub-withdraw");
  assert.equal(isCommandKind(HubWithdrawKind), true);
  assert.deepEqual(
    validateHubWithdrawPayload({
      opening_number: 1,
      application_number: 2,
      applicant_did: "01900000-0000-7000-8000-000000000001",
    }),
    [],
  );
  assert.deepEqual(
    validateHubWithdrawPayload({
      opening_number: 0,
      application_number: 0,
      applicant_did: "x",
    }),
    ["opening_number", "application_number", "applicant_did"],
  );
});

test("hub-application-changed validates its projection payload", () => {
  assert.equal(isEventKind(HubApplicationChangedKind), true);
  assert.equal(isAggregateType(OrgApplicationAggregate), true);
  const good = {
    org_did: "01900000-0000-7000-8000-000000000002",
    org_domain: "example.com",
    org_display_name: "Example",
    opening_number: 1,
    opening_title: "Engineer",
    application_number: 1,
    status: "applied" as const,
    pending_actions: [],
    applied_at: "2026-10-01T00:00:00Z",
    last_activity_at: "2026-10-01T00:00:00Z",
  };
  assert.deepEqual(validateHubApplicationChangedPayload(good), []);
  assert.deepEqual(
    validateHubApplicationChangedPayload({
      ...good,
      org_did: "x",
      status: "archived" as never,
      pending_actions: ["sign" as never],
      last_activity_at: "2026-09-30T00:00:00Z",
    }),
    ["org_did", "status", "pending_actions", "last_activity_at"],
  );
});
