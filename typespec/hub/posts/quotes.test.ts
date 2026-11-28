import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateMeshListQuotesRequest,
  validateMeshReadEmbedsRequest,
  validateMeshReadQuoteTargetRequest,
} from "./mesh.ts";
import { MaxBodyLength } from "./posts.ts";
import {
  isQuoteTarget,
  isQuoteTargetType,
  normalizeCreateQuoteRequest,
  normalizeDetachQuoteRequest,
  normalizeListQuotesRequest,
  type QuoteTarget,
  validateCreateQuoteRequest,
  validateDetachQuoteRequest,
  validateListQuotesRequest,
} from "./quotes.ts";

const id = "0123456789abcdefghij0123456789abcdefghij";
const did = "01987aef-1234-7abc-8abc-123456789abc";
const handle = "abcde000-123456789ab";

const timeline: QuoteTarget = {
  type: "timeline_post",
  owner: handle,
  post_id: id,
};
const opening: QuoteTarget = {
  type: "opening",
  org_domain: "example.com",
  opening_number: 7,
};

test("quote targets are discriminated on type", () => {
  assert.equal(isQuoteTarget(timeline), true);
  assert.equal(isQuoteTarget(opening), true);
  for (const bad of [
    null,
    "x",
    {},
    { type: "reply", owner: handle, post_id: id },
    { type: "timeline_post", owner: handle },
    { type: "timeline_post", owner: "BAD address", post_id: id },
    { type: "timeline_post", owner: handle, post_id: "x" },
    { ...timeline, opening_number: 1 },
    { type: "opening", opening_number: 1 },
    { ...opening, opening_number: 0 },
    { ...opening, opening_number: 1.5 },
    { ...opening, org_domain: "Not A Domain" },
    { ...opening, post_id: id },
  ]) {
    assert.equal(isQuoteTarget(bad), false, JSON.stringify(bad));
  }
  assert.equal(isQuoteTargetType("opening"), true);
  assert.equal(isQuoteTargetType("reply"), false);
});

test("create quote requests trim a copy and check body and target", () => {
  const request = {
    target: { ...timeline, owner: `  ${handle}  ` },
    body: "  agreed  ",
  };
  const normalized = normalizeCreateQuoteRequest(request);
  assert.equal(request.body, "  agreed  ");
  assert.equal(normalized.body, "agreed");
  assert.deepEqual(validateCreateQuoteRequest(normalized), []);
  const upper = normalizeCreateQuoteRequest({
    target: { ...opening, org_domain: "  Example.COM " },
    body: "hiring",
  });
  assert.deepEqual(validateCreateQuoteRequest(upper), []);

  assert.deepEqual(
    validateCreateQuoteRequest({
      target: { type: "reply" } as never,
      body: "",
      reply_policy: "x" as never,
      quote_policy: "x" as never,
    }),
    ["target", "body", "reply_policy", "quote_policy"],
  );
  const body = (text: string) =>
    validateCreateQuoteRequest({ target: opening, body: text });
  assert.deepEqual(body("😀".repeat(MaxBodyLength)), []);
  assert.deepEqual(body("a".repeat(MaxBodyLength + 1)), ["body"]);
  assert.deepEqual(body("a\u0000"), ["body"]);
});

test("list and detach quote requests bound the fields", () => {
  const request = { owner: `  ${handle}  `, post_id: id };
  const normalized = normalizeListQuotesRequest(request);
  assert.equal(request.owner, `  ${handle}  `);
  assert.deepEqual(validateListQuotesRequest(normalized), []);
  for (const limit of [1, 50]) {
    assert.deepEqual(
      validateListQuotesRequest({ owner: handle, post_id: id, limit }),
      [],
    );
  }
  for (const limit of [0, 51]) {
    assert.deepEqual(
      validateListQuotesRequest({ owner: handle, post_id: id, limit }),
      ["limit"],
    );
  }
  assert.deepEqual(
    validateListQuotesRequest({
      owner: "api",
      post_id: "x",
      pagination_key: "",
    }),
    ["owner", "post_id", "pagination_key"],
  );

  const detach = normalizeDetachQuoteRequest({
    post_id: id,
    quoter: `  ${handle}  `,
    quote_post_id: id,
  });
  assert.deepEqual(validateDetachQuoteRequest(detach), []);
  assert.deepEqual(
    validateDetachQuoteRequest({
      post_id: "x",
      quoter: "BAD address",
      quote_post_id: "x",
    }),
    ["post_id", "quoter", "quote_post_id"],
  );
});

test("mesh quote requests validate identities and item counts", () => {
  assert.deepEqual(
    validateMeshReadQuoteTargetRequest({
      owner_hub_user_did: did,
      target_post_id: id,
      viewer_hub_user_did: did,
      viewer_handle: handle,
    }),
    [],
  );
  assert.deepEqual(
    validateMeshReadQuoteTargetRequest({
      owner_hub_user_did: "x",
      target_post_id: "x",
      viewer_hub_user_did: "x",
      viewer_handle: "x",
    }),
    [
      "owner_hub_user_did",
      "target_post_id",
      "viewer_hub_user_did",
      "viewer_handle",
    ],
  );
  const item = {
    owner_hub_user_did: did,
    target_post_id: id,
    quote_post_id: id,
    quoter_hub_user_did: did,
  };
  const embeds = (items: (typeof item)[]) =>
    validateMeshReadEmbedsRequest({
      viewer_hub_user_did: did,
      viewer_handle: handle,
      items,
    });
  assert.deepEqual(embeds([item]), []);
  assert.deepEqual(embeds(Array(50).fill(item)), []);
  assert.deepEqual(embeds(Array(51).fill(item)), ["items"]);
  assert.deepEqual(embeds([]), ["items"]);
  assert.deepEqual(embeds([{ ...item, quoter_hub_user_did: "x" }]), ["items"]);
  assert.deepEqual(embeds([{ ...item, owner_hub_user_did: "x" }]), ["items"]);

  assert.deepEqual(
    validateMeshListQuotesRequest({
      owner_hub_user_did: did,
      post_id: id,
      viewer_hub_user_did: did,
      viewer_handle: handle,
    }),
    [],
  );
  assert.deepEqual(
    validateMeshListQuotesRequest({
      owner_hub_user_did: "x",
      post_id: "x",
      viewer_hub_user_did: "x",
      viewer_handle: "x",
      limit: 51,
    }),
    [
      "owner_hub_user_did",
      "post_id",
      "viewer_hub_user_did",
      "viewer_handle",
      "limit",
    ],
  );
});
