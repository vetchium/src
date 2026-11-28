import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validatePeerReadCardsRequest,
  validateReadCardsRequest,
} from "./cards.ts";

const did = "01987aef-1234-7abc-8abc-123456789abc";
const handles = Array.from(
  { length: 51 },
  (_, index) => `abc${String(index).padStart(2, "0")}000-123456789ab`,
);

const first = handles[0] as string;
const second = handles[1] as string;

test("read cards takes 1 to 50 distinct handles", () => {
  assert.deepEqual(validateReadCardsRequest({ handles: [first] }), []);
  assert.deepEqual(
    validateReadCardsRequest({ handles: handles.slice(0, 50) }),
    [],
  );
  for (const bad of [[], handles, [first, first], ["x"]]) {
    assert.deepEqual(validateReadCardsRequest({ handles: bad }), ["handles"]);
  }
});

test("peer read cards validates the viewer", () => {
  assert.deepEqual(
    validatePeerReadCardsRequest({
      viewer_hub_user_did: did,
      viewer_handle: first,
      handles: [second],
    }),
    [],
  );
  assert.deepEqual(
    validatePeerReadCardsRequest({
      viewer_hub_user_did: "x",
      viewer_handle: "x",
      handles: [],
    }),
    ["viewer_hub_user_did", "viewer_handle", "handles"],
  );
});
