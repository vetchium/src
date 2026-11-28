import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import type { Post } from "typespec/hub/posts/posts";
import type { Reply } from "typespec/hub/posts/replies";
import {
  moveHubPostReplyCreatedAtBack,
  moveHubReplyCreatedAtBack,
} from "../lib/admin-db.ts";
import { HubAPI, hubIdempotencyKey } from "../lib/hub-api.ts";
import { HubBlocksAPI } from "../lib/hub-blocks.ts";
import {
  expectAuthorReplies,
  expectNoContent,
  expectPost,
  expectReplies,
  expectReply,
  HubPostsAPI,
  HubRepliesAPI,
  routeTestKeys,
} from "../lib/hub-posts.ts";
import { login } from "../lib/hub-signup.ts";
import { HUB_PORTAL } from "../lib/portals.ts";
import {
  chooseRegion,
  expect,
  type HubTestUser,
  test,
} from "../lib/region-ui.ts";

/** Signs the user in through the portal's own form. The page's reply keys
 * become test keys, so cleanup removes them. */
async function signIn(page: Page, user: HubTestUser): Promise<void> {
  await routeTestKeys(page, user, /\/api\/hub\/posts\/reply$/);
  await page.goto(`${HUB_PORTAL}/login`);
  await chooseRegion(page, user.tenant);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/`);
}

/** A second signed-in browser, for the second viewpoint of one test. */
async function guest(browser: Browser, user: HubTestUser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, user);
  return page;
}

interface Session {
  user: HubTestUser;
  hub: HubAPI;
  token: string;
  /** The user's keys, which cleanup removes. */
  keys: string[];
  posts: HubPostsAPI;
  replies: HubRepliesAPI;
  blocks: HubBlocksAPI;
}

async function session(
  request: ConstructorParameters<typeof HubAPI>[0],
  user: HubTestUser,
): Promise<Session> {
  const hub = new HubAPI(request, user.tenant);
  const token = await login(request, user.tenant, user.email, user.password);
  return {
    user,
    hub,
    token,
    keys: user.keys,
    posts: new HubPostsAPI(hub),
    replies: new HubRepliesAPI(hub),
    blocks: new HubBlocksAPI(hub),
  };
}

async function upgrade(s: Session): Promise<void> {
  const key = hubIdempotencyKey();
  s.user.keys.push(key);
  const response = await s.hub.setSubscriptionPlan(
    { plan_oid: "hub-silver-tier", billing_interval: "month" },
    { token: s.token, idempotencyKey: key },
  );
  expect(response.status(), await response.text()).toBe(200);
}

/** A Silver owner session with one post. */
async function ownerWithPost(
  request: ConstructorParameters<typeof HubAPI>[0],
  user: HubTestUser,
): Promise<{ owner: Session; post: Post }> {
  const owner = await session(request, user);
  await upgrade(owner);
  const post = await expectPost(
    await owner.posts.create({ body: `Post ${randomUUID()}` }, owner),
    201,
  );
  return { owner, post };
}

/** One reply written through the API. */
async function say(
  s: Session,
  owner: Session,
  post: Post,
  body: string,
  parent?: string,
): Promise<Reply> {
  const key = hubIdempotencyKey();
  s.user.keys.push(key);
  return expectReply(
    await s.replies.reply(
      {
        owner: owner.user.handle,
        post_id: post.post_id,
        body,
        ...(parent === undefined ? {} : { parent_reply_id: parent }),
      },
      s.token,
      key,
    ),
    200,
  );
}

function postURL(owner: HubTestUser, post: Post, reply?: string): string {
  const base = `${HUB_PORTAL}/u/${owner.handle}/posts/${post.post_id}`;
  return reply === undefined ? base : `${base}/replies/${reply}`;
}

/** The card of one reply, found by its ID. */
function card(page: Page, reply: Reply) {
  return page.locator(`#reply-${reply.reply_id}`);
}

/** The form that holds the composer textarea with this ID suffix. */
function composer(page: Page, suffix: string) {
  return page
    .locator("form")
    .filter({ has: page.locator(`#reply-body-${suffix}`) });
}

async function threadOf(
  s: Session,
  owner: Session,
  post: Post,
  parent?: string,
) {
  return (
    await expectReplies(
      await s.replies.list(
        {
          owner: owner.user.handle,
          post_id: post.post_id,
          ...(parent === undefined ? {} : { parent_reply_id: parent }),
        },
        s.token,
      ),
    )
  ).replies;
}

test("a reply and a sub-reply appear, and a sub-reply has no Reply button", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  const replier = await session(request, replierUser);
  await signIn(page, replierUser);
  await page.goto(postURL(ownerUser, post));

  await expect(page.getByText("No replies yet.")).toBeVisible();
  const first = `First ${randomUUID()}`;
  await page.locator("#reply-body-post").fill(first);
  await composer(page, "post").getByRole("button", { name: "Reply" }).click();
  await expect(page.getByText(first)).toBeVisible();
  await expect(page.locator("#reply-body-post")).toHaveValue("");
  await expect(page.getByText("No replies yet.")).toHaveCount(0);

  const [top] = await threadOf(replier, owner, post);
  const parent = card(page, top!);
  await parent.getByRole("button", { name: "Reply", exact: true }).click();
  const second = `Second ${randomUUID()}`;
  await page.locator(`#reply-body-${top!.reply_id}`).fill(second);
  await composer(page, top!.reply_id)
    .getByRole("button", { name: "Reply" })
    .click();
  await expect(page.getByText(second)).toBeVisible();
  await expect(
    parent.getByRole("button", { name: "Hide replies" }),
  ).toBeVisible();

  const [sub] = await threadOf(replier, owner, post, top!.reply_id);
  expect(sub!.body).toBe(second);
  await expect(
    card(page, sub!).getByRole("button", { name: "Reply", exact: true }),
  ).toHaveCount(0);
});

test("a locked post and a nobody policy hide the composer", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  await signIn(page, replierUser);
  await page.goto(postURL(ownerUser, post));
  await expect(page.locator("#reply-body-post")).toBeVisible();

  for (const [reply_policy, locked] of [
    ["everyone", true],
    ["nobody", false],
  ] as const) {
    await expectPost(
      await owner.posts.setPolicies(
        {
          post_id: post.post_id,
          reply_policy,
          quote_policy: "everyone",
          locked,
        },
        owner.token,
      ),
      200,
    );
    await page.reload();
    await expect(
      page.getByText("Replies to this post are closed."),
    ).toBeVisible();
    await expect(page.locator("#reply-body-post")).toHaveCount(0);
  }
});

test("a replier the owner blocked sees the refusal", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  expect(
    (
      await owner.blocks.block({ user: replierUser.handle }, owner.token)
    ).status(),
  ).toBe(204);
  await signIn(page, replierUser);
  await page.goto(postURL(ownerUser, post));

  const words = `Blocked ${randomUUID()}`;
  await page.locator("#reply-body-post").fill(words);
  await composer(page, "post").getByRole("button", { name: "Reply" }).click();
  await expect(page.getByText("You cannot reply here.")).toBeVisible();
  await expect(page.getByText(words, { exact: true })).toHaveCount(1);
  expect(
    await threadOf(await session(request, replierUser), owner, post),
  ).toEqual([]);
});

test("Load more adds the 21st top-level reply", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  const replier = await session(request, replierUser);
  for (let n = 1; n <= 21; n++) await say(replier, owner, post, `Top ${n}`);
  await signIn(page, replierUser);
  await page.goto(postURL(ownerUser, post));

  const tops = page.getByText(/^Top \d+$/);
  await expect(tops).toHaveCount(20);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(tops).toHaveCount(21);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("Load more pages the sub-replies of one reply", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  const replier = await session(request, replierUser);
  const top = await say(replier, owner, post, "Parent");
  for (let n = 1; n <= 21; n++) {
    await say(replier, owner, post, `Sub ${n}`, top.reply_id);
  }
  await signIn(page, replierUser);
  await page.goto(postURL(ownerUser, post));

  await expect(page.getByText(/^Sub \d+$/)).toHaveCount(0);
  await page.getByRole("button", { name: "Show 21 replies" }).click();
  const subs = page.getByText(/^Sub \d+$/);
  await expect(subs).toHaveCount(20);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(subs).toHaveCount(21);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  await page.getByRole("button", { name: "Hide replies" }).click();
  await expect(subs).toHaveCount(0);
});

test("a removed reply with sub-replies shows a placeholder and keeps the sub-replies", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const viewerUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  const replier = await session(request, replierUser);
  const viewer = await session(request, viewerUser);
  const top = await say(replier, owner, post, `Gone ${randomUUID()}`);
  const sub = await say(viewer, owner, post, "Still here", top.reply_id);
  await expectNoContent(
    await replier.replies.remove({ reply_id: top.reply_id }, replier.token),
  );
  await signIn(page, viewerUser);
  await page.goto(postURL(ownerUser, post));

  await expect(page.getByText("This reply is not available")).toBeVisible();
  await expect(page.getByText(top.body ?? "")).toHaveCount(0);
  await page.getByRole("button", { name: "Show 1 reply" }).click();
  await expect(card(page, sub).getByText("Still here")).toBeVisible();
});

test("the owner hides a reply with no sub-replies, still sees it, and unhides it", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  const replier = await session(request, replierUser);
  const reply = await say(replier, owner, post, `Words ${randomUUID()}`);
  await signIn(page, ownerUser);
  await page.goto(postURL(ownerUser, post));
  const shown = card(page, reply);

  await expect(shown.getByText("Hidden", { exact: true })).toHaveCount(0);
  await shown.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(shown.getByText("Hidden", { exact: true })).toBeVisible();
  await expect(shown.getByText(reply.body ?? "")).toBeVisible();
  await expect(
    shown.getByRole("button", { name: "Hide", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(shown.getByText(reply.body ?? "")).toBeVisible();
  await expect(shown.getByText("Hidden", { exact: true })).toBeVisible();

  await shown.getByRole("button", { name: "Unhide" }).click();
  await expect(shown.getByText("Hidden", { exact: true })).toHaveCount(0);
  await expect(
    shown.getByRole("button", { name: "Hide", exact: true }),
  ).toBeVisible();
  expect((await threadOf(replier, owner, post)).map((r) => r.state)).toEqual([
    "live",
  ]);
});

test("a hidden reply shows its author the label and no controls, and a third user nothing", async ({
  page,
  browser,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const thirdUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  const replier = await session(request, replierUser);
  const reply = await say(replier, owner, post, `Mine ${randomUUID()}`);
  await expectNoContent(
    await owner.replies.hide(
      { post_id: post.post_id, reply_id: reply.reply_id },
      owner.token,
    ),
  );
  await signIn(page, replierUser);
  await page.goto(postURL(ownerUser, post));

  const own = card(page, reply);
  await expect(own.getByText(reply.body ?? "")).toBeVisible();
  await expect(own.getByText("Hidden by the post author")).toBeVisible();
  await expect(own.getByRole("button", { name: "Unhide" })).toHaveCount(0);
  await expect(own.getByRole("button", { name: "Remove" })).toBeVisible();

  const other = await guest(browser, thirdUser);
  try {
    await other.goto(postURL(ownerUser, post));
    await expect(other.getByText("No replies yet.")).toBeVisible();
    await expect(other.getByText(reply.body ?? "")).toHaveCount(0);
  } finally {
    await other.context().close();
  }
});

test("the author edits inside the window and has no Edit button after it", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  const replier = await session(request, replierUser);
  const reply = await say(replier, owner, post, `Before ${randomUUID()}`);
  await signIn(page, replierUser);
  await page.goto(postURL(ownerUser, post));
  const mine = card(page, reply);

  await expect(mine.getByText("edited", { exact: true })).toHaveCount(0);
  await mine.getByRole("button", { name: "Edit", exact: true }).click();
  await mine.getByLabel("Edit your reply").fill("   ");
  await expect(
    mine.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  const after = `After ${randomUUID()}`;
  await mine.getByLabel("Edit your reply").fill(after);
  await mine.getByRole("button", { name: "Save changes" }).click();
  await expect(mine.getByText(after)).toBeVisible();
  await expect(mine.getByText("edited", { exact: true })).toBeVisible();
  await expect(mine.getByLabel("Edit your reply")).toHaveCount(0);

  await mine.getByRole("button", { name: "Edit", exact: true }).click();
  await mine.getByLabel("Edit your reply").fill("Changed my mind");
  await mine.getByRole("button", { name: "Cancel" }).click();
  await expect(mine.getByText(after)).toBeVisible();

  moveHubReplyCreatedAtBack(reply.reply_id, replierUser.tenant, 31);
  moveHubPostReplyCreatedAtBack(reply.reply_id, ownerUser.tenant, 31);
  await page.reload();
  await expect(mine.getByText(after)).toBeVisible();
  await expect(mine.getByRole("button", { name: "Remove" })).toBeVisible();
  await expect(
    mine.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
});

test("remove asks for a confirmation, cancel keeps the reply, confirm removes it", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  const replier = await session(request, replierUser);
  const reply = await say(replier, owner, post, `Doomed ${randomUUID()}`);
  await signIn(page, replierUser);
  await page.goto(postURL(ownerUser, post));
  const mine = card(page, reply);

  await mine.getByRole("button", { name: "Remove" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove this reply?" });
  await expect(dialog).toContainText("You cannot undo this.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(mine.getByText(reply.body ?? "")).toBeVisible();
  expect(await threadOf(replier, owner, post)).toHaveLength(1);

  await mine.getByRole("button", { name: "Remove" }).click();
  await page
    .getByRole("dialog", { name: "Remove this reply?" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByText("Your reply was removed.")).toBeVisible();
  await expect(page.getByText(reply.body ?? "")).toHaveCount(0);
  // The owner's tenant learns of the removal a moment later.
  await expect
    .poll(async () => (await threadOf(replier, owner, post)).length, {
      timeout: 30_000,
      intervals: [250],
    })
    .toBe(0);
});

test("the names arrive after the handles", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp", { displayName: "Slow Name" });
  const { owner, post } = await ownerWithPost(request, ownerUser);
  const replier = await session(request, replierUser);
  const reply = await say(replier, owner, post, `Words ${randomUUID()}`);
  await signIn(page, ownerUser);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/profile\/read-cards$/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(postURL(ownerUser, post));

  const shown = card(page, reply);
  await expect(shown.getByText(reply.body ?? "")).toBeVisible();
  await expect(shown.getByText(`@${replierUser.handle}`)).toBeVisible();
  await expect(shown.getByText("Slow Name")).toHaveCount(0);
  release();
  await expect(shown.getByText("Slow Name")).toBeVisible();
});

test("a reply link opens the thread at its sub-reply and highlights it", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  const replier = await session(request, replierUser);
  for (let n = 1; n <= 3; n++) await say(replier, owner, post, `Filler ${n}`);
  const top = await say(replier, owner, post, "Parent of the target");
  const sub = await say(
    replier,
    owner,
    post,
    `Target ${randomUUID()}`,
    top.reply_id,
  );
  await signIn(page, ownerUser);
  await page.goto(postURL(ownerUser, post, sub.reply_id));

  await expect(page.getByText(sub.body ?? "")).toBeVisible();
  await expect(
    card(page, top).getByRole("button", { name: "Hide replies" }),
  ).toBeVisible();
  await expect(card(page, sub)).toBeInViewport();
  await expect(card(page, sub).locator(".ant-card").first()).toHaveAttribute(
    "style",
    /border-color/,
  );
  await expect(
    card(page, top).locator(".ant-card").first(),
  ).not.toHaveAttribute("style", /border-color/);
});

test("a reply link to a reply that is gone says so", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const { post } = await ownerWithPost(request, ownerUser);
  await signIn(page, ownerUser);
  await page.goto(postURL(ownerUser, post, "0".repeat(20) + "a".repeat(20)));

  await expect(page.getByText("This reply is not available.")).toBeVisible();
});

test("a reply link beyond the first page opens the thread at it", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  const replier = await session(request, replierUser);
  for (let n = 1; n <= 21; n++) await say(replier, owner, post, `Top ${n}`);
  const target = await say(replier, owner, post, `Target ${randomUUID()}`);
  await signIn(page, ownerUser);
  // The page reads one page that starts at the reply, not the whole thread.
  const lists: unknown[] = [];
  page.on("request", (sent) => {
    if (sent.url().endsWith("/api/hub/posts/list-replies")) {
      lists.push(sent.postDataJSON());
    }
  });
  await page.goto(postURL(ownerUser, post, target.reply_id));

  await expect(card(page, target)).toBeInViewport();
  await expect(page.getByText("Top 1", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("You see the replies from the linked reply."),
  ).toBeVisible();
  expect(lists).toEqual([
    expect.objectContaining({ from_reply_id: target.reply_id }),
  ]);

  await page.getByRole("link", { name: "Show all replies" }).click();
  await expect(page).toHaveURL(postURL(ownerUser, post));
  await expect(page.getByText("Top 1", { exact: true })).toBeVisible();
  await expect(card(page, target)).toHaveCount(0);
});

test("a reply that stays pending shows that the region has not answered", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const { post } = await ownerWithPost(request, ownerUser);
  await page.clock.install();
  await signIn(page, replierUser);
  // The owner's tenant does not answer: the reply stays pending.
  const operation = randomUUID();
  await page.route(/\/api\/hub\/posts\/reply$/, (route) =>
    route.fulfill({ status: 202, json: { operation_id: operation } }),
  );
  await page.route(/\/api\/hub\/operations\/status$/, (route) =>
    route.fulfill({
      status: 200,
      json: { operation_id: operation, state: "pending" },
    }),
  );
  await page.goto(postURL(ownerUser, post));

  await page.locator("#reply-body-post").fill(`Pending ${randomUUID()}`);
  await composer(page, "post").getByRole("button", { name: "Reply" }).click();
  const notice = page.getByText(
    "The region of the post author has not answered yet.",
    { exact: false },
  );
  // Each poll waits one second; the page gives up after 30 polls.
  await expect(async () => {
    await page.clock.fastForward(1_000);
    await expect(notice).toBeVisible({ timeout: 100 });
  }).toPass({ timeout: 25_000, intervals: [0] });
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.locator("#reply-body-post")).not.toHaveValue("");
});

test("the author removes a reply from the Replies tab, also after the post was removed", async ({
  page,
  browser,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  const kept = await expectPost(
    await owner.posts.create({ body: "Kept post" }, owner),
    201,
  );
  const replier = await session(request, replierUser);
  const onKept = await say(replier, owner, kept, `Kept ${randomUUID()}`);
  const onGone = await say(replier, owner, post, `Gone ${randomUUID()}`);
  await expectNoContent(
    await owner.posts.remove({ post_id: post.post_id }, owner.token),
  );
  // Post cleanup tells the author's tenant after the removal commits.
  await expect
    .poll(
      async () => {
        const listed = await expectAuthorReplies(
          await replier.replies.listByAuthor(
            { owner: replierUser.handle },
            replier.token,
          ),
        );
        return listed.replies.find((r) => r.reply_id === onGone.reply_id)
          ?.state;
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe("post_removed");

  // Another viewer sees the context but no Remove.
  const viewer = await guest(browser, ownerUser);
  try {
    await viewer.goto(`${HUB_PORTAL}/u/${replierUser.handle}`);
    await viewer.getByRole("tab", { name: "Replies" }).click();
    await expect(
      viewer.getByRole("link", {
        name: `Reply to a post by @${ownerUser.handle}`,
      }),
    ).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Remove" })).toHaveCount(0);
  } finally {
    await viewer.context().close();
  }

  await signIn(page, replierUser);
  await page.goto(`${HUB_PORTAL}/u/${replierUser.handle}`);
  await page.getByRole("tab", { name: "Replies" }).click();
  for (const marker of ["The post was removed", onKept.body ?? ""]) {
    const item = page.locator(".ant-card").filter({ hasText: marker });
    await expect(item).toHaveCount(1);
    await item.getByRole("button", { name: "Remove" }).click();
    await page
      .getByRole("dialog", { name: "Remove this reply?" })
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(item).toHaveCount(0);
  }
  await expect(page.getByText("No replies yet.")).toBeVisible();
  const left = await expectAuthorReplies(
    await replier.replies.listByAuthor(
      { owner: replierUser.handle },
      replier.token,
    ),
  );
  expect(left.replies).toEqual([]);
});

test("the Replies tab lists the replies and marks one whose post was removed", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const viewerUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  const kept = await expectPost(
    await owner.posts.create({ body: "Kept post" }, owner),
    201,
  );
  const replier = await session(request, replierUser);
  const onKept = await say(replier, owner, kept, `Kept ${randomUUID()}`);
  const onGone = await say(replier, owner, post, `Gone ${randomUUID()}`);
  await expectNoContent(
    await owner.posts.remove({ post_id: post.post_id }, owner.token),
  );
  await signIn(page, viewerUser);
  await page.goto(`${HUB_PORTAL}/u/${replierUser.handle}`);
  await page.getByRole("tab", { name: "Replies" }).click();

  await expect(page.getByText(onKept.body ?? "")).toBeVisible();
  await expect(page.getByText("The post was removed")).toBeVisible();
  const listed = page
    .locator(".ant-card")
    .filter({ hasText: "The post was removed" });
  await expect(listed).toHaveCount(1);
  await expect(listed.getByRole("link")).toHaveCount(0);
  expect(onGone.body).toBeDefined();
  await page
    .locator(".ant-card")
    .filter({ hasText: onKept.body ?? "" })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(postURL(ownerUser, kept, onKept.reply_id));
});

test("a muted replier shows the notice on the Replies tab", async ({
  page,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp");
  const replierUser = await hubUser("sgp");
  const viewerUser = await hubUser("sgp");
  const { owner, post } = await ownerWithPost(request, ownerUser);
  const replier = await session(request, replierUser);
  const reply = await say(replier, owner, post, `Muted ${randomUUID()}`);
  const viewer = await session(request, viewerUser);
  expect(
    (
      await viewer.blocks.mute({ user: replierUser.handle }, viewer.token)
    ).status(),
  ).toBe(204);
  await signIn(page, viewerUser);
  await page.goto(`${HUB_PORTAL}/u/${replierUser.handle}`);
  await page.getByRole("tab", { name: "Replies" }).click();

  await expect(page.getByText("You muted this user")).toBeVisible();
  await expect(page.getByText(reply.body ?? "")).toHaveCount(0);
});

test("a replier in another region replies from the portal and the owner sees the reply", async ({
  page,
  browser,
  request,
  hubUser,
}) => {
  const ownerUser = await hubUser("sgp", { displayName: "Remote Owner" });
  const replierUser = await hubUser("usa1", {
    displayName: "Remote Replier",
    residentCountry: "US",
  });
  const { owner, post } = await ownerWithPost(request, ownerUser);
  await signIn(page, replierUser);
  await page.goto(postURL(ownerUser, post));

  const words = `Across ${randomUUID()}`;
  await page.locator("#reply-body-post").fill(words);
  await composer(page, "post").getByRole("button", { name: "Reply" }).click();
  await expect(page.getByText(words)).toBeVisible();
  await expect(page.getByText("Remote Replier").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();

  const seen = await guest(browser, ownerUser);
  try {
    await seen.goto(postURL(ownerUser, post));
    await expect(seen.getByText(words)).toBeVisible();
    await expect(seen.getByText("Remote Replier").first()).toBeVisible();
    await expect(
      seen.getByRole("button", { name: "Hide", exact: true }),
    ).toBeVisible();
  } finally {
    await seen.context().close();
  }
  const [stored] = await threadOf(
    await session(request, ownerUser),
    owner,
    post,
  );
  expect(stored!.body).toBe(words);
});
