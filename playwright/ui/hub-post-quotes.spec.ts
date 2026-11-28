import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type { Post } from "typespec/hub/posts/posts";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { hubUserDIDForHandle, insertHubPosts } from "../lib/admin-db.ts";
import { HubAPI, hubIdempotencyKey } from "../lib/hub-api.ts";
import {
  expectNoContent,
  expectPost,
  expectQuotes,
  HubPostsAPI,
  HubQuotesAPI,
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
  user: HubTestUser;
  token: string;
  hub: HubAPI;
  posts: HubPostsAPI;
  quotes: HubQuotesAPI;
}

/** An API session for the user, to set up and check state outside the page. */
async function session(
  request: APIRequestContext,
  user: HubTestUser,
): Promise<Session> {
  const hub = new HubAPI(request, user.tenant);
  const token = await login(request, user.tenant, user.email, user.password);
  return {
    user,
    token,
    hub,
    posts: new HubPostsAPI(hub),
    quotes: new HubQuotesAPI(hub),
  };
}

/** Moves the user to Silver, which posting needs (PST-POS-001). */
async function upgrade(s: Session): Promise<void> {
  const key = hubIdempotencyKey();
  s.user.keys.push(key);
  const response = await s.hub.setSubscriptionPlan(
    { plan_oid: "hub-silver-tier", billing_interval: "month" },
    { token: s.token, idempotencyKey: key },
  );
  expect(response.status(), await response.text()).toBe(200);
}

async function createPost(
  s: Session,
  body: string,
  extra: { quote_policy?: "everyone" | "nobody" } = {},
): Promise<Post> {
  return expectPost(await s.posts.create({ body, ...extra }, s.token), 201);
}

/** Quotes `target` as `s` through the API. */
async function quoteOf(s: Session, target: Post, body: string): Promise<Post> {
  return expectPost(
    await s.quotes.create(
      {
        target: {
          type: "timeline_post",
          owner: target.owner.handle,
          post_id: target.post_id,
        },
        body,
      },
      s.token,
    ),
    201,
  );
}

function postURL(post: Post): string {
  return `${HUB_PORTAL}/u/${post.owner.handle}/posts/${post.post_id}`;
}

/** The owner's tenant records a quote only after `hub-post-quoted` arrives. */
async function awaitQuoteCount(
  s: Session,
  target: Post,
  count: number,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (
          await expectPost(
            await s.posts.get(
              { owner: target.owner.handle, post_id: target.post_id },
              s.token,
            ),
            200,
          )
        ).quote_count,
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(count);
}

async function openQuoteDialog(page: Page, name: string) {
  await page.getByRole("button", { name: "Quote", exact: true }).click();
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe.configure({ timeout: 90_000 });

test("a free-tier user quotes a post from its card and sees the embed", async ({
  page,
  request,
  hubUser,
}) => {
  const owner = await session(request, await hubUser("sgp"));
  await upgrade(owner);
  const post = await createPost(owner, `Original ${randomUUID()}`);
  const quoter = await hubUser("sgp");
  await signIn(page, quoter);
  await page.goto(`${HUB_PORTAL}/u/${owner.user.handle}`);
  await page.getByRole("tab", { name: "Posts" }).click();

  const dialog = await openQuoteDialog(page, "Quote this post");
  await expect(dialog.getByText(post.body)).toBeVisible();
  const submit = dialog.getByRole("button", { name: "Post quote" });
  await expect(submit).toBeDisabled();
  const words = `My view ${randomUUID()}`;
  await dialog.getByLabel("Add your words").fill(words);
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByText("Your quote was posted.")).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/u/${quoter.handle}/posts/[0-9a-z]{40}$`),
  );
  await expect(page.getByText(words)).toBeVisible();
  const embed = page.getByRole("group", { name: "Quoted item" });
  await expect(embed).toContainText(post.body);
  await expect(embed).toContainText(`@${owner.user.handle}`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a user quotes an Opening from its page and sees the Opening in the embed", async ({
  page,
  request,
  hubUser,
  org,
}) => {
  const remote = await org("usa1");
  const api = new OrgsAPI(request, "usa1");
  const orgToken = await loginOrg(api, remote);
  const title = `Quotable ${randomUUID().slice(0, 8)}`;
  const content: OpeningContent = {
    title,
    description: "Build reliable services",
    language: "en",
    employing_country: "SG",
    work_arrangement: "hybrid",
    employment_type: "full_time",
    positions: 1,
  };
  const created = await api.createOpening(orgToken, {
    content,
    hiring_manager_email: remote.emailAddress,
    recruiter_email: remote.emailAddress,
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

  const quoter = await hubUser("sgp");
  await signIn(page, quoter);
  await page.goto(
    `${HUB_PORTAL}/org/${remote.domain}/openings/${draft.opening_number}`,
  );
  const dialog = await openQuoteDialog(page, "Quote this Opening");
  await expect(dialog.getByText(title)).toBeVisible();
  const words = `Worth a look ${randomUUID()}`;
  await dialog.getByLabel("Add your words").fill(words);
  await dialog.getByRole("button", { name: "Post quote" }).click();

  await expect(page.getByText("Your quote was posted.")).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/u/${quoter.handle}/posts/[0-9a-z]{40}$`),
  );
  await expect(page.getByText(words)).toBeVisible();
  await expect(page.getByRole("link", { name: title })).toBeVisible();
});

test("cancel closes the dialog, posts nothing, and keeps no draft", async ({
  page,
  request,
  hubUser,
}) => {
  const owner = await session(request, await hubUser("sgp"));
  await upgrade(owner);
  const post = await createPost(owner, `Original ${randomUUID()}`);
  const quoter = await session(request, await hubUser("sgp"));
  await signIn(page, quoter.user);
  await page.goto(postURL(post));

  let dialog = await openQuoteDialog(page, "Quote this post");
  await dialog.getByLabel("Add your words").fill("A draft");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  dialog = await openQuoteDialog(page, "Quote this post");
  await expect(dialog.getByLabel("Add your words")).toHaveValue("");
  const listed = await expectQuotes(
    await quoter.quotes.list(
      { owner: owner.user.handle, post_id: post.post_id },
      quoter.token,
    ),
  );
  expect(listed.posts).toHaveLength(0);
});

test("a policy change after the page loaded shows the refusal in the dialog", async ({
  page,
  request,
  hubUser,
}) => {
  const owner = await session(request, await hubUser("sgp"));
  await upgrade(owner);
  const post = await createPost(owner, `Original ${randomUUID()}`);
  const quoter = await hubUser("sgp");
  await signIn(page, quoter);
  await page.goto(postURL(post));
  await expect(
    page.getByRole("button", { name: "Quote", exact: true }),
  ).toBeVisible();

  const changed = await owner.posts.setPolicies(
    {
      post_id: post.post_id,
      reply_policy: "everyone",
      quote_policy: "nobody",
      locked: false,
    },
    owner.token,
  );
  expect(changed.status(), await changed.text()).toBe(200);

  const dialog = await openQuoteDialog(page, "Quote this post");
  await dialog.getByLabel("Add your words").fill("Too late");
  await dialog.getByRole("button", { name: "Post quote" }).click();
  await expect(dialog.getByText("You cannot quote this post.")).toBeVisible();
  await expect(dialog).toBeVisible();
});

test("the daily limit shows its message in the dialog", async ({
  page,
  request,
  hubUser,
}) => {
  const owner = await session(request, await hubUser("sgp"));
  await upgrade(owner);
  const post = await createPost(owner, `Original ${randomUUID()}`);
  const quoter = await hubUser("sgp");
  insertHubPosts(hubUserDIDForHandle(quoter.handle, quoter.tenant), "sgp", 100);
  await signIn(page, quoter);
  await page.goto(postURL(post));

  const dialog = await openQuoteDialog(page, "Quote this post");
  await dialog.getByLabel("Add your words").fill("One too many");
  await dialog.getByRole("button", { name: "Post quote" }).click();
  await expect(
    dialog.getByText("You reached your limit of posts for today."),
  ).toBeVisible();
});

test("a post with quote policy nobody has no Quote button", async ({
  page,
  request,
  hubUser,
}) => {
  const owner = await session(request, await hubUser("sgp"));
  await upgrade(owner);
  const open = await createPost(owner, `Open ${randomUUID()}`);
  const closed = await createPost(owner, `Closed ${randomUUID()}`, {
    quote_policy: "nobody",
  });
  const viewer = await hubUser("sgp");
  await signIn(page, viewer);

  await page.goto(postURL(closed));
  await expect(page.getByText(closed.body)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Quote", exact: true }),
  ).toHaveCount(0);

  await page.goto(postURL(open));
  await expect(
    page.getByRole("button", { name: "Quote", exact: true }),
  ).toBeVisible();
});

test("a quote of a quote embeds one level and shows its target as a link", async ({
  page,
  request,
  hubUser,
}) => {
  const owner = await session(request, await hubUser("sgp"));
  await upgrade(owner);
  const quoter = await session(request, await hubUser("sgp"));
  const post = await createPost(owner, `Root ${randomUUID()}`);
  const inner = await quoteOf(quoter, post, `Inner ${randomUUID()}`);
  const outer = await quoteOf(owner, inner, `Outer ${randomUUID()}`);
  await signIn(page, owner.user);
  await page.goto(postURL(outer));

  const embed = page.getByRole("group", { name: "Quoted item" });
  await expect(embed).toContainText(inner.body);
  await expect(embed).not.toContainText(post.body);
  const link = embed.getByRole("link", { name: "Quoted post" });
  await expect(link).toHaveAttribute(
    "href",
    `/u/${owner.user.handle}/posts/${post.post_id}`,
  );
});

test("an embed whose target was removed shows the unavailable text", async ({
  page,
  request,
  hubUser,
}) => {
  const owner = await session(request, await hubUser("sgp"));
  await upgrade(owner);
  const quoter = await session(request, await hubUser("sgp"));
  const post = await createPost(owner, `Doomed ${randomUUID()}`);
  const quote = await quoteOf(quoter, post, `About it ${randomUUID()}`);
  await signIn(page, quoter.user);
  await page.goto(postURL(quote));
  await expect(page.getByRole("group", { name: "Quoted item" })).toContainText(
    post.body,
  );

  await expectNoContent(
    await owner.posts.remove({ post_id: post.post_id }, owner.token),
  );
  await page.reload();
  const embed = page.getByRole("group", { name: "Quoted item" });
  await expect(embed).toContainText("This post is not available");
  await expect(embed).not.toContainText(post.body);
});

test("the quotes page pages with Load more", async ({
  page,
  request,
  hubUser,
}) => {
  const owner = await session(request, await hubUser("sgp"));
  await upgrade(owner);
  const quoter = await session(request, await hubUser("sgp"));
  const post = await createPost(owner, `Popular ${randomUUID()}`);
  for (let i = 1; i <= 21; i++) await quoteOf(quoter, post, `Quote ${i}`);
  await awaitQuoteCount(owner, post, 21);
  await signIn(page, owner.user);
  await page.goto(`${postURL(post)}/quotes`);

  await expect(page.getByRole("heading", { name: "Quotes" })).toBeVisible();
  const detach = page.getByRole("button", { name: "Detach", exact: true });
  await expect(detach).toHaveCount(20);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(detach).toHaveCount(21);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("a partial page shows the notice", async ({ page, request, hubUser }) => {
  const owner = await session(request, await hubUser("sgp"));
  await upgrade(owner);
  const post = await createPost(owner, `Original ${randomUUID()}`);
  await signIn(page, owner.user);
  await page.route("**/api/hub/posts/list-quotes", (route) =>
    route.fulfill({ json: { posts: [], partial: true } }),
  );
  await page.goto(`${postURL(post)}/quotes`);

  await expect(
    page.getByText("Some items are not available now. Try again later."),
  ).toBeVisible();
});

test("the owner detaches a quote with a confirmation, and others see no Detach", async ({
  page,
  browser,
  request,
  hubUser,
}) => {
  const owner = await session(request, await hubUser("sgp"));
  await upgrade(owner);
  const quoter = await session(request, await hubUser("sgp"));
  const post = await createPost(owner, `Original ${randomUUID()}`);
  const quote = await quoteOf(quoter, post, `Detach me ${randomUUID()}`);
  await awaitQuoteCount(owner, post, 1);

  // The quoter sees the quote but no Detach.
  await signIn(page, quoter.user);
  await page.goto(`${postURL(post)}/quotes`);
  await expect(page.getByText(quote.body)).toBeVisible();
  await expect(page.getByRole("button", { name: "Detach" })).toHaveCount(0);

  // The owner signs in through a separate browser context.
  const ownerPage = await (await browser.newContext()).newPage();
  await signIn(ownerPage, owner.user);
  await ownerPage.goto(`${postURL(post)}/quotes`);
  await expect(ownerPage.getByText(quote.body)).toBeVisible();

  await ownerPage.getByRole("button", { name: "Detach", exact: true }).click();
  const dialog = ownerPage.getByRole("dialog", { name: "Detach this quote?" });
  await expect(dialog).toContainText("The quote post stays on its author");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(ownerPage.getByText(quote.body)).toBeVisible();

  await ownerPage.getByRole("button", { name: "Detach", exact: true }).click();
  await ownerPage
    .getByRole("dialog", { name: "Detach this quote?" })
    .getByRole("button", { name: "Detach" })
    .click();
  await expect(ownerPage.getByText("The quote was detached.")).toBeVisible();
  await expect(ownerPage.getByText(quote.body)).toHaveCount(0);
  await expect(ownerPage.getByText("No quotes yet.")).toBeVisible();
  await awaitQuoteCount(owner, post, 0);
});
