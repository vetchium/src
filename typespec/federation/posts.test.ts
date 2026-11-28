import assert from "node:assert/strict";
import test from "node:test";

import { isCommandKind } from "./commands.ts";
import { isAggregateType, isEventKind } from "./events.ts";
import {
  AggregateHubPost,
  AggregateHubReply,
  HubPostQuotedKind,
  HubPostRemovedKind,
  HubPostReplyRegisterKind,
  type HubPostReplyRegisterPayload,
  HubPostUnquotedKind,
  HubReplyEditedKind,
  HubReplyRemovedKind,
  normalizeHubPostReplyRegisterPayload,
  validateHubPostQuotedPayload,
  validateHubPostRemovedPayload,
  validateHubPostReplyRegisterPayload,
  validateHubPostUnquotedPayload,
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
    HubPostQuotedKind,
    HubPostUnquotedKind,
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
      author_hub_user_did: payload.replier_hub_user_did,
    }),
    [],
  );
  assert.deepEqual(
    validateHubReplyEditedPayload({
      post_id: "x",
      reply_id: "x",
      body: "",
      revision: 0,
      author_hub_user_did: "x",
    }),
    ["post_id", "reply_id", "body", "revision", "author_hub_user_did"],
  );
  assert.deepEqual(
    validateHubReplyRemovedPayload({
      post_id: id,
      reply_id: id,
      author_hub_user_did: payload.replier_hub_user_did,
    }),
    [],
  );
  assert.deepEqual(
    validateHubReplyRemovedPayload({
      post_id: "x",
      reply_id: "x",
      author_hub_user_did: "x",
    }),
    ["post_id", "reply_id", "author_hub_user_did"],
  );
  assert.deepEqual(
    validateHubPostRemovedPayload({
      post_id: id,
      owner_hub_user_did: payload.replier_hub_user_did,
    }),
    [],
  );
  assert.deepEqual(
    validateHubPostRemovedPayload({ post_id: "x", owner_hub_user_did: "x" }),
    ["post_id", "owner_hub_user_did"],
  );
});

test("quote event payloads carry the quoter DID", () => {
  const quoted = {
    target_post_id: id,
    quote_post_id: id,
    quoter_hub_user_did: payload.replier_hub_user_did,
    quoter_handle: payload.replier_handle,
    created_at: "2026-01-02T03:04:05Z",
  };
  assert.deepEqual(validateHubPostQuotedPayload(quoted), []);
  assert.deepEqual(
    validateHubPostQuotedPayload({
      target_post_id: "x",
      quote_post_id: "x",
      quoter_hub_user_did: "x",
      quoter_handle: "x",
      created_at: "no",
    }),
    [
      "target_post_id",
      "quote_post_id",
      "quoter_hub_user_did",
      "quoter_handle",
      "created_at",
    ],
  );
  const unquoted = {
    target_post_id: id,
    quote_post_id: id,
    quoter_hub_user_did: quoted.quoter_hub_user_did,
  };
  assert.deepEqual(validateHubPostUnquotedPayload(unquoted), []);
  assert.deepEqual(
    validateHubPostUnquotedPayload({
      target_post_id: "x",
      quote_post_id: "x",
      quoter_hub_user_did: "x",
    }),
    ["target_post_id", "quote_post_id", "quoter_hub_user_did"],
  );
});
