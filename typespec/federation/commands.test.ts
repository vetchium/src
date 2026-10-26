import assert from "node:assert/strict";
import test from "node:test";
import {
  type ExecuteCommandRequest,
  isCommandKind,
  isCommandResult,
  validateExecuteCommandRequest,
} from "./commands.ts";

const valid: ExecuteCommandRequest = {
  command_id: "f4847331-5a4f-4eae-a5f4-cc131b0cd270",
  correlation_id: "0d3b2a35-5f1c-4f5e-9d47-0a5b7f2e9c11",
  kind: "hub-apply-to-opening",
  authority_principal_type: "org",
  authority_principal_did: "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
  aggregate_id: "018f7e32-7b5a-7d31-8fd0-f7e2a852f144",
  payload: { opening_number: 7 },
};

test("command kinds are lowercase hyphenated names", () => {
  assert.equal(isCommandKind("hub-apply-to-opening"), true);
  assert.equal(isCommandKind("Hub_Apply"), false);
  assert.equal(isCommandKind(`a${"b".repeat(100)}`), false);
});

test("execute command requests validate every field", () => {
  assert.deepEqual(validateExecuteCommandRequest(valid), []);
  assert.deepEqual(
    validateExecuteCommandRequest({
      ...valid,
      command_id: "x",
      authority_principal_did: "f4847331-5a4f-4eae-a5f4-cc131b0cd270",
      aggregate_id: " ",
      payload: [] as unknown as Record<string, unknown>,
    }),
    ["command_id", "authority_principal_did", "aggregate_id", "payload"],
  );
  assert.deepEqual(
    validateExecuteCommandRequest({
      ...valid,
      authority_principal_type: "admin" as "org",
    }),
    ["authority_principal_type"],
  );
});

test("command results are successes or deterministic rejections", () => {
  assert.equal(isCommandResult({ status: 201, body: {} }), true);
  assert.equal(isCommandResult({ status: 409, body: { type: "t" } }), true);
  assert.equal(isCommandResult({ status: 302, body: {} }), false);
  assert.equal(isCommandResult({ status: 503, body: {} }), false);
});
