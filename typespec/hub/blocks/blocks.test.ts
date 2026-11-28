import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeBlockUserRequest,
  validateBlockUserRequest,
  validateCheckBlockRequest,
  validateListBlockedUsersRequest,
  validateListMutedUsersRequest,
} from "./blocks.ts";

const did = "01987aef-1234-7abc-8abc-123456789abc";

test("block user request normalizes and validates the address", () => {
  const request = { user: "  abcde000-123456789ab  " };
  const normalized = normalizeBlockUserRequest(request);
  assert.equal(request.user, "  abcde000-123456789ab  ");
  assert.deepEqual(validateBlockUserRequest(normalized), []);
  for (const user of ["", "BAD address", "api"]) {
    assert.deepEqual(validateBlockUserRequest({ user }), ["user"]);
  }
});

test("list requests bound the limit and the key", () => {
  for (const validate of [
    validateListBlockedUsersRequest,
    validateListMutedUsersRequest,
  ]) {
    assert.deepEqual(validate({}), []);
    assert.deepEqual(validate({ limit: 1 }), []);
    assert.deepEqual(validate({ limit: 50 }), []);
    assert.deepEqual(validate({ limit: 0 }), ["limit"]);
    assert.deepEqual(validate({ limit: 51 }), ["limit"]);
    assert.deepEqual(validate({ pagination_key: "" }), ["pagination_key"]);
  }
});

test("check block request validates identities", () => {
  const valid = {
    blocker_hub_user_did: did,
    blocked_hub_user_did: did,
    viewer_handle: "abcde000-123456789ab",
  };
  assert.deepEqual(validateCheckBlockRequest(valid), []);
  assert.deepEqual(
    validateCheckBlockRequest({
      blocker_hub_user_did: "x",
      blocked_hub_user_did: "x",
      viewer_handle: "x",
    }),
    ["blocker_hub_user_did", "blocked_hub_user_did", "viewer_handle"],
  );
});
