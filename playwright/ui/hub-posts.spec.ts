import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import type { OperationStatus } from "typespec/hub/operations/operations";
import type { Post } from "typespec/hub/posts/posts";
import {
  hubUserDIDForHandle,
  insertHubPosts,
  moveHubPostCreatedAtBack,
} from "../lib/admin-db.ts";
import { HubAPI, hubIdempotencyKey } from "../lib/hub-api.ts";
import { HubBlocksAPI } from "../lib/hub-blocks.ts";
import { expectPost, HubPostsAPI } from "../lib/hub-posts.ts";
import { login } from "../lib/hub-signup.ts";
import { HUB_PORTAL } from "../lib/portals.ts";
import {
  chooseRegion,
  expect,
  type HubTestUser,
  test,
} from "../lib/region-ui.ts";

/** Signs the user in through the portal's own form. */
async function signIn(page: Page, user: HubTestUser): Promise<void> {
  await page.goto(`${HUB_PORTAL}/login`);
  await chooseRegion(page, user.tenant);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/`);
}

interface Session {
  hub: HubAPI;
  token: string;
  posts: HubPostsAPI;
}

/** An API session for the user, to set up and check state outside the page. */
async function session(
  request: APIRequestContext,
  user: HubTestUser,
): Promise<Session> {
  const hub = new HubAPI(request, user.tenant);
  const token = await login(request, user.tenant, user.email, user.password);
  return { hub, token, posts: new HubPostsAPI(hub) };
}

/** Moves the user to Silver, which posting needs (PST-POS-001). */
async function upgrade(user: HubTestUser, s: Session): Promise<void> {
  const key = hubIdempotencyKey();
  user.keys.push(key);
  const response = await s.hub.setSubscriptionPlan(
    { plan_oid: "hub-silver-tier", billing_interval: "month" },
    { token: s.token, idempotencyKey: key },
  );
  expect(response.status(), await response.text()).toBe(200);
}

async function createPost(
  s: Session,
  body: string,
  extra: { reply_policy?: "everyone" | "nobody" } = {},
): Promise<Post> {
  return expectPost(await s.posts.create({ body, ...extra }, s.token), 201);
}

function postURL(address: string, post: Post): string {
  return `${HUB_PORTAL}/u/${address}/posts/${post.post_id}`;
}

async function openPostsTab(page: Page, handle: string): Promise<void> {
  await page.goto(`${HUB_PORTAL}/u/${handle}`);
  await page.getByRole("tab", { name: "Posts" }).click();
}

test("a Silver owner composes a post and sees it on the Posts tab", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  const s = await session(request, me);
  await upgrade(me, s);
  await signIn(page, me);
  await openPostsTab(page, me.handle);

  await expect(page.getByText("No posts yet.")).toBeVisible();
  const words = `Hello ${randomUUID()}\nsecond line`;
  const box = page.getByLabel("Write a post");
  await box.fill(words);
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByText(`Hello ${words.slice(6, 42)}`)).toBeVisible();
  await expect(box).toHaveValue("");
  await expect(page.getByText("No posts yet.")).toHaveCount(0);

  const listed = await s.posts.list({ owner: me.handle }, s.token);
  expect(((await listed.json()) as { posts: Post[] }).posts).toHaveLength(1);
});

test("the counter shows 512 of 512 and the 513th character blocks posting", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  const s = await session(request, me);
  await upgrade(me, s);
  await signIn(page, me);
  await openPostsTab(page, me.handle);

  const box = page.getByLabel("Write a post");
  const submit = page.getByRole("button", { name: "Post", exact: true });
  await expect(submit).toBeDisabled();
  await box.fill("a".repeat(512));
  await expect(page.getByText("512 of 512 characters")).toBeVisible();
  await expect(submit).toBeEnabled();
  await box.fill("a".repeat(513));
  await expect(page.getByText("513 of 512 characters")).toBeVisible();
  await expect(submit).toBeDisabled();

  const listed = await s.posts.list({ owner: me.handle }, s.token);
  expect(((await listed.json()) as { posts: Post[] }).posts).toHaveLength(0);
});

test("the composer shows the limit message after 100 posts in 24 hours", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  const s = await session(request, me);
  await upgrade(me, s);
  insertHubPosts(hubUserDIDForHandle(me.handle, me.tenant), me.tenant, 100);
  await signIn(page, me);
  await openPostsTab(page, me.handle);

  await page.getByLabel("Write a post").fill("One too many");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(
    page.getByText("You reached your limit of posts for today."),
  ).toBeVisible();
  await expect(page.getByText("One too many")).toHaveCount(1);
});

test("a free-tier owner sees the upgrade prompt and no composer", async ({
  page,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  await signIn(page, me);
  await openPostsTab(page, me.handle);

  await expect(page.getByText("Posting needs the Silver plan")).toBeVisible();
  await expect(page.getByRole("link", { name: "View plans" })).toBeVisible();
  await expect(page.getByLabel("Write a post")).toHaveCount(0);
});

test("another user sees the posts but no composer and no owner controls", async ({
  page,
  request,
  hubUser,
}) => {
  const owner = await hubUser("sgp");
  const viewer = await hubUser("sgp");
  const s = await session(request, owner);
  await upgrade(owner, s);
  const post = await createPost(s, `Visible ${randomUUID()}`);
  await signIn(page, viewer);
  await openPostsTab(page, owner.handle);

  await expect(page.getByText(post.body ?? "")).toBeVisible();
  await expect(page.getByLabel("Write a post")).toHaveCount(0);
  await expect(page.getByText("Posting needs the Silver plan")).toHaveCount(0);

  await page.goto(postURL(owner.handle, post));
  await expect(page.getByText(post.body ?? "")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await expect(page.getByText("Replies, quotes, and lock")).toHaveCount(0);
});

test("the owner edits inside the window and the post shows the edited label", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  const s = await session(request, me);
  await upgrade(me, s);
  const post = await createPost(s, `Before ${randomUUID()}`);
  await signIn(page, me);
  await page.goto(postURL(me.handle, post));

  await expect(page.getByText("edited", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const after = `After ${randomUUID()}`;
  await page.getByLabel("Edit your post").fill(after);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(after)).toBeVisible();
  await expect(page.getByText("edited", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Edit your post")).toHaveCount(0);

  const read = await expectPost(
    await s.posts.get({ owner: me.handle, post_id: post.post_id }, s.token),
    200,
  );
  expect(read).toMatchObject({ body: after, edited: true, revision: 2 });
});

test("cancelling an edit keeps the words", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  const s = await session(request, me);
  await upgrade(me, s);
  const post = await createPost(s, `Keep ${randomUUID()}`);
  await signIn(page, me);
  await page.goto(postURL(me.handle, post));

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Edit your post").fill("Changed my mind");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Edit your post")).toHaveCount(0);
  await expect(page.getByText(post.body ?? "")).toBeVisible();
  await expect(page.getByText("edited", { exact: true })).toHaveCount(0);
});

test("a post older than 30 minutes has no Edit button but keeps Remove", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  const s = await session(request, me);
  await upgrade(me, s);
  const post = await createPost(s, `Old ${randomUUID()}`);
  await signIn(page, me);
  await page.goto(postURL(me.handle, post));
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();

  moveHubPostCreatedAtBack(post.post_id, me.tenant, 31);
  await page.reload();
  await expect(page.getByText(post.body ?? "")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
});

test("remove asks for a confirmation, cancel keeps the post, confirm removes it", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  const s = await session(request, me);
  await upgrade(me, s);
  const post = await createPost(s, `Doomed ${randomUUID()}`);
  await signIn(page, me);
  await page.goto(postURL(me.handle, post));

  await page.getByRole("button", { name: "Remove" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove this post?" });
  await expect(dialog).toContainText("You cannot undo this.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  const kept = await s.posts.get(
    { owner: me.handle, post_id: post.post_id },
    s.token,
  );
  expect(kept.status()).toBe(200);

  await page.getByRole("button", { name: "Remove" }).click();
  await page
    .getByRole("dialog", { name: "Remove this post?" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByText("Your post was removed.")).toBeVisible();
  await expect(page).toHaveURL(`${HUB_PORTAL}/u/${me.handle}`);
  const gone = await s.posts.get(
    { owner: me.handle, post_id: post.post_id },
    s.token,
  );
  expect(gone.status()).toBe(404);

  await page.goto(postURL(me.handle, post));
  await expect(page.getByText("Post not found")).toBeVisible();
});

test("the owner saves the reply policy and the lock", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  const s = await session(request, me);
  await upgrade(me, s);
  const post = await createPost(s, `Policy ${randomUUID()}`);
  await signIn(page, me);
  await page.goto(postURL(me.handle, post));

  // The select keeps a hidden copy of each option, so the keyboard picks it.
  await page.getByLabel("Who can reply").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Who can reply")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.getByRole("switch", { name: "Lock the post" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Your changes were saved.")).toBeVisible();
  await expect(page.getByText("locked", { exact: true })).toBeVisible();

  const read = await expectPost(
    await s.posts.get({ owner: me.handle, post_id: post.post_id }, s.token),
    200,
  );
  expect(read).toMatchObject({
    reply_policy: "nobody",
    quote_policy: "everyone",
    locked: true,
  });
});

test("the Posts tab loads 20 posts and Load more adds the rest", async ({
  page,
  request,
  hubUser,
}) => {
  const owner = await hubUser("sgp");
  const viewer = await hubUser("sgp");
  const s = await session(request, owner);
  await upgrade(owner, s);
  insertHubPosts(
    hubUserDIDForHandle(owner.handle, owner.tenant),
    owner.tenant,
    25,
  );
  await signIn(page, viewer);
  await openPostsTab(page, owner.handle);

  const cards = page.getByText(/^Filler \d+$/);
  await expect(cards).toHaveCount(20);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(cards).toHaveCount(25);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("an alias in the post URL redirects to the handle URL", async ({
  page,
  request,
  hubUser,
}) => {
  const owner = await hubUser("sgp");
  const viewer = await hubUser("sgp");
  const s = await session(request, owner);
  await upgrade(owner, s);
  const post = await createPost(s, `Aliased ${randomUUID()}`);
  const alias = `alias-${randomUUID().replaceAll("-", "").slice(0, 18)}`;
  const key = hubIdempotencyKey();
  owner.keys.push(key);
  const claim = await s.hub.setAlias(
    { profile_alias: alias },
    { token: s.token, idempotencyKey: key },
  );
  expect(claim.status(), await claim.text()).toBe(202);
  const operationID = ((await claim.json()) as { operation_id: string })
    .operation_id;
  await expect
    .poll(
      async () =>
        (
          (await (
            await s.hub.operationStatus({ operation_id: operationID }, s.token)
          ).json()) as OperationStatus
        ).state,
      { timeout: 15_000 },
    )
    .toBe("succeeded");

  await signIn(page, viewer);
  await page.goto(postURL(alias, post));
  await expect(page).toHaveURL(postURL(owner.handle, post));
  await expect(page.getByText(post.body ?? "")).toBeVisible();
});

test("an unknown post and a malformed post ID show not found", async ({
  page,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  await signIn(page, me);
  await page.goto(
    `${HUB_PORTAL}/u/${me.handle}/posts/${"0".repeat(20)}${"a".repeat(20)}`,
  );
  await expect(page.getByText("Post not found")).toBeVisible();
  await page.goto(`${HUB_PORTAL}/u/${me.handle}/posts/not-an-id`);
  await expect(page.getByText("Post not found")).toBeVisible();
});

test("a muted owner shows the notice and no posts", async ({
  page,
  request,
  hubUser,
}) => {
  const owner = await hubUser("sgp");
  const viewer = await hubUser("sgp");
  const s = await session(request, owner);
  await upgrade(owner, s);
  const post = await createPost(s, `Muted ${randomUUID()}`);
  const v = await session(request, viewer);
  const blocks = new HubBlocksAPI(v.hub);
  expect((await blocks.mute({ user: owner.handle }, v.token)).status()).toBe(
    204,
  );
  await signIn(page, viewer);
  await openPostsTab(page, owner.handle);

  await expect(page.getByText("You muted this user")).toBeVisible();
  await expect(page.getByText(post.body ?? "")).toHaveCount(0);
});

test("a viewer in another region reads a remote owner's posts and post page", async ({
  page,
  request,
  hubUser,
}) => {
  const owner = await hubUser("sgp", { displayName: "Remote Owner" });
  const viewer = await hubUser("usa1", { residentCountry: "US" });
  const s = await session(request, owner);
  await upgrade(owner, s);
  const post = await createPost(s, `Remote ${randomUUID()}`);
  await signIn(page, viewer);
  await openPostsTab(page, owner.handle);

  await expect(page.getByText(post.body ?? "")).toBeVisible();
  await expect(page.getByText("Remote Owner").first()).toBeVisible();
  await expect(page.getByLabel("Write a post")).toHaveCount(0);
  await page
    .getByRole("link", { name: /ago|now|minute|second/ })
    .first()
    .click();
  await expect(page).toHaveURL(postURL(owner.handle, post));
  await expect(page.getByText(post.body ?? "")).toBeVisible();
});

test("the blocks page shows display names from the profile cards", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await hubUser("sgp");
  const other = await hubUser("sgp", { displayName: "Carded Person" });
  const s = await session(request, me);
  const blocks = new HubBlocksAPI(s.hub);
  expect((await blocks.block({ user: other.handle }, s.token)).status()).toBe(
    204,
  );
  await signIn(page, me);
  await page.goto(`${HUB_PORTAL}/settings/blocks`);

  await expect(
    page.getByRole("link", { name: `@${other.handle}` }),
  ).toBeVisible();
  await expect(page.getByText("Carded Person")).toBeVisible();
});
