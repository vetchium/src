import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRelayReadProfileRequest,
  validatePeerReadProfileRequest,
  validateRelayReadProfileRequest,
} from "./federation.ts";

const viewer = "01987aef-1234-7abc-8abc-123456789abc";
const handle = "abcde-123456789ab";

test("federated profile read requests validate every identity field", () => {
  const input = {
    viewer_hub_user_did: viewer,
    viewer_handle: handle,
    address: `  ${handle}  `,
  };
  const normalized = normalizeRelayReadProfileRequest(input);
  assert.equal(input.address, `  ${handle}  `);
  assert.equal(normalized.address, handle);
  assert.deepEqual(validateRelayReadProfileRequest(normalized), []);
  assert.deepEqual(
    validateRelayReadProfileRequest({
      viewer_hub_user_did: "bad",
      viewer_handle: "bad",
      address: "BAD",
    }),
    ["viewer_hub_user_did", "viewer_handle", "address"],
  );
  assert.deepEqual(
    validatePeerReadProfileRequest({
      viewer_hub_user_did: viewer,
      viewer_handle: handle,
      target_hub_user_did: viewer,
    }),
    [],
  );
  assert.deepEqual(
    validatePeerReadProfileRequest({
      viewer_hub_user_did: viewer,
      viewer_handle: handle,
      target_hub_user_did: "bad",
    }),
    ["target_hub_user_did"],
  );
});
