import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSuggestOrgUsersRequest,
  validateSuggestOrgUsersRequest,
} from "./users/management.ts";

test("Org user suggestions trim the query and bound query and limit", () => {
  const request = { query: "  Pri " };
  assert.deepEqual(normalizeSuggestOrgUsersRequest(request), { query: "Pri" });
  assert.equal(request.query, "  Pri ");
  assert.deepEqual(normalizeSuggestOrgUsersRequest({}), {});
  assert.deepEqual(validateSuggestOrgUsersRequest({}), []);
  assert.deepEqual(
    validateSuggestOrgUsersRequest({ query: "é".repeat(100), limit: 20 }),
    [],
  );
  for (const query of ["", " a", "a".repeat(101), "a\u0000b"]) {
    assert.deepEqual(validateSuggestOrgUsersRequest({ query }), ["query"]);
  }
  for (const limit of [0, 21, 1.5]) {
    assert.deepEqual(validateSuggestOrgUsersRequest({ limit }), ["limit"]);
  }
});
