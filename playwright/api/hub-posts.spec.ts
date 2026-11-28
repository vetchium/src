import { randomUUID } from "node:crypto";
import type {
  MeshGetManyPostsRequest,
  MeshGetManyPostsResponse,
  MeshListPostsRequest,
  MeshListPostsResponse,
} from "typespec/hub/posts/mesh";
import type { Post, PostID } from "typespec/hub/posts/posts";
import { InvalidPaginationKeyError } from "typespec/problem/common";
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
} from "typespec/problem/hub/posts";
import {
  ProfileNotFoundError,
  ProfileUnavailableError,
} from "typespec/problem/hub/profile";
import { PlanRequiredErrorType } from "typespec/problem/hub/subscriptions";
import {
  hubAuditEventsForActor,
  insertHubPosts,
  moveHubPostCreatedAtBack,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { HubAPI } from "../lib/hub-api.ts";
import { HubBlocksAPI } from "../lib/hub-blocks.ts";
import {
  Cast,
  expectList,
  expectPost,
  expectProblem,
  HubPostsAPI,
  type PostOperation,
} from "../lib/hub-posts.ts";
import { meshPeerRequest, meshRelayRequest } from "../lib/mesh.ts";

const allOperations: PostOperation[] = [
  "/posts/create",
  "/posts/edit",
  "/posts/remove",
  "/posts/set-policies",
  "/posts/list",
  "/posts/get",
];

const missingPostID = "0".repeat(20) + "a".repeat(20);

function unknownHandle(): string {
  return `${randomUUID().replaceAll("-", "").slice(0, 8)}-0123456789a`;
}

function randomHubUserDID(): string {
  return `018f7e32-7b5a-7d31-8fd0-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function created(
  api: HubPostsAPI,
  token: string,
  body: string,
): Promise<Post> {
  return expectPost(await api.create({ body }, token), 201);
}

test("create makes a post on Silver, trims the body, keeps inner whitespace, and audits without words", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp", "Poster");
    const first = await expectPost(
      await api.create({ body: "  Hello\n\n  world \t" }, author.token),
      201,
    );
    expect(first).toMatchObject({
      kind: "post",
      body: "Hello\n\n  world",
      reply_policy: "everyone",
      quote_policy: "everyone",
      locked: false,
      reply_count: 0,
      quote_count: 0,
      revision: 1,
      edited: false,
      owner: { handle: author.handle, display_name: "Poster" },
    });
    expect(first.post_id).toMatch(/^[0-9a-v]{20}[0-9a-z]{20}$/);
    expect(first.edited_at).toBeUndefined();

    const second = await expectPost(
      await api.create(
        { body: "Closed", reply_policy: "nobody", quote_policy: "nobody" },
        author.token,
      ),
      201,
    );
    expect(second).toMatchObject({
      reply_policy: "nobody",
      quote_policy: "nobody",
    });

    const events = hubAuditEventsForActor(author.did, "hub.post.created");
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.payload).toEqual({ schema_version: 1, kind: "post" });
      expect(JSON.stringify(event)).not.toContain("Hello");
    }
    expect(events.map((event) => event.entity_id).sort()).toEqual(
      [first.post_id, second.post_id].sort(),
    );
  } finally {
    cast.cleanup();
  }
});

test("create accepts 512 multi-byte code points and refuses 513, empty, blank, and NUL bodies", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp");
    const emoji = "\u{1F600}".repeat(512);
    const accepted = await created(api, author.token, emoji);
    expect([...accepted.body]).toHaveLength(512);
    expect(accepted.body).toBe(emoji);

    const refused: string[] = [
      "",
      "   \n\t ",
      "\u{1F600}".repeat(513),
      "a".repeat(513),
      "bad\u0000body",
    ];
    for (const body of refused) {
      const response = await api.create({ body }, author.token);
      await expectProblem(response, 400, ValidationFailedError.type);
    }
    const listed = await expectList(
      await api.list({ owner: author.handle }, author.token),
    );
    expect(listed.posts).toHaveLength(1);
  } finally {
    cast.cleanup();
  }
});

test("create refuses invalid policies, malformed JSON, and a missing or bad session", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp");
    for (const body of [
      { body: "x", reply_policy: "friends" },
      { body: "x", quote_policy: "" },
      { reply_policy: "everyone" },
      { body: 7 },
    ]) {
      const response = await api.raw("/posts/create", body, author.token);
      expect(response.status(), await response.text()).toBe(400);
    }
    const malformed = await api.rawJSON(
      "/posts/create",
      '{"body":',
      author.token,
    );
    await expectProblem(malformed, 400, InvalidJSONError.type);
    for (const token of [undefined, "not-a-session"]) {
      for (const operation of allOperations) {
        const response = await api.raw(operation, {}, token);
        await expectProblem(response, 401, AuthenticationRequiredError.type);
      }
    }
  } finally {
    cast.cleanup();
  }
});

test("create on the free tier is refused with hub-plan-required and Silver is named", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const free = await cast.user("sgp");
    const response = await api.create({ body: "Hello" }, free.token);
    expect(response.status(), await response.text()).toBe(403);
    expect(await response.json()).toMatchObject({
      type: PlanRequiredErrorType,
      required_plan_oid: "hub-silver-tier",
    });
    const listed = await expectList(
      await api.list({ owner: free.handle }, free.token),
    );
    expect(listed.posts).toEqual([]);
    expect(hubAuditEventsForActor(free.did, "hub.post.created")).toHaveLength(
      0,
    );
  } finally {
    cast.cleanup();
  }
});

test("create returns 429 hub-post-limit-reached after 100 posts in 24 hours and leaves the count unchanged", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp");
    insertHubPosts(author.did, "sgp", 99);
    await created(api, author.token, "The hundredth");
    const refused = await api.create({ body: "One too many" }, author.token);
    await expectProblem(refused, 429, HubPostLimitReachedError.type);
    expect(hubAuditEventsForActor(author.did, "hub.post.created")).toHaveLength(
      1,
    );
    const page = await expectList(
      await api.list({ owner: author.handle, limit: 1 }, author.token),
    );
    expect(page.posts[0]?.body).toBe("The hundredth");
  } finally {
    cast.cleanup();
  }
});

test("edit changes the body, sets edited and revision 2, and audits the revision only", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp");
    const post = await created(api, author.token, "First words");
    const edited = await expectPost(
      await api.edit(
        { post_id: post.post_id, body: "  Second words ", revision: 1 },
        author.token,
      ),
      200,
    );
    expect(edited).toMatchObject({
      post_id: post.post_id,
      body: "Second words",
      revision: 2,
      edited: true,
    });
    expect(edited.edited_at).toBeDefined();
    const events = hubAuditEventsForActor(author.did, "hub.post.edited");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({ schema_version: 1, revision: 2 });
    expect(JSON.stringify(events)).not.toContain("words");

    const read = await expectPost(
      await api.get(
        { owner: author.handle, post_id: post.post_id },
        author.token,
      ),
      200,
    );
    expect(read).toMatchObject({ body: "Second words", edited: true });
  } finally {
    cast.cleanup();
  }
});

test("edit with a stale revision returns hub-post-conflict and keeps the body", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp");
    const post = await created(api, author.token, "Original");
    await expectPost(
      await api.edit(
        { post_id: post.post_id, body: "Changed", revision: 1 },
        author.token,
      ),
      200,
    );
    const stale = await api.edit(
      { post_id: post.post_id, body: "Late", revision: 1 },
      author.token,
    );
    await expectProblem(stale, 409, HubPostConflictError.type);
    const ahead = await api.edit(
      { post_id: post.post_id, body: "Early", revision: 9 },
      author.token,
    );
    await expectProblem(ahead, 409, HubPostConflictError.type);
    const read = await expectPost(
      await api.get(
        { owner: author.handle, post_id: post.post_id },
        author.token,
      ),
      200,
    );
    expect(read).toMatchObject({ body: "Changed", revision: 2 });
  } finally {
    cast.cleanup();
  }
});

test("edit after the 30-minute window returns hub-post-edit-closed, while policies and removal still work", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp");
    const post = await created(api, author.token, "Aging post");
    moveHubPostCreatedAtBack(post.post_id, "sgp", 31);
    const closed = await api.edit(
      { post_id: post.post_id, body: "Too late", revision: 1 },
      author.token,
    );
    await expectProblem(closed, 409, HubPostEditClosedError.type);
    const read = await expectPost(
      await api.get(
        { owner: author.handle, post_id: post.post_id },
        author.token,
      ),
      200,
    );
    expect(read).toMatchObject({ body: "Aging post", revision: 1 });
    const policies = await api.setPolicies(
      {
        post_id: post.post_id,
        reply_policy: "nobody",
        quote_policy: "everyone",
        locked: false,
      },
      author.token,
    );
    expect(policies.status(), await policies.text()).toBe(200);
  } finally {
    cast.cleanup();
  }
});

test("edit, remove, set-policies, and get of another user's post return hub-post-not-found and change nothing", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp");
    const stranger = await cast.silver("sgp");
    const post = await created(api, author.token, "Mine");
    const refusals = [
      await api.edit(
        { post_id: post.post_id, body: "Theirs", revision: 1 },
        stranger.token,
      ),
      await api.remove({ post_id: post.post_id }, stranger.token),
      await api.setPolicies(
        {
          post_id: post.post_id,
          reply_policy: "nobody",
          quote_policy: "nobody",
          locked: true,
        },
        stranger.token,
      ),
      await api.edit(
        { post_id: missingPostID, body: "Nothing", revision: 1 },
        author.token,
      ),
      await api.remove({ post_id: missingPostID }, author.token),
      await api.setPolicies(
        {
          post_id: missingPostID,
          reply_policy: "nobody",
          quote_policy: "nobody",
          locked: true,
        },
        author.token,
      ),
    ];
    for (const response of refusals) {
      await expectProblem(response, 404, HubPostNotFoundError.type);
    }
    // The owner address and the post must match.
    await expectProblem(
      await api.get(
        { owner: stranger.handle, post_id: post.post_id },
        author.token,
      ),
      404,
      HubPostNotFoundError.type,
    );
    const read = await expectPost(
      await api.get(
        { owner: author.handle, post_id: post.post_id },
        stranger.token,
      ),
      200,
    );
    expect(read).toMatchObject({
      body: "Mine",
      revision: 1,
      reply_policy: "everyone",
      locked: false,
    });
  } finally {
    cast.cleanup();
  }
});

test("a downgrade below Silver freezes edits with hub-plan-required, while set-policies and remove still work", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp");
    const frozen = await created(api, author.token, "Frozen soon");
    const removed = await created(api, author.token, "Removed later");
    await cast.downgrade(author);

    const edit = await api.edit(
      { post_id: frozen.post_id, body: "Changed", revision: 1 },
      author.token,
    );
    expect(edit.status(), await edit.text()).toBe(403);
    expect(await edit.json()).toMatchObject({
      type: PlanRequiredErrorType,
      required_plan_oid: "hub-silver-tier",
    });
    const policies = await expectPost(
      await api.setPolicies(
        {
          post_id: frozen.post_id,
          reply_policy: "nobody",
          quote_policy: "nobody",
          locked: true,
        },
        author.token,
      ),
      200,
    );
    expect(policies).toMatchObject({
      body: "Frozen soon",
      reply_policy: "nobody",
      quote_policy: "nobody",
      locked: true,
    });
    const remove = await api.remove({ post_id: removed.post_id }, author.token);
    expect(remove.status(), await remove.text()).toBe(204);
    const create = await api.create({ body: "Again" }, author.token);
    expect(create.status(), await create.text()).toBe(403);
  } finally {
    cast.cleanup();
  }
});

test("remove clears the post, answers hub-post-not-found on get and repeat, drops it from the list, and audits", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp");
    const keep = await created(api, author.token, "Keep");
    const drop = await created(api, author.token, "Drop me");
    const removed = await api.remove({ post_id: drop.post_id }, author.token);
    expect(removed.status(), await removed.text()).toBe(204);
    expect(await removed.text()).toBe("");
    await expectProblem(
      await api.get(
        { owner: author.handle, post_id: drop.post_id },
        author.token,
      ),
      404,
      HubPostNotFoundError.type,
    );
    await expectProblem(
      await api.remove({ post_id: drop.post_id }, author.token),
      404,
      HubPostNotFoundError.type,
    );
    await expectProblem(
      await api.edit(
        { post_id: drop.post_id, body: "Back", revision: 1 },
        author.token,
      ),
      404,
      HubPostNotFoundError.type,
    );
    const listed = await expectList(
      await api.list({ owner: author.handle }, author.token),
    );
    expect(listed.posts.map((post) => post.post_id)).toEqual([keep.post_id]);
    const events = hubAuditEventsForActor(author.did, "hub.post.removed");
    expect(events).toHaveLength(1);
    expect(events[0]?.entity_id).toBe(drop.post_id);
    expect(JSON.stringify(events)).not.toContain("Drop");
    // A removed post still counts against the daily cap, so it cannot be
    // used to post without limit.
    insertHubPosts(author.did, "sgp", 98);
    await expectProblem(
      await api.create({ body: "Over" }, author.token),
      429,
      HubPostLimitReachedError.type,
    );
  } finally {
    cast.cleanup();
  }
});

test("set-policies changes both policies and the lock, audits, and refuses invalid values", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp");
    const post = await created(api, author.token, "Policy post");
    const changed = await expectPost(
      await api.setPolicies(
        {
          post_id: post.post_id,
          reply_policy: "nobody",
          quote_policy: "nobody",
          locked: true,
        },
        author.token,
      ),
      200,
    );
    expect(changed).toMatchObject({
      reply_policy: "nobody",
      quote_policy: "nobody",
      locked: true,
      revision: 1,
      edited: false,
    });
    const reopened = await expectPost(
      await api.setPolicies(
        {
          post_id: post.post_id,
          reply_policy: "everyone",
          quote_policy: "everyone",
          locked: false,
        },
        author.token,
      ),
      200,
    );
    expect(reopened.locked).toBe(false);
    const events = hubAuditEventsForActor(
      author.did,
      "hub.post.policies-changed",
    );
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.payload).sort(byLocked)).toEqual([
      {
        schema_version: 1,
        reply_policy: "everyone",
        quote_policy: "everyone",
        locked: false,
      },
      {
        schema_version: 1,
        reply_policy: "nobody",
        quote_policy: "nobody",
        locked: true,
      },
    ]);
    for (const body of [
      {
        post_id: "short",
        reply_policy: "nobody",
        quote_policy: "nobody",
        locked: false,
      },
      {
        post_id: post.post_id,
        reply_policy: "x",
        quote_policy: "nobody",
        locked: false,
      },
      {
        post_id: post.post_id,
        reply_policy: "nobody",
        quote_policy: "x",
        locked: false,
      },
    ]) {
      await expectProblem(
        await api.raw("/posts/set-policies", body, author.token),
        400,
        ValidationFailedError.type,
      );
    }
    await expectProblem(
      await api.rawJSON("/posts/set-policies", "{", author.token),
      400,
      InvalidJSONError.type,
    );
  } finally {
    cast.cleanup();
  }
});

function byLocked(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  return Number(a.locked) - Number(b.locked);
}

test("edit, remove, and get refuse invalid IDs, revisions, owners, and malformed JSON", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp");
    const post = await created(api, author.token, "Valid");
    const cases: Array<[PostOperation, unknown]> = [
      ["/posts/edit", { post_id: "short", body: "x", revision: 1 }],
      ["/posts/edit", { post_id: post.post_id, body: "", revision: 1 }],
      [
        "/posts/edit",
        { post_id: post.post_id, body: "x".repeat(513), revision: 1 },
      ],
      ["/posts/edit", { post_id: post.post_id, body: "x\u0000", revision: 1 }],
      ["/posts/edit", { post_id: post.post_id, body: "x", revision: 0 }],
      ["/posts/edit", { post_id: post.post_id, body: "x" }],
      ["/posts/remove", { post_id: "UPPERCASE".repeat(5) }],
      ["/posts/remove", {}],
      ["/posts/get", { owner: author.handle, post_id: "short" }],
      ["/posts/get", { owner: "", post_id: post.post_id }],
      ["/posts/get", { post_id: post.post_id }],
    ];
    for (const [operation, body] of cases) {
      await expectProblem(
        await api.raw(operation, body, author.token),
        400,
        ValidationFailedError.type,
      );
    }
    for (const operation of [
      "/posts/edit",
      "/posts/remove",
      "/posts/get",
      "/posts/list",
    ] as const) {
      await expectProblem(
        await api.rawJSON(operation, "{not json", author.token),
        400,
        InvalidJSONError.type,
      );
    }
    // Nothing changed.
    const read = await expectPost(
      await api.get(
        { owner: author.handle, post_id: post.post_id },
        author.token,
      ),
      200,
    );
    expect(read).toMatchObject({ body: "Valid", revision: 1 });
  } finally {
    cast.cleanup();
  }
});

test("list orders newest first, pages by signed keys, and refuses tampered, foreign, and unsigned keys", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp");
    const other = await cast.silver("sgp");
    const viewer = await cast.user("sgp");
    const empty = await expectList(
      await api.list({ owner: author.handle }, viewer.token),
    );
    expect(empty).toEqual({ posts: [], muted: false });

    const ids: PostID[] = [];
    for (const body of ["one", "two", "three"]) {
      ids.push((await created(api, author.token, body)).post_id);
    }
    await created(api, other.token, "Someone else");
    // A removed post stays out of every page.
    const gone = await created(api, author.token, "gone");
    await api.remove({ post_id: gone.post_id }, author.token);

    const first = await expectList(
      await api.list({ owner: author.handle, limit: 2 }, viewer.token),
    );
    expect(first.muted).toBe(false);
    expect(first.posts.map((post) => post.body)).toEqual(["three", "two"]);
    expect(first.posts[0]?.owner.handle).toBe(author.handle);
    const key = first.next_pagination_key;
    expect(key).toBeDefined();
    if (key === undefined) throw new Error("expected a next key");

    const second = await expectList(
      await api.list(
        { owner: author.handle, limit: 2, pagination_key: key },
        viewer.token,
      ),
    );
    expect(second.posts.map((post) => post.body)).toEqual(["one"]);
    expect(second.next_pagination_key).toBeUndefined();

    const all = await expectList(
      await api.list({ owner: author.handle, limit: 50 }, viewer.token),
    );
    expect(all.posts.map((post) => post.post_id)).toEqual([...ids].reverse());

    const foreignKey = (
      await expectList(
        await api.list({ owner: other.handle, limit: 1 }, viewer.token),
      )
    ).next_pagination_key;
    await created(api, other.token, "Someone else, again");
    const foreign = (
      await expectList(
        await api.list({ owner: other.handle, limit: 1 }, viewer.token),
      )
    ).next_pagination_key;
    if (foreign === undefined) throw new Error("expected a foreign key");
    expect(foreignKey).toBeUndefined();

    const [payload = "", signature = ""] = key.split(".");
    const bad: string[] = [
      `${key}x`,
      `${payload}.${signature.slice(1)}A`,
      payload,
      "not-a-key",
      Buffer.from(
        JSON.stringify({ at: "2026-01-01T00:00:00Z", post_id: ids[0] }),
      ).toString("base64url"),
      foreign,
    ];
    for (const pagination_key of bad) {
      await expectProblem(
        await api.list({ owner: author.handle, pagination_key }, viewer.token),
        400,
        InvalidPaginationKeyError.type,
      );
    }
    // A key is valid for the owner it was issued for and for any viewer.
    const reused = await expectList(
      await api.list(
        { owner: author.handle, limit: 2, pagination_key: key },
        other.token,
      ),
    );
    expect(reused.posts.map((post) => post.body)).toEqual(["one"]);
  } finally {
    cast.cleanup();
  }
});

test("list refuses invalid owners, limits, and an unknown profile", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const viewer = await cast.user("sgp");
    for (const body of [
      {},
      { owner: "" },
      { owner: viewer.handle, limit: 0 },
      { owner: viewer.handle, limit: 51 },
      { owner: viewer.handle, pagination_key: "" },
      { owner: viewer.handle, pagination_key: "k".repeat(4097) },
    ]) {
      await expectProblem(
        await api.raw("/posts/list", body, viewer.token),
        400,
        ValidationFailedError.type,
      );
    }
    await expectProblem(
      await api.raw(
        "/posts/list",
        { owner: viewer.handle, limit: 1.5 },
        viewer.token,
      ),
      400,
      InvalidJSONError.type,
    );
    await expectProblem(
      await api.list({ owner: unknownHandle() }, viewer.token),
      404,
      ProfileNotFoundError.type,
    );
    await expectProblem(
      await api.get(
        { owner: unknownHandle(), post_id: missingPostID },
        viewer.token,
      ),
      404,
      HubPostNotFoundError.type,
    );
  } finally {
    cast.cleanup();
  }
});

test("list of a muted owner returns muted true and no posts, and unmuting restores them", async ({
  request,
}) => {
  const cast = new Cast(request);
  const hub = new HubAPI(request, "sgp");
  const api = new HubPostsAPI(hub);
  const blocks = new HubBlocksAPI(hub);
  try {
    const author = await cast.silver("sgp");
    const viewer = await cast.user("sgp");
    await created(api, author.token, "Visible");
    const mute = await blocks.mute({ user: author.handle }, viewer.token);
    expect(mute.status(), await mute.text()).toBe(204);
    expect(
      await expectList(await api.list({ owner: author.handle }, viewer.token)),
    ).toEqual({ posts: [], muted: true });
    // The author sees nothing of the mute.
    const own = await expectList(
      await api.list({ owner: author.handle }, author.token),
    );
    expect(own).toMatchObject({ muted: false });
    expect(own.posts).toHaveLength(1);
    const unmute = await blocks.unmute({ user: author.handle }, viewer.token);
    expect(unmute.status(), await unmute.text()).toBe(204);
    const restored = await expectList(
      await api.list({ owner: author.handle }, viewer.token),
    );
    expect(restored).toMatchObject({ muted: false });
    expect(restored.posts).toHaveLength(1);
  } finally {
    cast.cleanup();
  }
});

test("list and get read a post of a user in another region and page with signed keys", async ({
  request,
}) => {
  const cast = new Cast(request);
  const viewerAPI = new HubPostsAPI(new HubAPI(request, "usa1"));
  const remote = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp", "Remote Poster");
    const viewer = await cast.user("usa1", "Home Viewer");
    const one = await created(remote, author.token, "remote one");
    const two = await created(remote, author.token, "remote two");

    const page = await expectList(
      await viewerAPI.list({ owner: author.handle, limit: 1 }, viewer.token),
    );
    expect(page.posts.map((post) => post.post_id)).toEqual([two.post_id]);
    expect(page.posts[0]?.owner).toMatchObject({
      handle: author.handle,
      display_name: "Remote Poster",
    });
    const key = page.next_pagination_key;
    if (key === undefined) throw new Error("expected a next key");
    const next = await expectList(
      await viewerAPI.list(
        { owner: author.handle, limit: 1, pagination_key: key },
        viewer.token,
      ),
    );
    expect(next.posts.map((post) => post.post_id)).toEqual([one.post_id]);
    expect(next.next_pagination_key).toBeUndefined();
    await expectProblem(
      await viewerAPI.list(
        { owner: author.handle, pagination_key: `${key}x` },
        viewer.token,
      ),
      400,
      InvalidPaginationKeyError.type,
    );

    const read = await expectPost(
      await viewerAPI.get(
        { owner: author.handle, post_id: one.post_id },
        viewer.token,
      ),
      200,
    );
    expect(read).toMatchObject({ body: "remote one", kind: "post" });
    await expectProblem(
      await viewerAPI.get(
        { owner: author.handle, post_id: missingPostID },
        viewer.token,
      ),
      404,
      HubPostNotFoundError.type,
    );
    const removed = await remote.remove({ post_id: one.post_id }, author.token);
    expect(removed.status(), await removed.text()).toBe(204);
    await expectProblem(
      await viewerAPI.get(
        { owner: author.handle, post_id: one.post_id },
        viewer.token,
      ),
      404,
      HubPostNotFoundError.type,
    );

    const blocks = new HubBlocksAPI(new HubAPI(request, "usa1"));
    const mute = await blocks.mute({ user: author.handle }, viewer.token);
    expect(mute.status(), await mute.text()).toBe(204);
    expect(
      await expectList(
        await viewerAPI.list({ owner: author.handle }, viewer.token),
      ),
    ).toEqual({ posts: [], muted: true });
  } finally {
    cast.cleanup();
  }
});

test("mesh post list and get-many serve a verified viewer and refuse an unverified one", async ({
  request,
  apiCoverage,
}) => {
  const cast = new Cast(request);
  const remote = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp", "Mesh Poster");
    const viewer = await cast.user("usa1", "Mesh Viewer");
    const post = await created(remote, author.token, "mesh words");
    const list: MeshListPostsRequest = {
      owner_hub_user_did: author.did,
      viewer_hub_user_did: viewer.did,
      viewer_handle: viewer.handle,
      limit: 1,
    };
    const many: MeshGetManyPostsRequest = {
      viewer_hub_user_did: viewer.did,
      viewer_handle: viewer.handle,
      posts: [
        { owner_hub_user_did: author.did, post_id: post.post_id },
        { owner_hub_user_did: author.did, post_id: missingPostID },
        { owner_hub_user_did: viewer.did, post_id: post.post_id },
      ],
    };
    const peerList = meshPeerRequest("usa1", "sgp", list, apiCoverage, {
      path: "/api/mesh/posts/list",
    });
    expect(peerList.status, JSON.stringify(peerList.body)).toBe(200);
    expect(
      (peerList.body as MeshListPostsResponse).posts.map(
        (item) => item.post_id,
      ),
    ).toEqual([post.post_id]);
    expect((peerList.body as MeshListPostsResponse).posts[0]).toMatchObject({
      owner_hub_user_did: author.did,
      body: "mesh words",
    });

    const peerMany = meshPeerRequest("usa1", "sgp", many, apiCoverage, {
      path: "/api/mesh/posts/get-many",
    });
    expect(peerMany.status, JSON.stringify(peerMany.body)).toBe(200);
    expect(
      (peerMany.body as MeshGetManyPostsResponse).results.map(
        (result) => result.status,
      ),
    ).toEqual(["found", "not-found", "not-homed"]);

    const relayList = meshRelayRequest(
      "usa1",
      "/mesh/posts/list",
      list,
      apiCoverage,
    );
    expect(relayList.status, JSON.stringify(relayList.body)).toBe(200);
    expect((relayList.body as MeshListPostsResponse).posts).toHaveLength(1);
    // The viewer is homed on the relay's tenant: a post of theirs that does
    // not exist is not-found there, not not-homed.
    const relayMany = meshRelayRequest(
      "usa1",
      "/mesh/posts/get-many",
      many,
      apiCoverage,
    );
    expect(relayMany.status, JSON.stringify(relayMany.body)).toBe(200);
    expect(
      (relayMany.body as MeshGetManyPostsResponse).results.map(
        (result) => result.status,
      ),
    ).toEqual(["found", "not-found", "not-found"]);

    // deu does not home the viewer, so sgp refuses and reveals nothing.
    for (const [path, body] of [
      ["/api/mesh/posts/list", list],
      ["/api/mesh/posts/get-many", many],
    ] as const) {
      const stranger = meshPeerRequest("deu", "sgp", body, apiCoverage, {
        path,
      });
      expect(stranger.status, JSON.stringify(stranger.body)).toBe(404);
      expect(stranger.body).toMatchObject({ type: ProfileNotFoundError.type });
      expect(JSON.stringify(stranger.body)).not.toContain("mesh words");
    }
    // A viewer handle that does not match the viewer DID is refused too.
    for (const [path, body] of [
      ["/mesh/posts/list", { ...list, viewer_handle: unknownHandle() }],
      ["/mesh/posts/get-many", { ...many, viewer_handle: unknownHandle() }],
    ] as const) {
      const mismatch = meshRelayRequest("usa1", path, body, apiCoverage);
      expect(mismatch.status, JSON.stringify(mismatch.body)).toBe(404);
      expect(mismatch.body).toMatchObject({ type: ProfileNotFoundError.type });
    }
    // An owner the tenant does not home is not found.
    const unknownOwner = meshPeerRequest(
      "usa1",
      "sgp",
      { ...list, owner_hub_user_did: viewer.did },
      apiCoverage,
      { path: "/api/mesh/posts/list" },
    );
    expect(unknownOwner.status, JSON.stringify(unknownOwner.body)).toBe(404);
    expect(unknownOwner.body).toMatchObject({
      type: ProfileNotFoundError.type,
    });
    const unknownRelay = meshRelayRequest(
      "usa1",
      "/mesh/posts/list",
      { ...list, owner_hub_user_did: randomHubUserDID() },
      apiCoverage,
    );
    expect(unknownRelay.status, JSON.stringify(unknownRelay.body)).toBe(404);
  } finally {
    cast.cleanup();
  }
});

test("mesh post reads reject malformed JSON, invalid fields, bad pagination keys, and a missing relay credential", async ({
  request,
  apiCoverage,
}) => {
  const cast = new Cast(request);
  const remote = new HubPostsAPI(new HubAPI(request, "sgp"));
  try {
    const author = await cast.silver("sgp");
    const viewer = await cast.user("usa1");
    await created(remote, author.token, "x");
    const list: MeshListPostsRequest = {
      owner_hub_user_did: author.did,
      viewer_hub_user_did: viewer.did,
      viewer_handle: viewer.handle,
    };
    const many: MeshGetManyPostsRequest = {
      viewer_hub_user_did: viewer.did,
      viewer_handle: viewer.handle,
      posts: [{ owner_hub_user_did: author.did, post_id: missingPostID }],
    };
    for (const [name, valid, invalid] of [
      ["list", list, { ...list, limit: 51 }],
      ["get-many", many, { ...many, posts: [] }],
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
          {
            authorization,
          },
        );
        expect(refused.status, JSON.stringify(refused.body)).toBe(401);
        expect(refused.body).toMatchObject({
          type: "vetchium-problem-details/mesh-relay-authentication-required",
        });
      }
    }
    const badKey = meshPeerRequest(
      "usa1",
      "sgp",
      { ...list, pagination_key: "not-a-key" },
      apiCoverage,
      { path: "/api/mesh/posts/list" },
    );
    expect(badKey.status, JSON.stringify(badKey.body)).toBe(400);
    expect(badKey.body).toMatchObject({
      type: InvalidPaginationKeyError.type,
    });
    const relayBadKey = meshRelayRequest(
      "usa1",
      "/mesh/posts/list",
      { ...list, pagination_key: "not-a-key" },
      apiCoverage,
    );
    expect(relayBadKey.status, JSON.stringify(relayBadKey.body)).toBe(400);
  } finally {
    cast.cleanup();
  }
});

// ind1's coordinator link is deliberately broken in CI (config/ci/ind1.json),
// so ind1 cannot verify the viewer and answers unavailable.
test("mesh post reads report unavailable when the serving tenant cannot reach its directory", async ({
  apiCoverage,
}) => {
  const viewer = {
    viewer_hub_user_did: randomHubUserDID(),
    viewer_handle: unknownHandle(),
  };
  for (const [path, body] of [
    [
      "/api/mesh/posts/list",
      { ...viewer, owner_hub_user_did: randomHubUserDID() },
    ],
    [
      "/api/mesh/posts/get-many",
      {
        ...viewer,
        posts: [
          { owner_hub_user_did: randomHubUserDID(), post_id: missingPostID },
        ],
      },
    ],
  ] as const) {
    const response = meshPeerRequest("sgp", "ind1", body, apiCoverage, {
      path,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(503);
    expect(response.body).toMatchObject({ type: ProfileUnavailableError.type });
  }
});
