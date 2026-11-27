import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateMeshGetManyPostsRequest,
  validateMeshListPostsRequest,
} from "./mesh.ts";
import {
  isPostID,
  MaxBodyLength,
  normalizeCreatePostRequest,
  normalizeEditPostRequest,
  normalizeListPostsRequest,
  validateCreatePostRequest,
  validateEditPostRequest,
  validateGetPostRequest,
  validateListPostsRequest,
  validateRemovePostRequest,
  validateSetPostPoliciesRequest,
} from "./posts.ts";

const id = "0123456789abcdefghij0123456789abcdefghij";
const did = "01987aef-1234-7abc-8abc-123456789abc";
const handle = "abcde000-123456789ab";

test("post IDs follow the 20 plus 20 pattern", () => {
  assert.equal(isPostID(id), true);
  for (const value of [
    "",
    "0".repeat(39),
    "0".repeat(41),
    `w${"0".repeat(39)}`,
  ]) {
    assert.equal(isPostID(value), false);
  }
  assert.equal(isPostID(`${"0".repeat(20)}${"A".repeat(20)}`), false);
});

test("body limit counts code points", () => {
  for (const character of ["a", "é", "日", "😀"]) {
    assert.deepEqual(
      validateCreatePostRequest({ body: character.repeat(MaxBodyLength) }),
      [],
    );
    assert.deepEqual(
      validateCreatePostRequest({ body: character.repeat(MaxBodyLength + 1) }),
      ["body"],
    );
  }
  for (const body of ["", "a\u0000b"]) {
    assert.deepEqual(validateCreatePostRequest({ body }), ["body"]);
  }
});

test("create request normalizes a copy and checks policies", () => {
  const request = { body: "  line one\nline two  " };
  const normalized = normalizeCreatePostRequest(request);
  assert.equal(request.body, "  line one\nline two  ");
  assert.equal(normalized.body, "line one\nline two");
  assert.deepEqual(validateCreatePostRequest(normalized), []);
  assert.deepEqual(
    validateCreatePostRequest(normalizeCreatePostRequest({ body: " \n " })),
    ["body"],
  );
  assert.deepEqual(
    validateCreatePostRequest({ body: "a", reply_policy: "nobody" }),
    [],
  );
  assert.deepEqual(
    validateCreatePostRequest({
      body: "a",
      reply_policy: "some" as never,
      quote_policy: "some" as never,
    }),
    ["reply_policy", "quote_policy"],
  );
});

test("edit, remove, and policy requests validate", () => {
  const edit = { post_id: id, body: "  new  ", revision: 1 };
  const normalized = normalizeEditPostRequest(edit);
  assert.equal(edit.body, "  new  ");
  assert.equal(normalized.body, "new");
  assert.deepEqual(validateEditPostRequest(normalized), []);
  assert.deepEqual(
    validateEditPostRequest({ post_id: "x", body: "a\u0000", revision: 0 }),
    ["post_id", "body", "revision"],
  );
  assert.deepEqual(validateRemovePostRequest({ post_id: id }), []);
  assert.deepEqual(validateRemovePostRequest({ post_id: "x" }), ["post_id"]);
  assert.deepEqual(
    validateSetPostPoliciesRequest({
      post_id: id,
      reply_policy: "nobody",
      quote_policy: "everyone",
      locked: true,
    }),
    [],
  );
  assert.deepEqual(
    validateSetPostPoliciesRequest({
      post_id: "x",
      reply_policy: "x" as never,
      quote_policy: "x" as never,
      locked: false,
    }),
    ["post_id", "reply_policy", "quote_policy"],
  );
});

test("list and get requests bound the owner, key, and limit", () => {
  const request = { owner: `  ${handle}  ` };
  const normalized = normalizeListPostsRequest(request);
  assert.equal(request.owner, `  ${handle}  `);
  assert.deepEqual(validateListPostsRequest(normalized), []);
  for (const limit of [1, 50]) {
    assert.deepEqual(validateListPostsRequest({ owner: handle, limit }), []);
  }
  for (const limit of [0, 51]) {
    assert.deepEqual(validateListPostsRequest({ owner: handle, limit }), [
      "limit",
    ]);
  }
  assert.deepEqual(
    validateListPostsRequest({ owner: "BAD address", pagination_key: "" }),
    ["owner", "pagination_key"],
  );
  assert.deepEqual(validateGetPostRequest({ owner: handle, post_id: id }), []);
  assert.deepEqual(validateGetPostRequest({ owner: "api", post_id: "x" }), [
    "owner",
    "post_id",
  ]);
});

test("mesh requests validate identities and references", () => {
  assert.deepEqual(
    validateMeshListPostsRequest({
      owner_hub_user_did: did,
      viewer_hub_user_did: did,
      viewer_handle: handle,
    }),
    [],
  );
  assert.deepEqual(
    validateMeshListPostsRequest({
      owner_hub_user_did: "x",
      viewer_hub_user_did: "x",
      viewer_handle: "x",
    }),
    ["owner_hub_user_did", "viewer_hub_user_did", "viewer_handle"],
  );
  const reference = { owner_hub_user_did: did, post_id: id };
  const many = (posts: (typeof reference)[]) =>
    validateMeshGetManyPostsRequest({
      viewer_hub_user_did: did,
      viewer_handle: handle,
      posts,
    });
  assert.deepEqual(many([reference]), []);
  assert.deepEqual(many(Array(50).fill(reference)), []);
  assert.deepEqual(many(Array(51).fill(reference)), ["posts"]);
  assert.deepEqual(many([]), ["posts"]);
  assert.deepEqual(many([{ ...reference, post_id: "x" }]), ["posts"]);
});
