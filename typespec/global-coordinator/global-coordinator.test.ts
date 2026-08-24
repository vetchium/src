import assert from "node:assert/strict";
import test from "node:test";

import { isShortID } from "./global-coordinator.ts";

test("short ID validation", () => {
  assert.equal(isShortID("00000000000"), true);
  assert.equal(isShortID("7zzzzzzzzzz"), true);
  assert.equal(isShortID("0000000000"), false);
  assert.equal(isShortID("0000000000o"), false);
  assert.equal(isShortID("0000000000U"), false);
});
