import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Failed,
  isOperationState,
  Pending,
  Succeeded,
  validateGetOperationRequest,
} from "./operations.ts";

test("operation polling validates id and closed state", () => {
  assert.deepEqual(
    validateGetOperationRequest({
      operation_id: "11111111-1111-4111-8111-111111111111",
    }),
    [],
  );
  assert.deepEqual(validateGetOperationRequest({ operation_id: "bad" }), [
    "operation_id",
  ]);
  for (const value of [Pending, Succeeded, Failed]) {
    assert.equal(isOperationState(value), true);
  }
  assert.equal(isOperationState("unknown"), false);
});
