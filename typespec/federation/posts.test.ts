import assert from "node:assert/strict";
import test from "node:test";

import { isCommandKind } from "./commands.ts";
import { isAggregateType, isEventKind } from "./events.ts";
import {
  AggregateHubPost,
  AggregateHubReply,
  HubPostRemovedKind,
  HubPostReplyRegisterKind,
  type HubPostReplyRegisterPayload,
  HubReplyEditedKind,
  HubReplyRemovedKind,
  normalizeHubPostReplyRegisterPayload,
  validateHubPostRemovedPayload,
  validateHubPostReplyRegisterPayload,
  validateHubReplyEditedPayload,
  validateHubReplyRemovedPayload,
} from "./posts.ts";

const id = "0123456789abcdefghij0123456789abcdefghij";
const payload: HubPostReplyRegisterPayload = {
  post_id: id,
  reply_id: id,
  replier_hub_user_did: "01987aef-1234-7abc-8abc-123456789abc",
  replier_handle: "abcde000-123456789ab",
  body: "hello",
  created_at: "2026-01-02T03:04:05Z",
};

test("post kinds are command and event kinds", () => {
  assert.equal(isCommandKind(HubPostReplyRegisterKind), true);
  assert.equal(HubPostReplyRegisterKind, "hub-post-reply-register");
  for (const kind of [
    HubReplyEditedKind,
    HubReplyRemovedKind,
    HubPostRemovedKind,
  ]) {
    assert.equal(isEventKind(kind), true);
  }
  assert.deepEqual(
    [HubReplyEditedKind, HubReplyRemovedKind, HubPostRemovedKind],
    ["hub-reply-edited", "hub-reply-removed", "hub-post-removed"],
  );
  assert.equal(isAggregateType(AggregateHubReply), true);
  assert.equal(isAggregateType(AggregateHubPost), true);
  assert.equal(AggregateHubReply, "hub_reply");
  assert.equal(AggregateHubPost, "hub_post");
});

test("reply register payload validates and normalizes a copy", () => {
  assert.deepEqual(validateHubPostReplyRegisterPayload(payload), []);
  assert.deepEqual(
    validateHubPostReplyRegisterPayload({ ...payload, parent_reply_id: id }),
    [],
  );
  const padded = { ...payload, body: "  hello  " };
  const normalized = normalizeHubPostReplyRegisterPayload(padded);
  assert.equal(padded.body, "  hello  ");
  assert.equal(normalized.body, "hello");
  assert.deepEqual(
    validateHubPostReplyRegisterPayload({
      post_id: "x",
      reply_id: "x",
      parent_reply_id: "x",
      replier_hub_user_did: "x",
      replier_handle: "x",
      body: "a".repeat(513),
      created_at: "yesterday",
    }),
    [
      "post_id",
      "reply_id",
      "parent_reply_id",
      "replier_hub_user_did",
      "replier_handle",
      "body",
      "created_at",
    ],
  );
});

test("event payloads validate", () => {
  assert.deepEqual(
    validateHubReplyEditedPayload({
      post_id: id,
      reply_id: id,
      body: "a",
      revision: 2,
    }),
    [],
  );
  assert.deepEqual(
    validateHubReplyEditedPayload({
      post_id: "x",
      reply_id: "x",
      body: "",
      revision: 0,
    }),
    ["post_id", "reply_id", "body", "revision"],
  );
  assert.deepEqual(
    validateHubReplyRemovedPayload({ post_id: id, reply_id: id }),
    [],
  );
  assert.deepEqual(
    validateHubReplyRemovedPayload({ post_id: "x", reply_id: "x" }),
    ["post_id", "reply_id"],
  );
  assert.deepEqual(validateHubPostRemovedPayload({ post_id: id }), []);
  assert.deepEqual(validateHubPostRemovedPayload({ post_id: "x" }), [
    "post_id",
  ]);
});
