import assert from "node:assert/strict";
import test from "node:test";

import { isCommandKind } from "./commands.ts";
import { isAggregateType, isEventKind } from "./events.ts";
import {
  applicationNoticeValues,
  HubAcceptInterviewKind,
  HubAcceptOfferKind,
  HubApplicationChangedKind,
  HubApplicationRemovedKind,
  HubApplyKind,
  type HubApplyPayload,
  HubDeclineConsentKind,
  HubDeclineOfferKind,
  HubGiveConsentKind,
  HubRescheduleInterviewKind,
  HubWithdrawKind,
  normalizeHubApplyPayload,
  normalizeHubRescheduleInterviewPayload,
  OrgApplicationAggregate,
  validateHubAcceptInterviewPayload,
  validateHubApplicationChangedPayload,
  validateHubApplicationRemovedPayload,
  validateHubApplyPayload,
  validateHubBackgroundCheckConsentPayload,
  validateHubOfferResponsePayload,
  validateHubRescheduleInterviewPayload,
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
  const withNote = {
    ...payload,
    cover_note: "  hello ",
    referral: { agency_domain: " Agency.COM ", route: "suggested" as const },
  };
  const normalized = normalizeHubApplyPayload(withNote);
  assert.equal(normalized.cover_note, "hello");
  assert.equal(normalized.referral?.agency_domain, "agency.com");
  assert.equal(withNote.cover_note, "  hello ");
  assert.equal(withNote.referral.agency_domain, " Agency.COM ");
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
      referral: { agency_domain: "agency.com", route: "suggested" },
    }),
    [],
  );
  assert.deepEqual(
    validateHubApplyPayload({
      ...payload,
      opening_number: 0,
      applicant_did: "x",
      referral: {
        agency_domain: "not a domain",
        route: "invalid" as unknown as ReferralRoute,
      },
      cover_note: "a".repeat(5001),
      snapshot: { ...payload.snapshot, display_name: "" },
    }),
    [
      "opening_number",
      "applicant_did",
      "referral.agency_domain",
      "referral.route",
      "cover_note",
      "snapshot.display_name",
    ],
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

test("hub-application-changed validates its notice", () => {
  const base = {
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
  for (const notice of applicationNoticeValues) {
    assert.deepEqual(
      validateHubApplicationChangedPayload({ ...base, notice }),
      [],
    );
  }
  assert.deepEqual(
    validateHubApplicationChangedPayload({
      ...base,
      notice: "offer_text" as never,
    }),
    ["notice"],
  );
});

test("hub-application-removed validates its payload", () => {
  assert.equal(isEventKind(HubApplicationRemovedKind), true);
  assert.deepEqual(
    validateHubApplicationRemovedPayload({
      org_did: "01900000-0000-7000-8000-000000000002",
      opening_number: 1,
      application_number: 1,
    }),
    [],
  );
  assert.deepEqual(
    validateHubApplicationRemovedPayload({
      org_did: "x",
      opening_number: 0,
      application_number: 0,
    }),
    ["org_did", "opening_number", "application_number"],
  );
});

test("offer answers are valid command kinds and validate their payload", () => {
  assert.equal(HubAcceptOfferKind, "hub-accept-offer");
  assert.equal(HubDeclineOfferKind, "hub-decline-offer");
  assert.equal(isCommandKind(HubAcceptOfferKind), true);
  assert.equal(isCommandKind(HubDeclineOfferKind), true);
  assert.deepEqual(
    validateHubOfferResponsePayload({
      opening_number: 1,
      application_number: 2,
      offer_number: 3,
      applicant_did: "01900000-0000-7000-8000-000000000001",
    }),
    [],
  );
  assert.deepEqual(
    validateHubOfferResponsePayload({
      opening_number: 0,
      application_number: 0,
      offer_number: 0,
      applicant_did: "x",
    }),
    ["opening_number", "application_number", "offer_number", "applicant_did"],
  );
});

test("interview responses are command kinds and validate their payloads", () => {
  assert.equal(HubAcceptInterviewKind, "hub-accept-interview");
  assert.equal(HubRescheduleInterviewKind, "hub-request-interview-reschedule");
  assert.equal(isCommandKind(HubAcceptInterviewKind), true);
  assert.equal(isCommandKind(HubRescheduleInterviewKind), true);
  const accept = {
    opening_number: 1,
    application_number: 2,
    interview_number: 3,
    applicant_did: "01900000-0000-7000-8000-000000000001",
  };
  assert.deepEqual(validateHubAcceptInterviewPayload(accept), []);
  assert.deepEqual(
    validateHubAcceptInterviewPayload({
      opening_number: 0,
      application_number: 0,
      interview_number: 0,
      applicant_did: "x",
    }),
    [
      "opening_number",
      "application_number",
      "interview_number",
      "applicant_did",
    ],
  );
  const reschedule = { ...accept, note: "  later " };
  assert.equal(
    normalizeHubRescheduleInterviewPayload(reschedule).note,
    "later",
  );
  assert.equal(reschedule.note, "  later ");
  assert.deepEqual(
    validateHubRescheduleInterviewPayload({ ...accept, note: "later" }),
    [],
  );
  assert.deepEqual(
    validateHubRescheduleInterviewPayload({ ...accept, note: "" }),
    ["note"],
  );
});

test("consent answers are command kinds and validate their payload", () => {
  assert.equal(HubGiveConsentKind, "hub-give-background-check-consent");
  assert.equal(HubDeclineConsentKind, "hub-decline-background-check-consent");
  assert.equal(isCommandKind(HubGiveConsentKind), true);
  assert.equal(isCommandKind(HubDeclineConsentKind), true);
  const payload = {
    opening_number: 1,
    application_number: 2,
    check_number: 3,
    applicant_did: "01900000-0000-7000-8000-000000000001",
  };
  assert.deepEqual(validateHubBackgroundCheckConsentPayload(payload), []);
  assert.deepEqual(
    validateHubBackgroundCheckConsentPayload({
      opening_number: 0,
      application_number: 0,
      check_number: 0,
      applicant_did: "x",
    }),
    ["opening_number", "application_number", "check_number", "applicant_did"],
  );
});
