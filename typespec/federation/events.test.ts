import assert from "node:assert/strict";
import test from "node:test";
import {
  type DeliverEventRequest,
  isAggregateType,
  isEventDeliveryOutcome,
  isEventKind,
  validateDeliverEventRequest,
} from "./events.ts";

const valid: DeliverEventRequest = {
  event_id: "f4847331-5a4f-4eae-a5f4-cc131b0cd270",
  kind: "hub-application-projected",
  destination_principal_type: "hub_user",
  destination_principal_did: "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
  aggregate_type: "org_application",
  aggregate_id: "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
  aggregate_version: 3,
  payload: { status: "applied" },
};

test("event kinds and aggregate types are closed name syntaxes", () => {
  assert.equal(isEventKind("hub-application-projected"), true);
  assert.equal(isEventKind("Hub_Event"), false);
  assert.equal(isAggregateType("org_application"), true);
  assert.equal(isAggregateType("org-application"), false);
  assert.equal(isAggregateType(`a${"b".repeat(100)}`), false);
});

test("deliver event requests validate every field", () => {
  assert.deepEqual(validateDeliverEventRequest(valid), []);
  assert.deepEqual(
    validateDeliverEventRequest({
      ...valid,
      event_id: "x",
      kind: "Bad_Kind",
      destination_principal_did: "f4847331-5a4f-4eae-a5f4-cc131b0cd270",
      aggregate_type: "Bad",
      aggregate_id: " ",
      aggregate_version: 0,
      payload: [] as unknown as Record<string, unknown>,
    }),
    [
      "event_id",
      "kind",
      "destination_principal_did",
      "aggregate_type",
      "aggregate_id",
      "aggregate_version",
      "payload",
    ],
  );
  assert.deepEqual(
    validateDeliverEventRequest({
      ...valid,
      destination_principal_type: "admin" as "org",
      aggregate_version: 1.5,
    }),
    ["destination_principal_type", "aggregate_version"],
  );
});

test("delivery outcomes are applied, superseded, or duplicate", () => {
  for (const outcome of ["applied", "superseded", "duplicate"]) {
    assert.equal(isEventDeliveryOutcome(outcome), true);
  }
  assert.equal(isEventDeliveryOutcome("delivered"), false);
});
