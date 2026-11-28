import { randomUUID } from "node:crypto";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type { Post } from "typespec/hub/posts/posts";
import type { Reply } from "typespec/hub/posts/replies";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { HubAPI, hubIdempotencyKey } from "../lib/hub-api.ts";
import {
  expectPost,
  expectReply,
  HubPostsAPI,
  HubQuotesAPI,
  HubRepliesAPI,
  routeTestKeys,
} from "../lib/hub-posts.ts";
import { login } from "../lib/hub-signup.ts";
import { loginOrg, OrgsAPI } from "../lib/orgs-api.ts";
import { HUB_PORTAL } from "../lib/portals.ts";
import {
  chooseRegion,
  expect,
  type HubTestUser,
  test,
} from "../lib/region-ui.ts";

// Journey tests (ux.md, "Reachability"): each test starts on Home after
// sign-in and reaches a posts screen only by clicks. No test here opens a
// screen by URL.

async function signIn(page: Page, user: HubTestUser): Promise<void> {
  await routeTestKeys(
    page,
    user,
    /\/api\/hub\/posts\/(create|create-quote|reply)$/,
  );
  await page.goto(`${HUB_PORTAL}/login`);
  await chooseRegion(page, user.tenant);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/`);
}

interface Session {
  user: HubTestUser;
  hub: HubAPI;
  token: string;
  keys: string[];
  posts: HubPostsAPI;
  replies: HubRepliesAPI;
  quotes: HubQuotesAPI;
}

async function session(
  request: APIRequestContext,
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
    quotes: new HubQuotesAPI(hub),
  };
}

async function upgrade(s: Session): Promise<void> {
  const key = hubIdempotencyKey();
  s.keys.push(key);
  const response = await s.hub.setSubscriptionPlan(
    { plan_oid: "hub-silver-tier", billing_interval: "month" },
    { token: s.token, idempotencyKey: key },
  );
  expect(response.status(), await response.text()).toBe(200);
}

async function createPost(s: Session, body: string): Promise<Post> {
  return expectPost(await s.posts.create({ body }, s), 201);
}

async function replyTo(s: Session, post: Post, body: string): Promise<Reply> {
  const key = hubIdempotencyKey();
  s.keys.push(key);
  return expectReply(
    await s.replies.reply(
      { owner: post.owner.handle, post_id: post.post_id, body },
      s.token,
      key,
    ),
    200,
  );
}

/** Counts settle after events reach the owner's tenant. */
async function awaitCount(
  s: Session,
  post: Post,
  field: "reply_count" | "quote_count",
  count: number,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (
          await expectPost(
            await s.posts.get(
              { owner: post.owner.handle, post_id: post.post_id },
              s.token,
            ),
            200,
          )
        )[field],
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(count);
}

/** A sidebar entry. Its accessible name starts with the icon's label. */
function navigation(page: Page, name: string): Locator {
  return page.getByRole("menuitem", { name: new RegExp(`(^| )${name}$`) });
}

async function openTimeline(page: Page): Promise<void> {
  await navigation(page, "Timeline").click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/timeline`);
  await expect(
    page.getByRole("heading", { name: "Timeline", level: 1 }),
  ).toBeVisible();
}

/** Ant Design marks the selected sidebar entry only with a class. */
async function expectSelected(page: Page, name: string): Promise<void> {
  await expect(navigation(page, name)).toHaveClass(/ant-menu-item-selected/);
}

test.describe.configure({ timeout: 90_000 });

test("a Silver user posts from the sidebar Timeline and opens the post", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await session(request, await hubUser("sgp"));
  await upgrade(me);
  await signIn(page, me.user);
  await openTimeline(page);
  await expect(page).toHaveTitle("Timeline | Vetchium");
  await expectSelected(page, "Timeline");
  await expect(page.getByText("No posts yet.")).toBeVisible();

  const words = `Timeline post ${randomUUID()}`;
  await page.getByLabel("Write a post").fill(words);
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const card = page.locator(".ant-card").filter({ hasText: words });
  await expect(card).toBeVisible();

  await card.getByRole("link", { name: /now|second|minute|ago/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/u/${me.user.handle}/posts/[0-9a-z]{40}$`),
  );
  await expect(
    page.getByRole("heading", {
      name: `Post by ${me.user.displayName}`,
      level: 1,
    }),
  ).toBeVisible();
  await expectSelected(page, "Timeline");

  await page
    .getByRole("link", { name: me.user.displayName, exact: true })
    .click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/u/${me.user.handle}?tab=posts`);
  await expect(page.getByRole("tab", { name: "Posts" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText(words)).toBeVisible();
  await expectSelected(page, "Timeline");
});

test("a free-tier user opens Timeline and follows the upgrade prompt to Plan", async ({
  page,
  hubUser,
}) => {
  await signIn(page, await hubUser("sgp"));
  await openTimeline(page);

  await expect(page.getByText("Posting needs the Silver plan")).toBeVisible();
  await expect(page.getByLabel("Write a post")).toHaveCount(0);
  await page.getByRole("link", { name: "View plans" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/plan`);
});

test("Timeline opens the own Replies tab, and the URL keeps the tab", async ({
  page,
  request,
  hubUser,
}) => {
  const owner = await session(request, await hubUser("sgp"));
  await upgrade(owner);
  const post = await createPost(owner, `Asked ${randomUUID()}`);
  const me = await session(request, await hubUser("sgp"));
  const reply = await replyTo(me, post, `Answered ${randomUUID()}`);
  await signIn(page, me.user);
  await openTimeline(page);

  await page.getByRole("link", { name: "See your replies" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/u/${me.user.handle}?tab=replies`);
  const repliesTab = page.getByRole("tab", { name: "Replies" });
  await expect(repliesTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(reply.body ?? "")).toBeVisible();

  await page.reload();
  await expect(repliesTab).toHaveAttribute("aria-selected", "true");

  await page
    .getByRole("link", { name: `Reply to a post by @${owner.user.handle}` })
    .click();
  await expect(page).toHaveURL(
    `${HUB_PORTAL}/u/${owner.user.handle}/posts/${post.post_id}/replies/${reply.reply_id}`,
  );
  await page.goBack();
  await expect(repliesTab).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: "Profile" }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/u/${me.user.handle}`);
});

test("a post owner reaches a replier from the thread, blocks them, and finds them in Blocks and mutes", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await session(request, await hubUser("sgp"));
  await upgrade(me);
  const post = await createPost(me, `Thread ${randomUUID()}`);
  const replier = await session(request, await hubUser("sgp"));
  await replyTo(replier, post, `Reply ${randomUUID()}`);
  await awaitCount(me, post, "reply_count", 1);
  await signIn(page, me.user);
  await openTimeline(page);

  await page.getByRole("link", { name: "1 reply" }).click();
  await page.getByRole("link", { name: `@${replier.user.handle}` }).click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/u/${replier.user.handle}`);
  // Another user's profile belongs to no sidebar entry.
  await expect(
    page.locator('[role="menuitem"].ant-menu-item-selected'),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "User actions" }).click();
  await page.getByRole("menuitem", { name: "Block", exact: true }).click();
  await page
    .getByRole("dialog", { name: `Block @${replier.user.handle}?` })
    .getByRole("button", { name: "Block" })
    .click();
  await expect(
    page.getByText(`You blocked @${replier.user.handle}.`),
  ).toBeVisible();

  await navigation(page, "Blocks and mutes").click();
  await expect(page).toHaveURL(`${HUB_PORTAL}/settings/blocks`);
  await expect(
    page.getByRole("link", { name: `@${replier.user.handle}` }),
  ).toBeVisible();
});

test("the quote count on a Timeline post opens its quotes", async ({
  page,
  request,
  hubUser,
}) => {
  const me = await session(request, await hubUser("sgp"));
  await upgrade(me);
  const post = await createPost(me, `Quotable ${randomUUID()}`);
  const quoter = await session(request, await hubUser("sgp"));
  const words = `Quoted ${randomUUID()}`;
  expectPost(
    await quoter.quotes.create(
      {
        target: {
          type: "timeline_post",
          owner: me.user.handle,
          post_id: post.post_id,
        },
        body: words,
      },
      quoter,
    ),
    201,
  );
  await awaitCount(me, post, "quote_count", 1);
  await signIn(page, me.user);
  await openTimeline(page);

  await page.getByRole("link", { name: "1 quote" }).click();
  await expect(page).toHaveURL(
    `${HUB_PORTAL}/u/${me.user.handle}/posts/${post.post_id}/quotes`,
  );
  await expect(page.getByText(words)).toBeVisible();
});

test("a user quotes an Opening found from the sidebar Openings and sees the quote on Timeline", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  const local = await org("sgp");
  const api = new OrgsAPI(request, "sgp");
  const orgToken = await loginOrg(api, local);
  const title = `Journey${randomUUID().slice(0, 8)} analyst`;
  const content: OpeningContent = {
    title,
    description: "Analyse hiring data",
    language: "en",
    employing_country: "SG",
    work_arrangement: "hybrid",
    employment_type: "full_time",
    positions: 1,
  };
  const created = await api.createOpening(orgToken, {
    content,
    hiring_manager_email: local.emailAddress,
    recruiter_email: local.emailAddress,
    team_member_emails: [],
  });
  expect(created.status(), await created.text()).toBe(201);
  const draft = (await created.json()) as OrgOpening;
  const published = await api.requestOpeningChange(orgToken, {
    opening_number: draft.opening_number,
    version: draft.version,
    kind: "publish",
  });
  expect(published.status(), await published.text()).toBe(200);

  await signIn(page, await hubUser("sgp"));
  await navigation(page, "Openings").click();
  await page
    .getByRole("searchbox", { name: "Keyword" })
    .fill(title.split(" ")[0] ?? title);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(
    `${HUB_PORTAL}/org/${local.domain}/openings/${draft.opening_number}`,
  );

  await page.getByRole("button", { name: "Quote", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Quote this Opening" });
  const words = `Worth a look ${randomUUID()}`;
  await dialog.getByLabel("Add your words").fill(words);
  await dialog.getByRole("button", { name: "Post quote" }).click();
  await expect(page.getByText("Your quote was posted.")).toBeVisible();

  await openTimeline(page);
  await expect(page.getByText(words)).toBeVisible();
});
