import { randomUUID } from "node:crypto";
import type {
  MeshGetReplyRequest,
  MeshGetReplyResponse,
  MeshListAuthorRepliesRequest,
  MeshListAuthorRepliesResponse,
  MeshListRepliesRequest,
  MeshListRepliesResponse,
} from "typespec/hub/posts/mesh";
import type { Post } from "typespec/hub/posts/posts";
import type { Reply } from "typespec/hub/posts/replies";
import {
  IdempotencyKeyConflictError,
  InvalidPaginationKeyError,
} from "typespec/problem/common";
import {
  InvalidJSONError,
  ValidationFailedError,
} from "typespec/problem/details";
import { AuthenticationRequiredError } from "typespec/problem/hub/authentication";
import {
  HubPostConflictError,
  HubPostEditClosedError,
  HubPostLimitReachedError,
  HubPostNotFoundError,
  HubPostRepliesClosedError,
  HubPostReplyRefusedError,
  HubPostUnavailableError,
  HubReplyNotFoundError,
} from "typespec/problem/hub/posts";
import {
  ProfileNotFoundError,
  ProfileUnavailableError,
} from "typespec/problem/hub/profile";
import {
  hubAuditEventsForActor,
  hubPostReply,
  hubPostReplyRowCount,
  hubReplyText,
  insertHubReplyTexts,
  moveHubReplyCreatedAtBack,
  type TestTenant,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { HubAPI, hubIdempotencyKey } from "../lib/hub-api.ts";
import { setHubHome } from "../lib/hub-applicant.ts";
import { HubBlocksAPI } from "../lib/hub-blocks.ts";
import {
  Cast,
  expectAuthorReplies,
  expectLocated,
  expectNoContent,
  expectPost,
  expectProblem,
  expectReplies,
  expectReply,
  HubPostsAPI,
  HubRepliesAPI,
  type PostUser,
  type ReplyOperation,
} from "../lib/hub-posts.ts";
import { meshPeerRequest, meshRelayRequest } from "../lib/mesh.ts";

interface Scenario {
  name: string;
  owner: TestTenant;
  replier: TestTenant;
}

const scenarios: Scenario[] = [
  { name: "same region", owner: "sgp", replier: "sgp" },
  { name: "cross region", owner: "sgp", replier: "usa1" },
];

const allOperations: ReplyOperation[] = [
  "/posts/reply",
  "/posts/edit-reply",
  "/posts/remove-reply",
  "/posts/hide-reply",
  "/posts/unhide-reply",
  "/posts/list-replies",
  "/posts/locate-reply",
  "/posts/list-author-replies",
];

const missingID = "0".repeat(20) + "a".repeat(20);
const idPattern = /^[0-9a-v]{20}[0-9a-z]{20}$/;

function unknownHandle(): string {
  return `${randomUUID().replaceAll("-", "").slice(0, 8)}-0123456789a`;
}

function randomHubUserDID(): string {
  return `018f7e32-7b5a-7d31-8fd0-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function apis(
  request: ConstructorParameters<typeof Cast>[0],
  tenant: TestTenant,
) {
  const hub = new HubAPI(request, tenant);
  return {
    hub,
    posts: new HubPostsAPI(hub),
    replies: new HubRepliesAPI(hub),
    blocks: new HubBlocksAPI(hub),
  };
}

type Apis = ReturnType<typeof apis>;

/** A Silver post owner, a post, and a replier, in the regions of a scenario. */
interface World {
  owner: PostUser;
  replier: PostUser;
  post: Post;
  at: Apis;
  from: Apis;
}

async function world(
  cast: Cast,
  request: ConstructorParameters<typeof Cast>[0],
  scenario: Scenario,
): Promise<World> {
  const at = apis(request, scenario.owner);
  const from = apis(request, scenario.replier);
  const owner = await cast.silver(scenario.owner, "Thread Owner");
  const replier = await cast.user(scenario.replier, "Thread Replier");
  const post = await expectPost(
    await at.posts.create({ body: "The post" }, owner),
    201,
  );
  return { owner, replier, post, at, from };
}

/** Writes one reply and expects `200`. */
async function say(
  cast: Cast,
  w: World,
  api: HubRepliesAPI,
  user: PostUser,
  body: string,
  parent?: string,
): Promise<Reply> {
  return expectReply(
    await api.reply(
      {
        owner: w.owner.handle,
        post_id: w.post.post_id,
        body,
        ...(parent === undefined ? {} : { parent_reply_id: parent }),
      },
      user.token,
      cast.key(user),
    ),
    200,
  );
}

async function thread(
  w: World,
  api: HubRepliesAPI,
  user: PostUser,
  parent?: string,
  limit?: number,
) {
  return expectReplies(
    await api.list(
      {
        owner: w.owner.handle,
        post_id: w.post.post_id,
        ...(parent === undefined ? {} : { parent_reply_id: parent }),
        ...(limit === undefined ? {} : { limit }),
      },
      user.token,
    ),
  );
}

async function replyCount(w: World): Promise<number> {
  const post = await expectPost(
    await w.at.posts.get(
      { owner: w.owner.handle, post_id: w.post.post_id },
      w.owner.token,
    ),
    200,
  );
  return post.reply_count;
}

for (const scenario of scenarios) {
  test(`reply (${scenario.name}) answers 200, replays one reply for one key, refuses a changed body, nests one level, and audits without words`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const key = cast.key(w.replier);
      const body = { owner: w.owner.handle, post_id: w.post.post_id };
      const first = await expectReply(
        await w.from.replies.reply(
          { ...body, body: "  Hello\n\n there \t" },
          w.replier.token,
          key,
        ),
        200,
      );
      expect(first).toMatchObject({
        post_id: w.post.post_id,
        author_handle: w.replier.handle,
        body: "Hello\n\n there",
        state: "live",
        child_count: 0,
        revision: 1,
        edited: false,
      });
      expect(first.reply_id).toMatch(idPattern);
      expect(first.parent_reply_id).toBeUndefined();
      expect(await replyCount(w)).toBe(1);

      // The same key and body replay the same reply and add nothing.
      const replay = await expectReply(
        await w.from.replies.reply(
          { ...body, body: "  Hello\n\n there \t" },
          w.replier.token,
          key,
        ),
        200,
      );
      expect(replay.reply_id).toBe(first.reply_id);
      expect(await replyCount(w)).toBe(1);
      // The same key with another body is a conflict and adds nothing.
      await expectProblem(
        await w.from.replies.reply(
          { ...body, body: "Another" },
          w.replier.token,
          key,
        ),
        409,
        IdempotencyKeyConflictError.type,
      );
      expect(await replyCount(w)).toBe(1);

      const sub = await say(
        cast,
        w,
        w.from.replies,
        w.replier,
        "A sub-reply",
        first.reply_id,
      );
      expect(sub.parent_reply_id).toBe(first.reply_id);
      expect(await replyCount(w)).toBe(2);
      const top = await thread(w, w.from.replies, w.replier);
      expect(top.replies).toHaveLength(1);
      expect(top.replies[0]).toMatchObject({
        reply_id: first.reply_id,
        child_count: 1,
        state: "live",
      });
      const children = await thread(
        w,
        w.from.replies,
        w.replier,
        first.reply_id,
      );
      expect(children.replies.map((reply) => reply.reply_id)).toEqual([
        sub.reply_id,
      ]);

      // A reply below a sub-reply is refused and changes nothing.
      const refused = await w.from.replies.reply(
        { ...body, parent_reply_id: sub.reply_id, body: "Too deep" },
        w.replier.token,
        cast.key(w.replier),
      );
      await expectProblem(refused, 400, ValidationFailedError.type);
      expect(((await refused.json()) as { fields?: string[] }).fields).toEqual([
        "parent_reply_id",
      ]);
      expect(await replyCount(w)).toBe(2);

      const events = hubAuditEventsForActor(
        w.replier.did,
        "hub.reply.created",
        w.replier.tenant,
      );
      expect(events.map((event) => event.entity_id).sort()).toEqual(
        [first.reply_id, sub.reply_id].sort(),
      );
      expect(JSON.stringify(events)).not.toContain("Hello");
    } finally {
      cast.cleanup();
    }
  });

  test(`reply (${scenario.name}) refuses a locked post, a nobody policy, a blocked replier, a removed post, a missing parent, and an unknown owner`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const attempt = (extra: Record<string, unknown> = {}) =>
        w.from.replies.reply(
          {
            owner: w.owner.handle,
            post_id: w.post.post_id,
            body: "Hi",
            ...extra,
          },
          w.replier.token,
          cast.key(w.replier),
        );
      const policies = (reply_policy: "everyone" | "nobody", locked: boolean) =>
        w.at.posts.setPolicies(
          {
            post_id: w.post.post_id,
            reply_policy,
            quote_policy: "everyone",
            locked,
          },
          w.owner.token,
        );

      await expectPost(await policies("everyone", true), 200);
      await expectProblem(await attempt(), 409, HubPostRepliesClosedError.type);
      await expectPost(await policies("nobody", false), 200);
      await expectProblem(await attempt(), 409, HubPostRepliesClosedError.type);
      await expectPost(await policies("everyone", false), 200);
      expect(await replyCount(w)).toBe(0);

      // A reply that is not in this post is not a parent.
      const other = await expectPost(
        await w.at.posts.create({ body: "Other post" }, w.owner),
        201,
      );
      const elsewhere = await expectReply(
        await w.from.replies.reply(
          {
            owner: w.owner.handle,
            post_id: other.post_id,
            body: "On the other post",
          },
          w.replier.token,
          cast.key(w.replier),
        ),
        200,
      );
      for (const parent of [missingID, elsewhere.reply_id]) {
        await expectProblem(
          await attempt({ parent_reply_id: parent }),
          404,
          HubReplyNotFoundError.type,
        );
      }
      await expectProblem(
        await attempt({ post_id: missingID }),
        404,
        HubPostNotFoundError.type,
      );
      await expectProblem(
        await attempt({ owner: unknownHandle() }),
        404,
        HubPostNotFoundError.type,
      );

      // The owner blocked the replier: the block refuses new replies only.
      const ok = await say(cast, w, w.from.replies, w.replier, "Before block");
      await expectNoContent(
        await w.at.blocks.block({ user: w.replier.handle }, w.owner.token),
      );
      await expectProblem(await attempt(), 403, HubPostReplyRefusedError.type);
      await expectProblem(
        await attempt({ parent_reply_id: ok.reply_id }),
        403,
        HubPostReplyRefusedError.type,
      );
      // The block hides nothing from the replier and removes nothing.
      const seen = await thread(w, w.from.replies, w.replier);
      expect(seen.replies.map((reply) => reply.reply_id)).toEqual([
        ok.reply_id,
      ]);
      expect(await replyCount(w)).toBe(1);
      await expectNoContent(
        await w.at.blocks.unblock({ user: w.replier.handle }, w.owner.token),
      );
      await say(cast, w, w.from.replies, w.replier, "After unblock");

      await expectNoContent(
        await w.at.posts.remove({ post_id: w.post.post_id }, w.owner.token),
      );
      await expectProblem(await attempt(), 404, HubPostNotFoundError.type);
    } finally {
      cast.cleanup();
    }
  });
}

test("reply validates the body, the IDs, the owner, the key, and the session, and 512 code points pass", async ({
  request,
}) => {
  const cast = new Cast(request);
  try {
    const w = await world(cast, request, scenarios[0]!);
    const target = { owner: w.owner.handle, post_id: w.post.post_id };
    const emoji = "\u{1F600}".repeat(512);
    const accepted = await say(cast, w, w.from.replies, w.replier, emoji);
    expect([...(accepted.body ?? "")]).toHaveLength(512);

    const invalid: unknown[] = [
      { ...target, body: "" },
      { ...target, body: "   \n\t " },
      { ...target, body: "\u{1F600}".repeat(513) },
      { ...target, body: "bad\u0000body" },
      { ...target },
      { ...target, body: "x", post_id: "short" },
      { ...target, body: "x", parent_reply_id: "short" },
      { ...target, body: "x", owner: "not an address!" },
      { post_id: w.post.post_id, body: "x" },
    ];
    for (const body of invalid) {
      await expectProblem(
        await w.from.replies.raw(
          "/posts/reply",
          body,
          w.replier.token,
          cast.key(w.replier),
        ),
        400,
        ValidationFailedError.type,
      );
    }
    // A body of the wrong JSON type is refused before validation.
    const wrongType = await w.from.replies.raw(
      "/posts/reply",
      { ...target, body: 7 },
      w.replier.token,
      cast.key(w.replier),
    );
    expect(wrongType.status(), await wrongType.text()).toBe(400);
    await expectProblem(
      await w.from.replies.raw(
        "/posts/reply",
        { ...target, body: "x" },
        w.replier.token,
      ),
      400,
      ValidationFailedError.type,
    );
    await expectProblem(
      await w.from.replies.raw(
        "/posts/reply",
        { ...target, body: "x" },
        w.replier.token,
        "short",
      ),
      400,
      ValidationFailedError.type,
    );
    await expectProblem(
      await w.from.replies.rawJSON(
        "/posts/reply",
        '{"body":',
        w.replier.token,
        cast.key(w.replier),
      ),
      400,
      InvalidJSONError.type,
    );
    for (const operation of allOperations) {
      await expectProblem(
        await w.from.replies.rawJSON(
          operation,
          '{"body":',
          w.replier.token,
          cast.key(w.replier),
        ),
        400,
        InvalidJSONError.type,
      );
    }
    for (const operation of [
      "/posts/hide-reply",
      "/posts/unhide-reply",
    ] as const) {
      for (const body of [
        {},
        { post_id: "short", reply_id: missingID },
        { post_id: w.post.post_id, reply_id: "short" },
      ]) {
        await expectProblem(
          await w.from.replies.raw(operation, body, w.owner.token),
          400,
          ValidationFailedError.type,
        );
      }
    }
    for (const token of [undefined, "not-a-session"]) {
      for (const operation of allOperations) {
        await expectProblem(
          await w.from.replies.raw(operation, {}, token, hubIdempotencyKey()),
          401,
          AuthenticationRequiredError.type,
        );
      }
    }
    expect(await replyCount(w)).toBe(1);
  } finally {
    cast.cleanup();
  }
});

for (const scenario of [
  { name: "same region", owner: "sgp", author: "sgp", replier: "sgp" },
  { name: "two regions", owner: "sgp", author: "usa1", replier: "sgp" },
] as const) {
  test(`reply (${scenario.name}) refuses a sub-reply when the parent author blocked the replier, and fails closed when that region does not answer`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    let author: PostUser | undefined;
    try {
      const owner = await cast.silver(scenario.owner);
      author = await cast.user(scenario.author);
      const replier = await cast.user(scenario.replier);
      const ownerApi = apis(request, scenario.owner);
      const authorApi = apis(request, scenario.author);
      const replierApi = apis(request, scenario.replier);
      const post = await expectPost(
        await ownerApi.posts.create({ body: "Owner post" }, owner),
        201,
      );
      const w: World = {
        owner,
        replier,
        post,
        at: ownerApi,
        from: replierApi,
      };
      const parent = await say(
        cast,
        w,
        authorApi.replies,
        author,
        "Author words",
      );
      const ownerReply = await say(
        cast,
        w,
        ownerApi.replies,
        owner,
        "Owner words",
      );
      await expectNoContent(
        await authorApi.blocks.block({ user: replier.handle }, author.token),
      );
      const subTo = (parentID: string) =>
        replierApi.replies.reply(
          {
            owner: owner.handle,
            post_id: post.post_id,
            parent_reply_id: parentID,
            body: "Sub",
          },
          replier.token,
          cast.key(replier),
        );
      await expectProblem(
        await subTo(parent.reply_id),
        403,
        HubPostReplyRefusedError.type,
      );
      // The post owner's reply is checked by the owner's own block list.
      await say(
        cast,
        w,
        replierApi.replies,
        replier,
        "Sub",
        ownerReply.reply_id,
      );
      // A top-level reply is not a sub-reply: only the owner's block applies.
      await say(cast, w, replierApi.replies, replier, "Top level");
      expect(await replyCount(w)).toBe(4);

      await expectNoContent(
        await authorApi.blocks.unblock({ user: replier.handle }, author.token),
      );
      const allowed = await expectReply(await subTo(parent.reply_id), 200);
      expect(allowed.parent_reply_id).toBe(parent.reply_id);

      if (scenario.author !== scenario.owner) {
        // The check fails closed when the parent author's region is gone.
        await expectNoContent(
          await authorApi.blocks.block({ user: replier.handle }, author.token),
        );
        setHubHome(author.did, "gone");
        try {
          await expectProblem(
            await subTo(parent.reply_id),
            503,
            HubPostUnavailableError.type,
          );
        } finally {
          setHubHome(author.did, author.tenant);
        }
        await expectProblem(
          await subTo(parent.reply_id),
          403,
          HubPostReplyRefusedError.type,
        );
      }
    } finally {
      if (author !== undefined) setHubHome(author.did, author.tenant);
      cast.cleanup();
    }
  });
}

test("concurrent replies at 499 let exactly one through the 500-reply cap", async ({
  request,
}) => {
  const cast = new Cast(request);
  try {
    const w = await world(cast, request, scenarios[0]!);
    insertHubReplyTexts(w.replier.did, w.replier.tenant, 499);
    const responses = await Promise.all(
      Array.from({ length: 4 }, (_, n) =>
        w.from.replies.reply(
          {
            owner: w.owner.handle,
            post_id: w.post.post_id,
            body: `Race ${n}`,
          },
          w.replier.token,
          cast.key(w.replier),
        ),
      ),
    );
    const statuses = responses.map((response) => response.status()).sort();
    expect(statuses).toEqual([200, 429, 429, 429]);
    for (const response of responses.filter((r) => r.status() === 429)) {
      await expectProblem(response, 429, HubPostLimitReachedError.type);
    }
    expect((await thread(w, w.at.replies, w.owner)).replies).toHaveLength(1);
    expect(await replyCount(w)).toBe(1);
  } finally {
    cast.cleanup();
  }
});

test("reply answers 429 hub-post-limit-reached at 500 replies in 24 hours and adds nothing", async ({
  request,
}) => {
  const cast = new Cast(request);
  try {
    const w = await world(cast, request, scenarios[1]!);
    insertHubReplyTexts(w.replier.did, w.replier.tenant, 499);
    const last = await say(cast, w, w.from.replies, w.replier, "Number 500");
    await expectProblem(
      await w.from.replies.reply(
        {
          owner: w.owner.handle,
          post_id: w.post.post_id,
          body: "Number 501",
        },
        w.replier.token,
        cast.key(w.replier),
      ),
      429,
      HubPostLimitReachedError.type,
    );
    const seen = await thread(w, w.at.replies, w.owner);
    expect(seen.replies.map((reply) => reply.reply_id)).toEqual([
      last.reply_id,
    ]);
    expect(await replyCount(w)).toBe(1);
  } finally {
    cast.cleanup();
  }
});

for (const scenario of scenarios) {
  test(`list-replies (${scenario.name}) orders oldest first, pages by signed keys, bounds the limit, and pages sub-replies`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const r1 = await say(cast, w, w.from.replies, w.replier, "one");
      const r2 = await say(cast, w, w.from.replies, w.replier, "two");
      const r3 = await say(cast, w, w.from.replies, w.replier, "three");
      const s1 = await say(
        cast,
        w,
        w.from.replies,
        w.replier,
        "sub 1",
        r1.reply_id,
      );
      const s2 = await say(
        cast,
        w,
        w.from.replies,
        w.replier,
        "sub 2",
        r1.reply_id,
      );

      const all = await thread(w, w.from.replies, w.replier);
      expect(all.replies.map((reply) => reply.reply_id)).toEqual([
        r1.reply_id,
        r2.reply_id,
        r3.reply_id,
      ]);
      expect(all.replies[0]).toMatchObject({
        child_count: 2,
        author_handle: w.replier.handle,
      });
      expect(all.next_pagination_key).toBeUndefined();

      const page = await thread(w, w.from.replies, w.replier, undefined, 2);
      expect(page.replies.map((reply) => reply.reply_id)).toEqual([
        r1.reply_id,
        r2.reply_id,
      ]);
      const key = page.next_pagination_key;
      if (key === undefined) throw new Error("expected a next key");
      const target = { owner: w.owner.handle, post_id: w.post.post_id };
      const next = await expectReplies(
        await w.from.replies.list(
          { ...target, limit: 2, pagination_key: key },
          w.replier.token,
        ),
      );
      expect(next.replies.map((reply) => reply.reply_id)).toEqual([
        r3.reply_id,
      ]);
      expect(next.next_pagination_key).toBeUndefined();

      const otherPost = await expectPost(
        await w.at.posts.create({ body: "Second post" }, w.owner),
        201,
      );
      for (const request of [
        { ...target, pagination_key: `${key}x` },
        { ...target, pagination_key: "not-a-key" },
        // A key is bound to its post and to its parent reply.
        { ...target, post_id: otherPost.post_id, pagination_key: key },
        { ...target, parent_reply_id: r1.reply_id, pagination_key: key },
      ]) {
        await expectProblem(
          await w.from.replies.list(request, w.replier.token),
          400,
          InvalidPaginationKeyError.type,
        );
      }
      for (const limit of [0, 51, -1]) {
        await expectProblem(
          await w.from.replies.raw(
            "/posts/list-replies",
            { ...target, limit },
            w.replier.token,
          ),
          400,
          ValidationFailedError.type,
        );
      }

      const firstChild = await thread(
        w,
        w.from.replies,
        w.replier,
        r1.reply_id,
        1,
      );
      expect(firstChild.replies.map((reply) => reply.reply_id)).toEqual([
        s1.reply_id,
      ]);
      const childKey = firstChild.next_pagination_key;
      if (childKey === undefined) throw new Error("expected a child key");
      const secondChild = await expectReplies(
        await w.from.replies.list(
          {
            ...target,
            parent_reply_id: r1.reply_id,
            limit: 1,
            pagination_key: childKey,
          },
          w.replier.token,
        ),
      );
      expect(secondChild.replies.map((reply) => reply.reply_id)).toEqual([
        s2.reply_id,
      ]);
      expect(secondChild.next_pagination_key).toBeUndefined();

      for (const [request, status, type] of [
        [{ ...target, post_id: missingID }, 404, HubPostNotFoundError.type],
        [{ ...target, owner: unknownHandle() }, 404, HubPostNotFoundError.type],
        [
          { ...target, owner: "not an address!" },
          400,
          ValidationFailedError.type,
        ],
        [{ ...target, post_id: "short" }, 400, ValidationFailedError.type],
        [
          { ...target, parent_reply_id: "short" },
          400,
          ValidationFailedError.type,
        ],
      ] as const) {
        await expectProblem(
          await w.from.replies.raw(
            "/posts/list-replies",
            request,
            w.replier.token,
          ),
          status,
          type,
        );
      }

      // A removed post has no thread (PST-THR-008).
      await expectNoContent(
        await w.at.posts.remove({ post_id: w.post.post_id }, w.owner.token),
      );
      await expectProblem(
        await w.from.replies.list(target, w.replier.token),
        404,
        HubPostNotFoundError.type,
      );
    } finally {
      cast.cleanup();
    }
  });

  test(`hide-reply and unhide-reply (${scenario.name}) show a hidden reply only to its author and the post owner, keep a placeholder over sub-replies, and move the counts once`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const viewer = await cast.user(scenario.replier, "Thread Viewer");
      const r1 = await say(cast, w, w.from.replies, w.replier, "has a child");
      const r2 = await say(cast, w, w.from.replies, w.replier, "no child");
      const s1 = await say(
        cast,
        w,
        w.from.replies,
        viewer,
        "child",
        r1.reply_id,
      );
      expect(await replyCount(w)).toBe(3);
      const target = { post_id: w.post.post_id };
      const ids = async (user: PostUser, api: HubRepliesAPI = w.from.replies) =>
        (await thread(w, api, user)).replies.map(
          (reply) => `${reply.reply_id}:${reply.state}`,
        );

      // Another user's request cannot hide, and the post must be the caller's.
      for (const user of [w.replier, viewer]) {
        await expectProblem(
          await w.from.replies.hide(
            { ...target, reply_id: r1.reply_id },
            user.token,
          ),
          404,
          HubReplyNotFoundError.type,
        );
      }
      for (const reply_id of [missingID]) {
        await expectProblem(
          await w.at.replies.hide({ ...target, reply_id }, w.owner.token),
          404,
          HubReplyNotFoundError.type,
        );
      }
      await expectProblem(
        await w.at.replies.hide(
          { post_id: missingID, reply_id: r1.reply_id },
          w.owner.token,
        ),
        404,
        HubReplyNotFoundError.type,
      );

      // r1 has a sub-reply, so others see a placeholder; r2 has none, so
      // others do not see it at all. The author and the post owner see both
      // with words.
      await expectNoContent(
        await w.at.replies.hide(
          { ...target, reply_id: r1.reply_id },
          w.owner.token,
        ),
      );
      await expectNoContent(
        await w.at.replies.hide(
          { ...target, reply_id: r2.reply_id },
          w.owner.token,
        ),
      );
      expect(await ids(viewer)).toEqual([`${r1.reply_id}:placeholder`]);
      expect(await ids(w.owner, w.at.replies)).toEqual([
        `${r1.reply_id}:hidden`,
        `${r2.reply_id}:hidden`,
      ]);
      const seen = (await thread(w, w.at.replies, w.owner)).replies;
      expect(seen.map((reply) => reply.body)).toEqual([
        "has a child",
        "no child",
      ]);
      expect(await ids(w.replier)).toEqual([
        `${r1.reply_id}:hidden`,
        `${r2.reply_id}:hidden`,
      ]);
      const placeholder = (await thread(w, w.from.replies, viewer)).replies[0]!;
      expect(placeholder.body).toBeUndefined();
      expect(JSON.stringify(placeholder)).not.toContain("has a child");
      const own = (await thread(w, w.from.replies, w.replier)).replies[0]!;
      expect(own.body).toBe("has a child");
      // Both hidden rows left the count; the sub-reply still counts.
      expect(await replyCount(w)).toBe(1);
      const subs = await thread(w, w.from.replies, viewer, r1.reply_id);
      expect(subs.replies.map((reply) => reply.reply_id)).toEqual([
        s1.reply_id,
      ]);

      // A repeat changes no count and writes no second audit event.
      await expectNoContent(
        await w.at.replies.hide(
          { ...target, reply_id: r1.reply_id },
          w.owner.token,
        ),
      );
      expect(await replyCount(w)).toBe(1);
      expect(
        hubAuditEventsForActor(
          w.owner.did,
          "hub.post.reply-hidden",
          w.owner.tenant,
        ),
      ).toHaveLength(2);

      for (const reply of [r1, r2]) {
        await expectNoContent(
          await w.at.replies.unhide(
            { ...target, reply_id: reply.reply_id },
            w.owner.token,
          ),
        );
      }
      await expectNoContent(
        await w.at.replies.unhide(
          { ...target, reply_id: r2.reply_id },
          w.owner.token,
        ),
      );
      expect(await ids(viewer)).toEqual([
        `${r1.reply_id}:live`,
        `${r2.reply_id}:live`,
      ]);
      expect(await replyCount(w)).toBe(3);
      expect(
        hubAuditEventsForActor(
          w.owner.did,
          "hub.post.reply-unhidden",
          w.owner.tenant,
        ),
      ).toHaveLength(2);

      // Hiding a sub-reply lowers the parent's sub-reply count.
      await expectNoContent(
        await w.at.replies.hide(
          { ...target, reply_id: s1.reply_id },
          w.owner.token,
        ),
      );
      const afterHide = await thread(w, w.from.replies, viewer);
      expect(afterHide.replies[0]).toMatchObject({
        reply_id: r1.reply_id,
        child_count: 0,
      });
      // Only its author, the viewer, still sees the hidden sub-reply.
      expect(
        (await thread(w, w.from.replies, w.replier, r1.reply_id)).replies,
      ).toEqual([]);
      expect(
        (await thread(w, w.from.replies, viewer, r1.reply_id)).replies.map(
          (reply) => reply.state,
        ),
      ).toEqual(["hidden"]);
      expect(await replyCount(w)).toBe(2);
      await expectNoContent(
        await w.at.replies.unhide(
          { ...target, reply_id: s1.reply_id },
          w.owner.token,
        ),
      );
      expect(await replyCount(w)).toBe(3);

      // Hide and unhide of a removed post's reply finds nothing.
      await expectNoContent(
        await w.at.posts.remove({ post_id: w.post.post_id }, w.owner.token),
      );
      await expectProblem(
        await w.at.replies.hide(
          { ...target, reply_id: r1.reply_id },
          w.owner.token,
        ),
        404,
        HubReplyNotFoundError.type,
      );
      await expectProblem(
        await w.at.replies.unhide(
          { ...target, reply_id: r1.reply_id },
          w.owner.token,
        ),
        404,
        HubReplyNotFoundError.type,
      );
    } finally {
      cast.cleanup();
    }
  });

  test(`list-replies (${scenario.name}) filters out a muted author and can return a short page with a next key`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const viewer = await cast.user(scenario.replier, "Mute Viewer");
      const muted = await say(cast, w, w.from.replies, w.replier, "from muted");
      const kept = await say(cast, w, w.from.replies, viewer, "from kept");
      await expectNoContent(
        await w.from.blocks.mute({ user: w.replier.handle }, viewer.token),
      );
      const filtered = await thread(w, w.from.replies, viewer);
      expect(filtered.replies.map((reply) => reply.reply_id)).toEqual([
        kept.reply_id,
      ]);
      // Page one reads only the muted reply: it is short, and the list goes on.
      const short = await thread(w, w.from.replies, viewer, undefined, 1);
      expect(short.replies).toEqual([]);
      const key = short.next_pagination_key;
      if (key === undefined) throw new Error("expected a next key");
      const rest = await expectReplies(
        await w.from.replies.list(
          {
            owner: w.owner.handle,
            post_id: w.post.post_id,
            limit: 1,
            pagination_key: key,
          },
          viewer.token,
        ),
      );
      expect(rest.replies.map((reply) => reply.reply_id)).toEqual([
        kept.reply_id,
      ]);
      // Other viewers still read both, and unmuting restores the reply.
      expect(
        (await thread(w, w.at.replies, w.owner)).replies.map(
          (reply) => reply.reply_id,
        ),
      ).toEqual([muted.reply_id, kept.reply_id]);
      await expectNoContent(
        await w.from.blocks.unmute({ user: w.replier.handle }, viewer.token),
      );
      expect((await thread(w, w.from.replies, viewer)).replies).toHaveLength(2);
    } finally {
      cast.cleanup();
    }
  });

  test(`edit-reply (${scenario.name}) changes the words in both tenants and refuses stale, late, foreign, and invalid edits`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const reply = await say(cast, w, w.from.replies, w.replier, "before");
      const edited = await expectReply(
        await w.from.replies.edit(
          { reply_id: reply.reply_id, body: "  after \n", revision: 1 },
          w.replier.token,
        ),
        200,
      );
      expect(edited).toMatchObject({
        reply_id: reply.reply_id,
        body: "after",
        revision: 2,
        edited: true,
        state: "live",
        author_handle: w.replier.handle,
      });
      expect(hubReplyText(reply.reply_id, w.replier.tenant)).toMatchObject({
        body: "after",
        revision: 2,
      });
      // The copy in the post owner's tenant changes when the event arrives.
      await expect
        .poll(
          async () => {
            const seen = await thread(w, w.at.replies, w.owner);
            return seen.replies[0]
              ? `${seen.replies[0].body}:${seen.replies[0].revision}:${seen.replies[0].edited}`
              : "";
          },
          { timeout: 30_000, intervals: [250] },
        )
        .toBe("after:2:true");
      expect(hubPostReply(reply.reply_id, w.owner.tenant)).toMatchObject({
        body: "after",
        revision: 2,
      });

      // A stale revision conflicts and keeps the words.
      await expectProblem(
        await w.from.replies.edit(
          { reply_id: reply.reply_id, body: "stale", revision: 1 },
          w.replier.token,
        ),
        409,
        HubPostConflictError.type,
      );
      expect(hubReplyText(reply.reply_id, w.replier.tenant)?.body).toBe(
        "after",
      );

      // Another user cannot edit it, and an unknown reply is not found.
      for (const [user, reply_id] of [
        [w.owner, reply.reply_id],
        [w.replier, missingID],
      ] as const) {
        await expectProblem(
          await (user === w.owner ? w.at : w.from).replies.edit(
            { reply_id, body: "stolen", revision: 2 },
            user.token,
          ),
          404,
          HubReplyNotFoundError.type,
        );
      }
      expect(hubReplyText(reply.reply_id, w.replier.tenant)?.body).toBe(
        "after",
      );

      // After 30 minutes the words are fixed.
      const late = await say(cast, w, w.from.replies, w.replier, "late");
      moveHubReplyCreatedAtBack(late.reply_id, w.replier.tenant, 31);
      await expectProblem(
        await w.from.replies.edit(
          { reply_id: late.reply_id, body: "too late", revision: 1 },
          w.replier.token,
        ),
        409,
        HubPostEditClosedError.type,
      );
      expect(hubReplyText(late.reply_id, w.replier.tenant)?.body).toBe("late");

      for (const body of [
        { reply_id: reply.reply_id, body: "", revision: 2 },
        { reply_id: reply.reply_id, body: "x".repeat(513), revision: 2 },
        { reply_id: reply.reply_id, body: "a\u0000b", revision: 2 },
        { reply_id: reply.reply_id, body: "x", revision: 0 },
        { reply_id: reply.reply_id, body: "x" },
        { reply_id: "short", body: "x", revision: 2 },
      ]) {
        await expectProblem(
          await w.from.replies.raw("/posts/edit-reply", body, w.replier.token),
          400,
          ValidationFailedError.type,
        );
      }
      await expectProblem(
        await w.from.replies.rawJSON(
          "/posts/edit-reply",
          '{"body":',
          w.replier.token,
        ),
        400,
        InvalidJSONError.type,
      );

      // A removed reply cannot be edited.
      await expectNoContent(
        await w.from.replies.remove(
          { reply_id: reply.reply_id },
          w.replier.token,
        ),
      );
      await expectProblem(
        await w.from.replies.edit(
          { reply_id: reply.reply_id, body: "revived", revision: 2 },
          w.replier.token,
        ),
        404,
        HubReplyNotFoundError.type,
      );
    } finally {
      cast.cleanup();
    }
  });

  test(`remove-reply (${scenario.name}) clears the words in both tenants, keeps a placeholder over sub-replies, and lowers the counts`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const viewer = await cast.user(scenario.replier, "Thread Viewer");
      const r1 = await say(cast, w, w.from.replies, w.replier, "secret one");
      const r2 = await say(cast, w, w.from.replies, w.replier, "secret two");
      const s1 = await say(
        cast,
        w,
        w.from.replies,
        viewer,
        "child",
        r1.reply_id,
      );
      expect(await replyCount(w)).toBe(3);

      // Another user cannot remove it, and an unknown reply is not found.
      await expectProblem(
        await w.at.replies.remove({ reply_id: r1.reply_id }, w.owner.token),
        404,
        HubReplyNotFoundError.type,
      );
      await expectProblem(
        await w.from.replies.remove({ reply_id: missingID }, w.replier.token),
        404,
        HubReplyNotFoundError.type,
      );
      await expectProblem(
        await w.from.replies.raw(
          "/posts/remove-reply",
          { reply_id: "short" },
          w.replier.token,
        ),
        400,
        ValidationFailedError.type,
      );
      expect(hubReplyText(r1.reply_id, w.replier.tenant)?.body).toBe(
        "secret one",
      );

      for (const reply of [r1, r2]) {
        await expectNoContent(
          await w.from.replies.remove(
            { reply_id: reply.reply_id },
            w.replier.token,
          ),
        );
      }
      // The author's tenant clears the words at once.
      for (const reply of [r1, r2]) {
        expect(hubReplyText(reply.reply_id, w.replier.tenant)).toMatchObject({
          state: "removed",
          body: null,
        });
      }
      // The post owner's tenant clears its copy when the event arrives.
      await expect
        .poll(
          () =>
            [r1, r2].map(
              (reply) => hubPostReply(reply.reply_id, w.owner.tenant)?.state,
            ),
          { timeout: 30_000, intervals: [250] },
        )
        .toEqual(["author_removed", "author_removed"]);
      for (const reply of [r1, r2]) {
        expect(hubPostReply(reply.reply_id, w.owner.tenant)?.body).toBeNull();
      }
      // One reply row is left, so the thread shows a placeholder for r1 only.
      const seen = (await thread(w, w.from.replies, viewer)).replies;
      expect(seen.map((reply) => `${reply.reply_id}:${reply.state}`)).toEqual([
        `${r1.reply_id}:placeholder`,
      ]);
      expect(JSON.stringify(seen)).not.toContain("secret");
      expect(
        (await thread(w, w.at.replies, w.owner, r1.reply_id)).replies.map(
          (reply) => reply.reply_id,
        ),
      ).toEqual([s1.reply_id]);
      expect(await replyCount(w)).toBe(1);

      // A repeat is not found and the Replies tab keeps nothing of them.
      await expectProblem(
        await w.from.replies.remove({ reply_id: r1.reply_id }, w.replier.token),
        404,
        HubReplyNotFoundError.type,
      );
      const tab = await expectAuthorReplies(
        await w.from.replies.listByAuthor(
          { owner: w.replier.handle },
          w.replier.token,
        ),
      );
      expect(tab.replies).toEqual([]);
    } finally {
      cast.cleanup();
    }
  });

  test(`locate-reply (${scenario.name}) names the parent of a sub-reply, none for a top-level reply, and refuses a missing reply or post`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const top = await say(cast, w, w.from.replies, w.replier, "top");
      const sub = await say(
        cast,
        w,
        w.from.replies,
        w.replier,
        "sub",
        top.reply_id,
      );
      const locate = (reply_id: string, post_id = w.post.post_id) =>
        w.from.replies.locate(
          { owner: w.owner.handle, post_id, reply_id },
          w.replier.token,
        );
      const located = await expectLocated(await locate(top.reply_id));
      expect(located).toEqual({ reply_id: top.reply_id });
      expect(await expectLocated(await locate(sub.reply_id))).toEqual({
        reply_id: sub.reply_id,
        parent_reply_id: top.reply_id,
      });
      // The answer holds no words.
      expect(JSON.stringify(located)).not.toContain("top");
      await expectProblem(
        await locate(missingID),
        404,
        HubReplyNotFoundError.type,
      );
      await expectProblem(
        await locate(top.reply_id, missingID),
        404,
        HubPostNotFoundError.type,
      );
      await expectProblem(
        await w.from.replies.locate(
          {
            owner: unknownHandle(),
            post_id: w.post.post_id,
            reply_id: top.reply_id,
          },
          w.replier.token,
        ),
        404,
        HubPostNotFoundError.type,
      );
      for (const body of [
        { owner: w.owner.handle, post_id: w.post.post_id },
        { owner: w.owner.handle, post_id: "short", reply_id: top.reply_id },
        { owner: "", post_id: w.post.post_id, reply_id: top.reply_id },
      ]) {
        await expectProblem(
          await w.from.replies.raw(
            "/posts/locate-reply",
            body,
            w.replier.token,
          ),
          400,
          ValidationFailedError.type,
        );
      }
      await expectProblem(
        await w.from.replies.rawJSON(
          "/posts/locate-reply",
          "{",
          w.replier.token,
        ),
        400,
        InvalidJSONError.type,
      );
      // A region that does not answer.
      setHubHome(w.owner.did, "gone");
      try {
        await expectProblem(
          await locate(top.reply_id),
          503,
          HubPostUnavailableError.type,
        );
      } finally {
        setHubHome(w.owner.did, w.owner.tenant);
      }
    } finally {
      cast.cleanup();
    }
  });

  test(`list-replies (${scenario.name}) starts at from_reply_id in the top list and in a sub-list, and refuses a reply of another list or a key with it`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const tops: Reply[] = [];
      for (const body of ["t1", "t2", "t3"]) {
        tops.push(await say(cast, w, w.from.replies, w.replier, body));
      }
      const parent = tops[1]!;
      const subs: Reply[] = [];
      for (const body of ["s1", "s2", "s3"]) {
        subs.push(
          await say(cast, w, w.from.replies, w.replier, body, parent.reply_id),
        );
      }
      const from = (
        from_reply_id: string,
        extra: Record<string, unknown> = {},
      ) =>
        w.from.replies.list(
          {
            owner: w.owner.handle,
            post_id: w.post.post_id,
            from_reply_id,
            ...extra,
          },
          w.replier.token,
        );
      const top = await expectReplies(await from(parent.reply_id));
      expect(top.replies.map((reply) => reply.body)).toEqual(["t2", "t3"]);
      const sub = await expectReplies(
        await from(subs[1]!.reply_id, { parent_reply_id: parent.reply_id }),
      );
      expect(sub.replies.map((reply) => reply.body)).toEqual(["s2", "s3"]);

      // A page from a reply continues with the signed key.
      const first = await expectReplies(
        await from(parent.reply_id, { limit: 1 }),
      );
      expect(first.replies.map((reply) => reply.body)).toEqual(["t2"]);
      const next = await expectReplies(
        await w.from.replies.list(
          {
            owner: w.owner.handle,
            post_id: w.post.post_id,
            limit: 1,
            pagination_key: first.next_pagination_key!,
          },
          w.replier.token,
        ),
      );
      expect(next.replies.map((reply) => reply.body)).toEqual(["t3"]);

      for (const [reply, extra] of [
        [subs[1]!.reply_id, {}],
        [tops[2]!.reply_id, { parent_reply_id: parent.reply_id }],
        [missingID, {}],
      ] as const) {
        await expectProblem(
          await from(reply, extra),
          404,
          HubReplyNotFoundError.type,
        );
      }
      const both = await from(parent.reply_id, {
        pagination_key: first.next_pagination_key!,
      });
      await expectProblem(both, 400, ValidationFailedError.type);
      expect((await both.json()).fields).toEqual(["from_reply_id"]);
      const bad = await from("short");
      await expectProblem(bad, 400, ValidationFailedError.type);
      expect((await bad.json()).fields).toEqual(["from_reply_id"]);
    } finally {
      cast.cleanup();
    }
  });

  test(`a removed post (${scenario.name}) marks each reply post_removed on the Replies tab and deletes its structure rows`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const r1 = await say(cast, w, w.from.replies, w.replier, "stays mine");
      expect(
        hubPostReplyRowCount(w.post.post_id, w.owner.tenant),
      ).toBeGreaterThan(0);
      await expectNoContent(
        await w.at.posts.remove({ post_id: w.post.post_id }, w.owner.token),
      );
      await expect
        .poll(() => hubReplyText(r1.reply_id, w.replier.tenant)?.state, {
          timeout: 30_000,
          intervals: [250],
        })
        .toBe("post_removed");
      await expect
        .poll(() => hubPostReplyRowCount(w.post.post_id, w.owner.tenant), {
          timeout: 30_000,
          intervals: [250],
        })
        .toBe(0);
      // The reply still has its words in its author's tenant.
      expect(hubReplyText(r1.reply_id, w.replier.tenant)?.body).toBe(
        "stays mine",
      );
      const tab = await expectAuthorReplies(
        await w.from.replies.listByAuthor(
          { owner: w.replier.handle },
          w.replier.token,
        ),
      );
      expect(tab.replies).toHaveLength(1);
      expect(tab.replies[0]).toMatchObject({
        reply_id: r1.reply_id,
        post_id: w.post.post_id,
        post_owner_handle: w.owner.handle,
        state: "post_removed",
      });
      expect(tab.replies[0]?.body).toBeUndefined();
      expect(JSON.stringify(tab)).not.toContain("The post");
      // A reply of a removed post is not a live reply.
      await expectProblem(
        await w.from.replies.edit(
          { reply_id: r1.reply_id, body: "revived", revision: 1 },
          w.replier.token,
        ),
        404,
        HubReplyNotFoundError.type,
      );
      await expectProblem(
        await w.from.replies.list(
          { owner: w.owner.handle, post_id: w.post.post_id },
          w.replier.token,
        ),
        404,
        HubPostNotFoundError.type,
      );
      // Its author still removes it from the Replies tab (PST-RPL-011).
      await expectNoContent(
        await w.from.replies.remove({ reply_id: r1.reply_id }, w.replier.token),
      );
      expect(
        hubReplyText(r1.reply_id, w.replier.tenant)?.body ?? null,
      ).toBeNull();
      const after = await expectAuthorReplies(
        await w.from.replies.listByAuthor(
          { owner: w.replier.handle },
          w.replier.token,
        ),
      );
      expect(after.replies).toEqual([]);
      // A repeat is not found.
      await expectProblem(
        await w.from.replies.remove({ reply_id: r1.reply_id }, w.replier.token),
        404,
        HubReplyNotFoundError.type,
      );
    } finally {
      cast.cleanup();
    }
  });

  test(`list-author-replies (${scenario.name}) lists newest first, pages by signed keys, marks a muted author, and reads a remote author`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const r1 = await say(cast, w, w.from.replies, w.replier, "first");
      const r2 = await say(cast, w, w.from.replies, w.replier, "second");
      const r3 = await say(cast, w, w.from.replies, w.replier, "third");
      const list = (user: PostUser, api: HubRepliesAPI, extra = {}) =>
        api.listByAuthor({ owner: w.replier.handle, ...extra }, user.token);

      // The author reads the tab locally; the post owner reads it from the
      // owner's own region, which is remote in the cross-region scenario.
      for (const [user, api] of [
        [w.replier, w.from.replies],
        [w.owner, w.at.replies],
      ] as const) {
        const page = await expectAuthorReplies(
          await list(user, api, { limit: 2 }),
        );
        expect(page.muted).toBe(false);
        expect(page.replies.map((item) => item.reply_id)).toEqual([
          r3.reply_id,
          r2.reply_id,
        ]);
        expect(page.replies[0]).toMatchObject({
          post_id: w.post.post_id,
          post_owner_handle: w.owner.handle,
          body: "third",
          state: "live",
          edited: false,
        });
        const key = page.next_pagination_key;
        if (key === undefined) throw new Error("expected a next key");
        const next = await expectAuthorReplies(
          await list(user, api, { limit: 2, pagination_key: key }),
        );
        expect(next.replies.map((item) => item.reply_id)).toEqual([
          r1.reply_id,
        ]);
        expect(next.next_pagination_key).toBeUndefined();
        await expectProblem(
          await list(user, api, { pagination_key: `${key}x` }),
          400,
          InvalidPaginationKeyError.type,
        );
        // The key belongs to this author's tab.
        await expectProblem(
          await api.listByAuthor(
            { owner: w.owner.handle, pagination_key: key },
            user.token,
          ),
          400,
          InvalidPaginationKeyError.type,
        );
      }
      for (const limit of [0, 51]) {
        await expectProblem(
          await w.from.replies.raw(
            "/posts/list-author-replies",
            { owner: w.replier.handle, limit },
            w.replier.token,
          ),
          400,
          ValidationFailedError.type,
        );
      }
      await expectProblem(
        await w.from.replies.raw(
          "/posts/list-author-replies",
          { owner: "not an address!" },
          w.replier.token,
        ),
        400,
        ValidationFailedError.type,
      );
      await expectProblem(
        await w.from.replies.listByAuthor(
          { owner: unknownHandle() },
          w.replier.token,
        ),
        404,
        ProfileNotFoundError.type,
      );

      // A muted author shows no items; unmuting restores them.
      await expectNoContent(
        await w.at.blocks.mute({ user: w.replier.handle }, w.owner.token),
      );
      expect(
        await expectAuthorReplies(await list(w.owner, w.at.replies)),
      ).toEqual({ replies: [], muted: true });
      await expectNoContent(
        await w.at.blocks.unmute({ user: w.replier.handle }, w.owner.token),
      );
      expect(
        (await expectAuthorReplies(await list(w.owner, w.at.replies))).replies,
      ).toHaveLength(3);
    } finally {
      cast.cleanup();
    }
  });
}

test("reply answers 202 while the post owner's region does not answer, and the same key completes once it does", async ({
  request,
}) => {
  const cast = new Cast(request);
  let owner: PostUser | undefined;
  try {
    const w = await world(cast, request, scenarios[1]!);
    owner = w.owner;
    const key = cast.key(w.replier);
    const send = () =>
      w.from.replies.reply(
        {
          owner: w.owner.handle,
          post_id: w.post.post_id,
          body: "Pending words",
        },
        w.replier.token,
        key,
      );
    // A region that does not answer fails the read and the command at once.
    setHubHome(w.owner.did, "gone");
    try {
      await expectProblem(
        await w.from.replies.list(
          { owner: w.owner.handle, post_id: w.post.post_id },
          w.replier.token,
        ),
        503,
        HubPostUnavailableError.type,
      );
      await expectProblem(
        await w.from.replies.listByAuthor(
          { owner: w.owner.handle },
          w.replier.token,
        ),
        503,
        HubPostUnavailableError.type,
      );
    } finally {
      setHubHome(w.owner.did, w.owner.tenant);
    }
    // A region that does not home the owner leaves the command pending.
    setHubHome(w.owner.did, "deu");
    try {
      const pending = await send();
      expect(pending.status(), await pending.text()).toBe(202);
      expect(pending.headers()["cache-control"]).toBe("no-store");
      expect(
        ((await pending.json()) as { operation_id: string }).operation_id,
      ).toBeTruthy();
    } finally {
      setHubHome(w.owner.did, w.owner.tenant);
    }
    await expect
      .poll(async () => (await send()).status(), {
        timeout: 30_000,
        intervals: [500],
      })
      .toBe(200);
    const seen = await thread(w, w.at.replies, w.owner);
    expect(seen.replies.map((reply) => reply.body)).toEqual(["Pending words"]);
    expect(await replyCount(w)).toBe(1);
  } finally {
    if (owner !== undefined) setHubHome(owner.did, owner.tenant);
    cast.cleanup();
  }
});

test("mesh reply reads serve a verified viewer and refuse an unverified one, bad input, and a missing relay credential", async ({
  request,
  apiCoverage,
}) => {
  const cast = new Cast(request);
  try {
    const w = await world(cast, request, scenarios[0]!);
    const viewer = await cast.user("usa1", "Mesh Viewer");
    const reply = await say(cast, w, w.from.replies, w.replier, "mesh words");
    const sub = await say(
      cast,
      w,
      w.from.replies,
      w.replier,
      "mesh sub",
      reply.reply_id,
    );
    const as = {
      viewer_hub_user_did: viewer.did,
      viewer_handle: viewer.handle,
    };
    const list: MeshListRepliesRequest = {
      owner_hub_user_did: w.owner.did,
      post_id: w.post.post_id,
      ...as,
    };
    const get: MeshGetReplyRequest = {
      owner_hub_user_did: w.owner.did,
      post_id: w.post.post_id,
      reply_id: sub.reply_id,
      ...as,
    };
    const byAuthor: MeshListAuthorRepliesRequest = {
      author_hub_user_did: w.replier.did,
      ...as,
    };
    const requests = [
      ["list-replies", list],
      ["get-reply", get],
      ["list-author-replies", byAuthor],
    ] as const;

    // usa1 homes the viewer, so a call from usa1 to sgp, directly or through
    // usa1's relay, is served.
    for (const [name, body] of requests) {
      const peer = meshPeerRequest("usa1", "sgp", body, apiCoverage, {
        path: `/api/mesh/posts/${name}`,
      });
      expect(peer.status, JSON.stringify(peer.body)).toBe(200);
      const relayed = meshRelayRequest(
        "usa1",
        `/mesh/posts/${name}`,
        body,
        apiCoverage,
      );
      expect(relayed.status, JSON.stringify(relayed.body)).toBe(200);
      expect(relayed.body).toEqual(peer.body);
    }
    const listed = meshPeerRequest("usa1", "sgp", list, apiCoverage, {
      path: "/api/mesh/posts/list-replies",
    }).body as MeshListRepliesResponse;
    expect(listed.replies).toHaveLength(1);
    expect(listed.replies[0]).toMatchObject({
      reply_id: reply.reply_id,
      body: "mesh words",
      author_hub_user_did: w.replier.did,
      child_count: 1,
    });
    const got = meshPeerRequest("usa1", "sgp", get, apiCoverage, {
      path: "/api/mesh/posts/get-reply",
    }).body as MeshGetReplyResponse;
    expect(got).toMatchObject({
      reply_id: sub.reply_id,
      parent_reply_id: reply.reply_id,
      author_hub_user_did: w.replier.did,
      author_tenant_id: "sgp",
      author_handle: w.replier.handle,
      state: "live",
    });
    expect(JSON.stringify(got)).not.toContain("mesh sub");
    const tab = meshPeerRequest("usa1", "sgp", byAuthor, apiCoverage, {
      path: "/api/mesh/posts/list-author-replies",
    }).body as MeshListAuthorRepliesResponse;
    expect(tab.replies.map((item) => item.reply_id)).toEqual([
      sub.reply_id,
      reply.reply_id,
    ]);

    // deu does not home the viewer, so sgp refuses and reveals nothing.
    for (const [name, body] of requests) {
      const stranger = meshPeerRequest("deu", "sgp", body, apiCoverage, {
        path: `/api/mesh/posts/${name}`,
      });
      expect(stranger.status, JSON.stringify(stranger.body)).toBe(404);
      expect(stranger.body).toMatchObject({ type: ProfileNotFoundError.type });
      expect(JSON.stringify(stranger.body)).not.toContain("mesh");
      // A viewer handle that does not match the viewer DID is refused too.
      const mismatch = meshRelayRequest(
        "usa1",
        `/mesh/posts/${name}`,
        { ...body, viewer_handle: unknownHandle() },
        apiCoverage,
      );
      expect(mismatch.status, JSON.stringify(mismatch.body)).toBe(404);
      expect(mismatch.body).toMatchObject({ type: ProfileNotFoundError.type });
    }

    // Missing targets.
    for (const [body, name, type] of [
      [
        { ...list, post_id: missingID },
        "list-replies",
        HubPostNotFoundError.type,
      ],
      [{ ...get, post_id: missingID }, "get-reply", HubPostNotFoundError.type],
      [
        { ...get, reply_id: missingID },
        "get-reply",
        HubReplyNotFoundError.type,
      ],
      [
        { ...byAuthor, author_hub_user_did: randomHubUserDID() },
        "list-author-replies",
        ProfileNotFoundError.type,
      ],
    ] as const) {
      const peer = meshPeerRequest("usa1", "sgp", body, apiCoverage, {
        path: `/api/mesh/posts/${name}`,
      });
      expect(peer.status, JSON.stringify(peer.body)).toBe(404);
      expect(peer.body).toMatchObject({ type });
      const relayed = meshRelayRequest(
        "usa1",
        `/mesh/posts/${name}`,
        body,
        apiCoverage,
      );
      expect(relayed.status, JSON.stringify(relayed.body)).toBe(404);
    }

    for (const [name, valid, invalid] of [
      ["list-replies", list, { ...list, limit: 51 }],
      ["get-reply", get, { ...get, reply_id: "short" }],
      ["list-author-replies", byAuthor, { ...byAuthor, limit: 0 }],
    ] as const) {
      const relayPath = `/mesh/posts/${name}`;
      const peerPath = `/api/mesh/posts/${name}`;
      const relayMalformed = meshRelayRequest(
        "usa1",
        relayPath,
        undefined,
        apiCoverage,
        { rawBody: "{not json" },
      );
      expect(relayMalformed.status).toBe(400);
      expect(relayMalformed.body).toMatchObject({
        type: InvalidJSONError.type,
      });
      const peerMalformed = meshPeerRequest(
        "usa1",
        "sgp",
        undefined,
        apiCoverage,
        { path: peerPath, rawBody: "{not json" },
      );
      expect(peerMalformed.status).toBe(400);
      expect(peerMalformed.body).toMatchObject({ type: InvalidJSONError.type });
      const relayInvalid = meshRelayRequest(
        "usa1",
        relayPath,
        invalid,
        apiCoverage,
      );
      expect(relayInvalid.status).toBe(400);
      expect(relayInvalid.body).toMatchObject({
        type: ValidationFailedError.type,
      });
      const peerInvalid = meshPeerRequest("usa1", "sgp", invalid, apiCoverage, {
        path: peerPath,
      });
      expect(peerInvalid.status).toBe(400);
      expect(peerInvalid.body).toMatchObject({
        type: ValidationFailedError.type,
      });
      for (const authorization of [null, "Bearer wrong"]) {
        const refused = meshRelayRequest(
          "usa1",
          relayPath,
          valid,
          apiCoverage,
          { authorization },
        );
        expect(refused.status, JSON.stringify(refused.body)).toBe(401);
        expect(refused.body).toMatchObject({
          type: "vetchium-problem-details/mesh-relay-authentication-required",
        });
      }
    }
    for (const [name, body] of [
      ["list-replies", list],
      ["list-author-replies", byAuthor],
    ] as const) {
      const bad = { ...body, pagination_key: "not-a-key" };
      const peer = meshPeerRequest("usa1", "sgp", bad, apiCoverage, {
        path: `/api/mesh/posts/${name}`,
      });
      expect(peer.status, JSON.stringify(peer.body)).toBe(400);
      expect(peer.body).toMatchObject({ type: InvalidPaginationKeyError.type });
      const relayed = meshRelayRequest(
        "usa1",
        `/mesh/posts/${name}`,
        bad,
        apiCoverage,
      );
      expect(relayed.status, JSON.stringify(relayed.body)).toBe(400);
    }
  } finally {
    cast.cleanup();
  }
});

// ind1's coordinator link is deliberately broken in CI (config/ci/ind1.json),
// so ind1 cannot verify the viewer and answers unavailable.
test("mesh reply reads report unavailable when the serving tenant cannot reach its directory", async ({
  apiCoverage,
}) => {
  const viewer = {
    viewer_hub_user_did: randomHubUserDID(),
    viewer_handle: unknownHandle(),
  };
  for (const [name, body] of [
    [
      "list-replies",
      {
        ...viewer,
        owner_hub_user_did: randomHubUserDID(),
        post_id: missingID,
      },
    ],
    [
      "get-reply",
      {
        ...viewer,
        owner_hub_user_did: randomHubUserDID(),
        post_id: missingID,
        reply_id: missingID,
      },
    ],
    [
      "list-author-replies",
      { ...viewer, author_hub_user_did: randomHubUserDID() },
    ],
  ] as const) {
    const response = meshPeerRequest("sgp", "ind1", body, apiCoverage, {
      path: `/api/mesh/posts/${name}`,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(503);
    expect(response.body).toMatchObject({ type: ProfileUnavailableError.type });
  }
});
