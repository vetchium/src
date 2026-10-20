import assert from "node:assert/strict";
import test from "node:test";

import {
  type EngagementSnapshot,
  engagementView,
  validateEngagementActorPayload,
  validateEngagementEndPayload,
  validateEngagementReferencePayload,
  validateEngagementSnapshot,
} from "../federation/marketplace.ts";
import {
  isEngagementID,
  isEngagementState,
  isTerminalEngagementState,
  normalizeEndEngagementRequest,
  normalizeProposeEngagementRequest,
  validateEndEngagementRequest,
  validateEngagementTarget,
  validateGetEngagementRequest,
  validateListEngagementsRequest,
  validateProposeEngagementRequest,
  validateSetEngagementReferenceRequest,
} from "./marketplace/engagements.ts";

const id = "01900000-0000-7000-8000-000000000001";
const text = (length: number) => "é".repeat(length);

test("engagement states split live from terminal", () => {
  assert.equal(isEngagementState("active"), true);
  assert.equal(isEngagementState("paused"), false);
  assert.equal(isTerminalEngagementState("proposed"), false);
  assert.equal(isTerminalEngagementState("active"), false);
  for (const state of ["declined", "withdrawn", "expired", "ended"]) {
    assert.equal(isTerminalEngagementState(state), true);
  }
  assert.equal(isEngagementID(id), true);
  assert.equal(isEngagementID("01900000-0000-7000-8000-00000000000A"), false);
});

test("proposals normalize without touching the caller and validate", () => {
  const request = {
    provider_domain: " ACME.test ",
    capability: "interviewing" as const,
    message: "  Hello  ",
  };
  const normalized = normalizeProposeEngagementRequest(request);
  assert.equal(normalized.provider_domain, "acme.test");
  assert.equal(normalized.message, "Hello");
  assert.equal(request.message, "  Hello  ");
  assert.deepEqual(validateProposeEngagementRequest(normalized), []);
  assert.deepEqual(
    validateProposeEngagementRequest({
      provider_domain: "acme.test",
      capability: "sourcing",
      message: text(2000),
    }),
    [],
  );
  assert.deepEqual(
    validateProposeEngagementRequest({
      provider_domain: "acme.test",
      capability: "sourcing",
      message: text(2001),
    }),
    ["message"],
  );
  assert.deepEqual(
    validateProposeEngagementRequest({
      provider_domain: "acme.test",
      capability: "sourcing",
      message: "a\u0000",
    }),
    ["message"],
  );
  assert.deepEqual(
    validateProposeEngagementRequest({
      provider_domain: "x",
      capability: "plumbing" as never,
    }),
    ["provider_domain", "capability"],
  );
});

test("engagement actions validate ids, versions, notes, and references", () => {
  assert.deepEqual(
    validateEngagementTarget({ engagement_id: id, version: 1 }),
    [],
  );
  assert.deepEqual(
    validateEngagementTarget({ engagement_id: "x", version: 0 }),
    ["engagement_id", "version"],
  );
  assert.deepEqual(
    validateEndEngagementRequest({
      engagement_id: id,
      version: 1,
      note: text(2000),
    }),
    [],
  );
  assert.deepEqual(
    validateEndEngagementRequest({
      engagement_id: id,
      version: 1,
      note: text(2001),
    }),
    ["note"],
  );
  assert.equal(
    normalizeEndEngagementRequest({
      engagement_id: id,
      version: 1,
      note: " x ",
    }).note,
    "x",
  );
  assert.deepEqual(
    validateSetEngagementReferenceRequest({ engagement_id: id, version: 1 }),
    [],
  );
  assert.deepEqual(
    validateSetEngagementReferenceRequest({
      engagement_id: id,
      version: 1,
      reference: text(201),
    }),
    ["reference"],
  );
  assert.deepEqual(validateGetEngagementRequest({ engagement_id: "x" }), [
    "engagement_id",
  ]);
});

test("engagement lists validate filters and page size", () => {
  assert.deepEqual(validateListEngagementsRequest({}), []);
  assert.deepEqual(
    validateListEngagementsRequest({
      state: "active",
      capability: "sourcing",
      limit: 100,
    }),
    [],
  );
  assert.deepEqual(
    validateListEngagementsRequest({
      state: "paused" as never,
      capability: "x" as never,
      limit: 101,
    }),
    ["state", "capability", "limit"],
  );
  assert.deepEqual(validateListEngagementsRequest({ limit: 0 }), ["limit"]);
});

const consumerDID = "01900000-0000-7000-8000-000000000011";
const providerDID = "01900000-0000-7000-8000-000000000012";
const snapshot = (): EngagementSnapshot => ({
  engagement_id: id,
  version: 1,
  consumer: {
    org_did: consumerDID,
    domain: "client.test",
    display_name: "Client",
  },
  provider: {
    org_did: providerDID,
    domain: "agency.test",
    display_name: "Agency",
  },
  capability: "sourcing",
  state: "proposed",
  proposed_at: "2026-10-01T00:00:00Z",
  expires_at: "2026-10-31T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
});

test("engagement snapshots validate and swap the counterparty per side", () => {
  assert.deepEqual(validateEngagementSnapshot(snapshot()), []);
  const bad = snapshot();
  bad.version = 0;
  bad.provider.org_did = bad.consumer.org_did;
  bad.state = "paused" as never;
  bad.expires_at = bad.proposed_at;
  assert.deepEqual(validateEngagementSnapshot(bad).sort(), [
    "expires_at",
    "provider.org_did",
    "state",
    "version",
  ]);
  const value = { ...snapshot(), consumer_reference: "PO-1" };
  assert.equal(
    engagementView(value, "consumer").counterparty.domain,
    "agency.test",
  );
  assert.equal(
    engagementView(value, "provider").counterparty.domain,
    "client.test",
  );
  assert.equal(engagementView(value, "provider").consumer_reference, "PO-1");
  assert.equal(engagementView(value, "provider").provider_reference, undefined);
});

test("engagement command payloads validate", () => {
  const actor = {
    engagement_id: id,
    version: 2,
    provider_org_did: providerDID,
    provider_display_name: "Agency",
    actor_display_name: "Ada",
  };
  assert.deepEqual(validateEngagementActorPayload(actor), []);
  assert.deepEqual(
    validateEngagementActorPayload({
      ...actor,
      engagement_id: "x",
      version: 0,
      provider_org_did: "x",
      provider_display_name: "",
      actor_display_name: "",
    }),
    [
      "engagement_id",
      "version",
      "provider_org_did",
      "provider_display_name",
      "actor_display_name",
    ],
  );
  assert.deepEqual(
    validateEngagementEndPayload({ ...actor, note: text(2001) }),
    ["note"],
  );
  assert.deepEqual(validateEngagementReferencePayload(actor), []);
  assert.deepEqual(
    validateEngagementReferencePayload({ ...actor, reference: text(201) }),
    ["reference"],
  );
});
