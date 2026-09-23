import assert from "node:assert/strict";
import { test } from "node:test";

import { validateSetAliasRequest } from "./alias.ts";

test("alias request distinguishes release from omission", () => {
  assert.deepEqual(validateSetAliasRequest({ profile_alias: "a-b" }), []);
  assert.deepEqual(validateSetAliasRequest({ profile_alias: null }), []);
  for (const value of [
    {},
    { profile_alias: "api" },
    { profile_alias: "alice--2" },
  ]) {
    assert.deepEqual(validateSetAliasRequest(value), ["profile_alias"]);
  }
});
