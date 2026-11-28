import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateMeshGetReplyRequest,
  validateMeshListAuthorRepliesRequest,
  validateMeshListRepliesRequest,
} from "./mesh.ts";
import { MaxBodyLength } from "./posts.ts";
import {
  isAuthorReplyState,
  isThreadReplyState,
  normalizeEditReplyRequest,
  normalizeListRepliesRequest,
  normalizeLocateReplyRequest,
  normalizeReplyRequest,
  validateEditReplyRequest,
  validateHideReplyRequest,
  validateListAuthorRepliesRequest,
  validateListRepliesRequest,
  validateLocateReplyRequest,
  validateRemoveReplyRequest,
  validateReplyRequest,
} from "./replies.ts";

const id = "0123456789abcdefghij0123456789abcdefghij";
const did = "01987aef-1234-7abc-8abc-123456789abc";
const handle = "abcde000-123456789ab";

test("reply requests trim a copy and check every field", () => {
  const request = {
    owner: `  ${handle}  `,
    post_id: id,
    parent_reply_id: id,
    body: "  hi\nthere  ",
  };
  const normalized = normalizeReplyRequest(request);
  assert.equal(request.body, "  hi\nthere  ");
  assert.equal(normalized.body, "hi\nthere");
  assert.equal(normalized.owner, handle);
  assert.deepEqual(validateReplyRequest(normalized), []);
  assert.deepEqual(
    validateReplyRequest({
      owner: "BAD address",
      post_id: "x",
      parent_reply_id: "x",
      body: "a\u0000",
    }),
    ["owner", "post_id", "parent_reply_id", "body"],
  );
  const reply = (body: string) =>
    validateReplyRequest({ owner: handle, post_id: id, body });
  assert.deepEqual(reply("😀".repeat(MaxBodyLength)), []);
  assert.deepEqual(reply("😀".repeat(MaxBodyLength + 1)), ["body"]);
  assert.deepEqual(reply(""), ["body"]);
});

test("edit, remove, and hide requests validate", () => {
  const edit = { reply_id: id, body: "  new  ", revision: 1 };
  const normalized = normalizeEditReplyRequest(edit);
  assert.equal(edit.body, "  new  ");
  assert.equal(normalized.body, "new");
  assert.deepEqual(validateEditReplyRequest(normalized), []);
  assert.deepEqual(
    validateEditReplyRequest({ reply_id: "x", body: "", revision: 0 }),
    ["reply_id", "body", "revision"],
  );
  assert.deepEqual(validateRemoveReplyRequest({ reply_id: id }), []);
  assert.deepEqual(validateRemoveReplyRequest({ reply_id: "x" }), ["reply_id"]);
  assert.deepEqual(validateHideReplyRequest({ post_id: id, reply_id: id }), []);
  assert.deepEqual(validateHideReplyRequest({ post_id: "x", reply_id: "x" }), [
    "post_id",
    "reply_id",
  ]);
});

test("list requests bound the owner, ids, key, and limit", () => {
  const request = { owner: `  ${handle}  `, post_id: id };
  assert.equal(normalizeListRepliesRequest(request).owner, handle);
  assert.equal(request.owner, `  ${handle}  `);
  assert.deepEqual(
    validateListRepliesRequest({ owner: handle, post_id: id }),
    [],
  );
  for (const limit of [0, 51, 1.5]) {
    assert.deepEqual(
      validateListRepliesRequest({ owner: handle, post_id: id, limit }),
      ["limit"],
    );
  }
  assert.deepEqual(
    validateListRepliesRequest({
      owner: "api",
      post_id: "x",
      parent_reply_id: "x",
      pagination_key: "",
    }),
    ["owner", "post_id", "parent_reply_id", "pagination_key"],
  );
  assert.deepEqual(
    validateListRepliesRequest({
      owner: handle,
      post_id: id,
      from_reply_id: id,
    }),
    [],
  );
  for (const request of [
    { owner: handle, post_id: id, from_reply_id: "x" },
    { owner: handle, post_id: id, from_reply_id: id, pagination_key: "k" },
  ]) {
    assert.deepEqual(validateListRepliesRequest(request), ["from_reply_id"]);
  }
  const locate = { owner: `  ${handle}  `, post_id: id, reply_id: id };
  assert.equal(normalizeLocateReplyRequest(locate).owner, handle);
  assert.equal(locate.owner, `  ${handle}  `);
  assert.deepEqual(
    validateLocateReplyRequest(normalizeLocateReplyRequest(locate)),
    [],
  );
  assert.deepEqual(
    validateLocateReplyRequest({ owner: "api", post_id: "x", reply_id: "y" }),
    ["owner", "post_id", "reply_id"],
  );
  assert.deepEqual(validateListAuthorRepliesRequest({ owner: handle }), []);
  assert.deepEqual(
    validateListAuthorRepliesRequest({
      owner: "api",
      pagination_key: "",
      limit: 51,
    }),
    ["owner", "pagination_key", "limit"],
  );
});

test("reply states are closed sets", () => {
  for (const state of ["live", "hidden", "placeholder"]) {
    assert.equal(isThreadReplyState(state), true);
  }
  assert.equal(isThreadReplyState("hidden_by_owner"), false);
  assert.equal(isAuthorReplyState("live"), true);
  assert.equal(isAuthorReplyState("post_removed"), true);
  assert.equal(isAuthorReplyState("removed"), false);
});

test("mesh reply requests carry the viewer", () => {
  const viewer = { viewer_hub_user_did: did, viewer_handle: handle };
  assert.deepEqual(
    validateMeshListRepliesRequest({
      owner_hub_user_did: did,
      post_id: id,
      ...viewer,
    }),
    [],
  );
  assert.deepEqual(
    validateMeshListRepliesRequest({
      owner_hub_user_did: "x",
      post_id: "x",
      parent_reply_id: "x",
      viewer_hub_user_did: "x",
      viewer_handle: "x",
    }),
    [
      "owner_hub_user_did",
      "post_id",
      "parent_reply_id",
      "viewer_hub_user_did",
      "viewer_handle",
    ],
  );
  assert.deepEqual(
    validateMeshListRepliesRequest({
      owner_hub_user_did: did,
      post_id: id,
      from_reply_id: id,
      pagination_key: "k",
      ...viewer,
    }),
    ["from_reply_id"],
  );
  assert.deepEqual(
    validateMeshGetReplyRequest({
      owner_hub_user_did: did,
      post_id: id,
      reply_id: id,
      ...viewer,
    }),
    [],
  );
  assert.deepEqual(
    validateMeshGetReplyRequest({
      owner_hub_user_did: did,
      post_id: id,
      reply_id: "x",
      viewer_hub_user_did: did,
      viewer_handle: "x",
    }),
    ["reply_id", "viewer_handle"],
  );
  assert.deepEqual(
    validateMeshListAuthorRepliesRequest({
      author_hub_user_did: did,
      ...viewer,
    }),
    [],
  );
  assert.deepEqual(
    validateMeshListAuthorRepliesRequest({
      author_hub_user_did: "x",
      ...viewer,
      limit: 0,
    }),
    ["author_hub_user_did", "limit"],
  );
});
