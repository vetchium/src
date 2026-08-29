import assert from "node:assert/strict";
import test from "node:test";

import { packageExportProblems } from "./check-contract-files.mjs";

test("package exports must be complete, current, and exact", () => {
  const expected = new Map([
    ["./common/authentication", "./common/authentication.ts"],
    ["./hub/types", "./hub/types.ts"],
  ]);
  const actual = {
    "./common/authentication": "./common/wrong.ts",
    "./stale": "./stale.ts",
  };

  assert.deepEqual(packageExportProblems(actual, expected), [
    "./common/authentication points to ./common/wrong.ts, want ./common/authentication.ts",
    "missing ./hub/types -> ./hub/types.ts",
    "unexpected ./stale",
  ]);
});
