import { randomUUID } from "node:crypto";
import type { OpeningContent } from "typespec/common/openings";
import type {
  MeshListQuotesRequest,
  MeshListQuotesResponse,
  MeshReadEmbedsRequest,
  MeshReadEmbedsResponse,
  MeshReadQuoteTargetRequest,
} from "typespec/hub/posts/mesh";
import type { Post } from "typespec/hub/posts/posts";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { InvalidPaginationKeyError } from "typespec/problem/common";
import {
  InvalidJSONError,
  ValidationFailedError,
} from "typespec/problem/details";
import { AuthenticationRequiredError } from "typespec/problem/hub/authentication";
import { OpeningNotFoundError } from "typespec/problem/hub/openings";
import {
  HubPostLimitReachedError,
  HubPostNotFoundError,
  HubPostQuoteRefusedError,
  HubPostUnavailableError,
} from "typespec/problem/hub/posts";
import { ProfileNotFoundError } from "typespec/problem/hub/profile";
import {
  deleteHubPostQuoteRow,
  hubAuditEventsForActor,
  hubPostQuoteRow,
  insertHubPosts,
  type TestTenant,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import { HubAPI } from "../lib/hub-api.ts";
import { setHubHome } from "../lib/hub-applicant.ts";
import { HubBlocksAPI } from "../lib/hub-blocks.ts";
import {
  Cast,
  expectNoContent,
  expectPost,
  expectProblem,
  expectQuotes,
  HubPostsAPI,
  HubQuotesAPI,
  type PostUser,
  type QuoteOperation,
} from "../lib/hub-posts.ts";
import { meshPeerRequest, meshRelayRequest } from "../lib/mesh.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";

interface Scenario {
  name: string;
  owner: TestTenant;
  quoter: TestTenant;
}

const scenarios: Scenario[] = [
  { name: "same region", owner: "sgp", quoter: "sgp" },
  { name: "cross region", owner: "sgp", quoter: "usa1" },
];

const allOperations: QuoteOperation[] = [
  "/posts/create-quote",
  "/posts/list-quotes",
  "/posts/detach-quote",
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
    quotes: new HubQuotesAPI(hub),
    blocks: new HubBlocksAPI(hub),
  };
}

type Apis = ReturnType<typeof apis>;

/** A Silver post owner with a post, and a free-tier quoter. */
interface World {
  owner: PostUser;
  quoter: PostUser;
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
  const from = apis(request, scenario.quoter);
  const owner = await cast.silver(scenario.owner, "Quote Owner");
  const quoter = await cast.user(scenario.quoter, "Quote Quoter");
  const post = await expectPost(
    await at.posts.create({ body: "The post" }, owner.token),
    201,
  );
  return { owner, quoter, post, at, from };
}

function target(w: World, post: Post = w.post, owner: PostUser = w.owner) {
  return {
    type: "timeline_post",
    owner: owner.handle,
    post_id: post.post_id,
  } as const;
}

/** Quotes the world's post as `user` and expects `201`. */
async function say(
  w: World,
  api: HubQuotesAPI,
  user: PostUser,
  body: string,
  extra: Record<string, unknown> = {},
): Promise<Post> {
  return expectPost(
    await api.create({ target: target(w), body, ...extra }, user.token),
    201,
  );
}

async function quoteCount(w: World): Promise<number> {
  const post = await expectPost(
    await w.at.posts.get(
      { owner: w.owner.handle, post_id: w.post.post_id },
      w.owner.token,
    ),
    200,
  );
  return post.quote_count;
}

/** The owner's tenant records a quote only after `hub-post-quoted` arrives. */
async function awaitCount(w: World, count: number): Promise<void> {
  await expect
    .poll(() => quoteCount(w), { timeout: 30_000, intervals: [500] })
    .toBe(count);
}

async function awaitRow(
  quote: Post,
  tenant: TestTenant,
  detached: boolean,
): Promise<void> {
  await expect
    .poll(() => hubPostQuoteRow(quote.post_id, tenant)?.detached, {
      timeout: 30_000,
      intervals: [500],
    })
    .toBe(detached);
}

async function awaitNoRow(quote: Post, tenant: TestTenant): Promise<void> {
  await expect
    .poll(() => hubPostQuoteRow(quote.post_id, tenant), {
      timeout: 30_000,
      intervals: [500],
    })
    .toBeNull();
}

/** The quote as its quoter reads it, so the embed is read at response time. */
async function reread(w: World, quote: Post): Promise<Post> {
  return expectPost(
    await w.from.posts.get(
      { owner: w.quoter.handle, post_id: quote.post_id },
      w.quoter.token,
    ),
    200,
  );
}

async function quotesOf(w: World, user: PostUser, api: Apis, limit?: number) {
  return expectQuotes(
    await api.quotes.list(
      {
        owner: w.owner.handle,
        post_id: w.post.post_id,
        ...(limit === undefined ? {} : { limit }),
      },
      user.token,
    ),
  );
}

function openingContent(title: string): OpeningContent {
  return {
    title,
    description: "Build reliable services",
    language: "en",
    employing_country: "SG",
    work_arrangement: "hybrid",
    employment_type: "full_time",
    positions: 1,
  };
}

async function openingOf(
  api: OrgsAPI,
  token: string,
  org: SignedUpOrg,
  title: string,
  publish: boolean,
): Promise<OrgOpening> {
  const created = await api.createOpening(token, {
    content: openingContent(title),
    hiring_manager_email: org.emailAddress,
    recruiter_email: org.emailAddress,
    team_member_emails: [],
  });
  expect(created.status(), await created.text()).toBe(201);
  const draft = (await created.json()) as OrgOpening;
  if (!publish) return draft;
  const published = await api.requestOpeningChange(token, {
    opening_number: draft.opening_number,
    version: draft.version,
    kind: "publish",
  });
  expect(published.status(), await published.text()).toBe(200);
  return (await published.json()) as OrgOpening;
}

for (const scenario of scenarios) {
  test(`create-quote (${scenario.name}) answers 201 on the free tier, trims, embeds the target, counts, audits without words, and embeds one level`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const first = await expectPost(
        await w.from.quotes.create(
          { target: target(w), body: "  Worth\n\n reading \t" },
          w.quoter.token,
        ),
        201,
      );
      expect(first).toMatchObject({
        kind: "quote",
        body: "Worth\n\n reading",
        reply_policy: "everyone",
        quote_policy: "everyone",
        locked: false,
        quote_count: 0,
        reply_count: 0,
        revision: 1,
        edited: false,
        owner: { handle: w.quoter.handle },
        quote_target: {
          type: "timeline_post",
          owner: w.owner.handle,
          post_id: w.post.post_id,
        },
        // The response carries the embed; the owner's tenant has no row yet.
        embed: {
          state: "post",
          post: {
            post_id: w.post.post_id,
            body: "The post",
            owner: { handle: w.owner.handle, display_name: "Quote Owner" },
          },
        },
      });
      expect(first.post_id).toMatch(idPattern);
      await awaitCount(w, 1);

      const second = await say(w, w.from.quotes, w.quoter, "Again", {
        reply_policy: "nobody",
        quote_policy: "nobody",
      });
      expect(second).toMatchObject({
        reply_policy: "nobody",
        quote_policy: "nobody",
      });
      await awaitCount(w, 2);

      // The embed is read again on get and list (PST-QTE-009).
      const got = await reread(w, first);
      expect(got.embed).toMatchObject({
        state: "post",
        post: { post_id: w.post.post_id, quote_count: expect.any(Number) },
      });
      const page = (await (
        await w.from.posts.list(
          { owner: w.quoter.handle, limit: 50 },
          w.quoter.token,
        )
      ).json()) as { posts: Post[] };
      const quotes = page.posts.filter((post) => post.kind === "quote");
      expect(quotes.map((post) => post.post_id).sort()).toEqual(
        [first.post_id, second.post_id].sort(),
      );
      for (const post of quotes) {
        expect(post.embed).toMatchObject({
          state: "post",
          post: { post_id: w.post.post_id },
        });
      }

      // A quote of a quote embeds one level: the inner quote shows its
      // target as a link only (PST-QTE-010, PST-QTE-002).
      const nested = await expectPost(
        await w.at.quotes.create(
          { target: target(w, first, w.quoter), body: "Quote of a quote" },
          w.owner.token,
        ),
        201,
      );
      expect(nested.embed).toMatchObject({
        state: "post",
        post: {
          post_id: first.post_id,
          kind: "quote",
          quote_target: { post_id: w.post.post_id },
        },
      });
      const inner = (
        nested.embed as unknown as { post: Record<string, unknown> }
      ).post;
      expect(inner.embed).toBeUndefined();

      const events = hubAuditEventsForActor(
        w.quoter.did,
        "hub.post.quoted",
        w.quoter.tenant,
      );
      expect(events.map((event) => event.entity_id).sort()).toEqual(
        [first.post_id, second.post_id].sort(),
      );
      expect(JSON.stringify(events)).not.toContain("Worth");
    } finally {
      cast.cleanup();
    }
  });

  test(`create-quote (${scenario.name}) refuses a nobody policy, a blocked quoter, a removed target, a reply, and an unknown owner, and keeps existing quotes after a block`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    let owner: PostUser | undefined;
    try {
      const w = await world(cast, request, scenario);
      owner = w.owner;
      const attempt = (
        post: string = w.post.post_id,
        handle = w.owner.handle,
      ) =>
        w.from.quotes.create(
          {
            target: { type: "timeline_post", owner: handle, post_id: post },
            body: "Hi",
          },
          w.quoter.token,
        );
      const policy = (quote_policy: "everyone" | "nobody") =>
        w.at.posts.setPolicies(
          {
            post_id: w.post.post_id,
            reply_policy: "everyone",
            quote_policy,
            locked: false,
          },
          w.owner.token,
        );

      const kept = await say(w, w.from.quotes, w.quoter, "Before");
      await awaitCount(w, 1);

      // PST-QTE-003: a nobody policy refuses new quotes only.
      await expectPost(await policy("nobody"), 200);
      await expectProblem(await attempt(), 403, HubPostQuoteRefusedError.type);
      await expectPost(await policy("everyone"), 200);
      await expectPost(await attempt(), 201);
      await awaitCount(w, 2);

      // PST-BLK-002 and PST-BLK-003: a block refuses new quotes and keeps
      // the old ones in the list and in the count.
      await expectNoContent(
        await w.at.blocks.block({ user: w.quoter.handle }, w.owner.token),
      );
      await expectProblem(await attempt(), 403, HubPostQuoteRefusedError.type);
      expect((await quotesOf(w, w.owner, w.at)).posts).toHaveLength(2);
      expect(await quoteCount(w)).toBe(2);
      expect(
        (await reread(w, kept)).embed,
        "the block does not hide the post from the quoter",
      ).toMatchObject({ state: "post" });
      await expectNoContent(
        await w.at.blocks.unblock({ user: w.quoter.handle }, w.owner.token),
      );

      // Unknown and wrong targets.
      await expectProblem(
        await attempt(missingID),
        404,
        HubPostNotFoundError.type,
      );
      await expectProblem(
        await attempt(w.post.post_id, unknownHandle()),
        404,
        HubPostNotFoundError.type,
      );
      // A reply is not a quote target (PST-QTE-002): its ID is no post.
      await expectProblem(
        await attempt("1".repeat(20) + "b".repeat(20)),
        404,
        HubPostNotFoundError.type,
      );

      // A region that does not answer.
      setHubHome(w.owner.did, "gone");
      try {
        await expectProblem(await attempt(), 503, HubPostUnavailableError.type);
      } finally {
        setHubHome(w.owner.did, w.owner.tenant);
      }

      // A removed target.
      await expectNoContent(
        await w.at.posts.remove({ post_id: w.post.post_id }, w.owner.token),
      );
      await expectProblem(await attempt(), 404, HubPostNotFoundError.type);
    } finally {
      if (owner !== undefined) setHubHome(owner.did, owner.tenant);
      cast.cleanup();
    }
  });

  test(`create-quote (${scenario.name}) quotes a published Opening, refuses a draft and an unknown Org, and shows the embed unavailable after the Opening closes`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    const orgs = new OrgsAPI(request, scenario.owner);
    let org: SignedUpOrg | undefined;
    try {
      const w = await world(cast, request, scenario);
      org = await signupOrg(orgs);
      const token = await loginOrg(orgs, org);
      const published = await openingOf(orgs, token, org, "Quotable", true);
      const draft = await openingOf(orgs, token, org, "Hidden draft", false);
      const quote = (number: number, domain: string = org!.domain) =>
        w.from.quotes.create(
          {
            target: {
              type: "opening",
              org_domain: domain,
              opening_number: number,
            },
            body: "Look at this job",
          },
          w.quoter.token,
        );

      const made = await expectPost(await quote(published.opening_number), 201);
      expect(made).toMatchObject({
        kind: "quote",
        quote_target: {
          type: "opening",
          org_domain: org.domain,
          opening_number: published.opening_number,
        },
        embed: {
          state: "opening",
          opening: {
            opening: {
              opening_number: published.opening_number,
              title: "Quotable",
            },
          },
        },
      });
      expect((await reread(w, made)).embed).toMatchObject({
        state: "opening",
      });
      // An Opening quote enqueues no event, so no tenant counts it.
      expect(await quoteCount(w)).toBe(0);

      await expectProblem(
        await quote(draft.opening_number),
        404,
        OpeningNotFoundError.type,
      );
      await expectProblem(
        await quote(published.opening_number + 100),
        404,
        OpeningNotFoundError.type,
      );
      await expectProblem(
        await quote(
          published.opening_number,
          `missing-${randomUUID()}.example.test`,
        ),
        404,
        OpeningNotFoundError.type,
      );

      const closed = await orgs.requestOpeningChange(token, {
        opening_number: published.opening_number,
        version: published.version,
        kind: "close",
      });
      expect(closed.status(), await closed.text()).toBe(200);
      expect((await reread(w, made)).embed).toEqual({ state: "unavailable" });
      await expectProblem(
        await quote(published.opening_number),
        404,
        OpeningNotFoundError.type,
      );
    } finally {
      cast.cleanup();
      if (org !== undefined) {
        cleanupOrg(org.domain, scenario.owner);
        await deleteOrgVerificationRecord(org.domain);
      }
    }
  });

  test(`list-quotes (${scenario.name}) lists newest first by keyset, bounds the limit, filters a muted quoter, and is not partial`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const other = await cast.user(scenario.quoter, "Other Quoter");
      const made: Post[] = [];
      for (const body of ["one", "two", "three"]) {
        made.push(await say(w, w.from.quotes, w.quoter, body));
        await awaitCount(w, made.length);
      }
      const byOther = await say(w, w.from.quotes, other, "four");
      await awaitCount(w, 4);

      const everything = await quotesOf(w, w.owner, w.at);
      expect(everything.partial).toBe(false);
      expect(everything.next_pagination_key).toBeUndefined();
      expect(everything.posts.map((post) => post.post_id)).toEqual([
        byOther.post_id,
        ...made.map((post) => post.post_id).reverse(),
      ]);
      // A quote list is readable by any Hub user.
      expect((await quotesOf(w, other, w.from)).posts).toHaveLength(4);

      const firstPage = await quotesOf(w, w.owner, w.at, 3);
      expect(firstPage.posts.map((post) => post.body)).toEqual([
        "four",
        "three",
        "two",
      ]);
      expect(firstPage.next_pagination_key).toBeTruthy();
      const last = await expectQuotes(
        await w.at.quotes.list(
          {
            owner: w.owner.handle,
            post_id: w.post.post_id,
            limit: 3,
            pagination_key: firstPage.next_pagination_key!,
          },
          w.owner.token,
        ),
      );
      expect(last.posts.map((post) => post.body)).toEqual(["one"]);
      expect(last.next_pagination_key).toBeUndefined();
      expect(last.partial).toBe(false);
      for (const post of everything.posts) {
        expect(post.embed).toMatchObject({
          state: "post",
          post: { post_id: w.post.post_id },
        });
      }

      // A key belongs to one post.
      const another = await expectPost(
        await w.at.posts.create({ body: "Another" }, w.owner.token),
        201,
      );
      await expectProblem(
        await w.at.quotes.list(
          {
            owner: w.owner.handle,
            post_id: another.post_id,
            pagination_key: firstPage.next_pagination_key!,
          },
          w.owner.token,
        ),
        400,
        InvalidPaginationKeyError.type,
      );
      await expectProblem(
        await w.at.quotes.list(
          {
            owner: w.owner.handle,
            post_id: w.post.post_id,
            pagination_key: "not-a-key",
          },
          w.owner.token,
        ),
        400,
        InvalidPaginationKeyError.type,
      );
      for (const limit of [0, 51]) {
        await expectProblem(
          await w.at.quotes.list(
            { owner: w.owner.handle, post_id: w.post.post_id, limit },
            w.owner.token,
          ),
          400,
          ValidationFailedError.type,
        );
      }

      // PST-BLK-005: the viewer's tenant filters out a muted quoter.
      await expectNoContent(
        await w.at.blocks.mute({ user: other.handle }, w.owner.token),
      );
      const filtered = await quotesOf(w, w.owner, w.at);
      expect(filtered.partial).toBe(false);
      expect(filtered.posts.map((post) => post.body)).toEqual([
        "three",
        "two",
        "one",
      ]);
      expect(await quoteCount(w)).toBe(4);

      await expectProblem(
        await w.at.quotes.list(
          { owner: w.owner.handle, post_id: missingID },
          w.owner.token,
        ),
        404,
        HubPostNotFoundError.type,
      );
      await expectProblem(
        await w.at.quotes.list(
          { owner: unknownHandle(), post_id: w.post.post_id },
          w.owner.token,
        ),
        404,
        HubPostNotFoundError.type,
      );
    } finally {
      cast.cleanup();
    }
  });

  test(`list-quotes (${scenario.name}) answers 503 hub-post-unavailable when the owner's region does not answer`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    let owner: PostUser | undefined;
    try {
      const w = await world(cast, request, scenario);
      owner = w.owner;
      setHubHome(w.owner.did, "gone");
      try {
        await expectProblem(
          await w.from.quotes.list(
            { owner: w.owner.handle, post_id: w.post.post_id },
            w.quoter.token,
          ),
          503,
          HubPostUnavailableError.type,
        );
      } finally {
        setHubHome(w.owner.did, w.owner.tenant);
      }
    } finally {
      if (owner !== undefined) setHubHome(owner.did, owner.tenant);
      cast.cleanup();
    }
  });

  test(`detach-quote and quote removal (${scenario.name}) change the count once, hide the embed, and keep the count after a removal that follows a detach`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const one = await say(w, w.from.quotes, w.quoter, "one");
      const two = await say(w, w.from.quotes, w.quoter, "two");
      const three = await say(w, w.from.quotes, w.quoter, "three");
      await awaitCount(w, 3);
      const detach = (post: Post, as: "owner" | "quoter" = "owner") =>
        (as === "owner" ? w.at : w.from).quotes.detach(
          {
            post_id: w.post.post_id,
            quoter: w.quoter.handle,
            quote_post_id: post.post_id,
          },
          (as === "owner" ? w.owner : w.quoter).token,
        );

      // Only the owner detaches; the quoter and a missing quote get 404.
      await expectProblem(
        await detach(one, "quoter"),
        404,
        HubPostNotFoundError.type,
      );
      await expectProblem(
        await detach({ ...one, post_id: missingID }),
        404,
        HubPostNotFoundError.type,
      );
      await expectProblem(
        await w.at.quotes.detach(
          {
            post_id: w.post.post_id,
            quoter: unknownHandle(),
            quote_post_id: one.post_id,
          },
          w.owner.token,
        ),
        404,
        HubPostNotFoundError.type,
      );
      expect(await quoteCount(w)).toBe(3);

      // Detach twice is 204 with one count change (PST-QTE-008).
      await expectNoContent(await detach(one));
      expect(await quoteCount(w)).toBe(2);
      await expectNoContent(await detach(one));
      expect(await quoteCount(w)).toBe(2);
      expect(
        hubAuditEventsForActor(
          w.owner.did,
          "hub.post.quote-detached",
          w.owner.tenant,
        ),
      ).toHaveLength(1);
      expect((await reread(w, one)).embed).toEqual({ state: "unavailable" });
      expect((await reread(w, two)).embed).toMatchObject({ state: "post" });
      const listed = await quotesOf(w, w.owner, w.at);
      expect(listed.posts.map((post) => post.post_id)).toEqual([
        three.post_id,
        two.post_id,
      ]);
      // A detached quote keeps its post with the quoter.
      expect((await reread(w, one)).body).toBe("one");
      expect(hubPostQuoteRow(one.post_id, w.owner.tenant)).toEqual({
        detached: true,
      });

      // Removal after a detach keeps the count (PST-QTE-006).
      await expectNoContent(
        await w.from.posts.remove({ post_id: one.post_id }, w.quoter.token),
      );
      await awaitNoRow(one, w.owner.tenant);
      expect(await quoteCount(w)).toBe(2);

      // Removal of an attached quote reduces the count once.
      await expectNoContent(
        await w.from.posts.remove({ post_id: two.post_id }, w.quoter.token),
      );
      await awaitNoRow(two, w.owner.tenant);
      expect(await quoteCount(w)).toBe(1);
      expect((await quotesOf(w, w.owner, w.at)).posts).toHaveLength(1);
    } finally {
      cast.cleanup();
    }
  });

  test(`a fresh quote embeds before hub-post-quoted arrives while the target is quotable, and a detached or refused quote stays unavailable (${scenario.name})`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    try {
      const w = await world(cast, request, scenario);
      const quote = await say(w, w.from.quotes, w.quoter, "Fresh");
      await awaitRow(quote, w.owner.tenant, false);

      // Without the row, a live target that anyone can quote shows.
      deleteHubPostQuoteRow(quote.post_id, w.owner.tenant);
      expect((await reread(w, quote)).embed).toMatchObject({
        state: "post",
        post: { post_id: w.post.post_id },
      });

      // The checks of PST-QTE-003 still apply to a missing row.
      await expectPost(
        await w.at.posts.setPolicies(
          {
            post_id: w.post.post_id,
            reply_policy: "everyone",
            quote_policy: "nobody",
            locked: false,
          },
          w.owner.token,
        ),
        200,
      );
      expect((await reread(w, quote)).embed).toEqual({ state: "unavailable" });
      await expectPost(
        await w.at.posts.setPolicies(
          {
            post_id: w.post.post_id,
            reply_policy: "everyone",
            quote_policy: "everyone",
            locked: false,
          },
          w.owner.token,
        ),
        200,
      );
      expect((await reread(w, quote)).embed).toMatchObject({ state: "post" });
      await expectNoContent(
        await w.at.blocks.block({ user: w.quoter.handle }, w.owner.token),
      );
      expect((await reread(w, quote)).embed).toEqual({ state: "unavailable" });
      await expectNoContent(
        await w.at.blocks.unblock({ user: w.quoter.handle }, w.owner.token),
      );
      expect((await reread(w, quote)).embed).toMatchObject({ state: "post" });

      // A removed target is unavailable with or without a row.
      await expectNoContent(
        await w.at.posts.remove({ post_id: w.post.post_id }, w.owner.token),
      );
      expect((await reread(w, quote)).embed).toEqual({ state: "unavailable" });
    } finally {
      cast.cleanup();
    }
  });
}

test("create-quote counts toward the 100-post cap and answers 429 hub-post-limit-reached", async ({
  request,
}) => {
  const cast = new Cast(request);
  try {
    const w = await world(cast, request, scenarios[0]!);
    // 99 fillers and one quote make 100; the next quote is refused.
    insertHubPosts(w.quoter.did, w.quoter.tenant, 99);
    await say(w, w.from.quotes, w.quoter, "The hundredth");
    await expectProblem(
      await w.from.quotes.create(
        { target: target(w), body: "One too many" },
        w.quoter.token,
      ),
      429,
      HubPostLimitReachedError.type,
    );
    expect(
      hubAuditEventsForActor(w.quoter.did, "hub.post.quoted", w.quoter.tenant),
    ).toHaveLength(1);
    await awaitCount(w, 1);
  } finally {
    cast.cleanup();
  }
});

test("quote operations refuse a missing session, bad JSON, and invalid input", async ({
  request,
}) => {
  const cast = new Cast(request);
  try {
    const api = apis(request, "sgp");
    const user = await cast.user("sgp", "Validation User");
    const validTarget = {
      type: "timeline_post",
      owner: user.handle,
      post_id: missingID,
    };
    const valid: Record<QuoteOperation, unknown> = {
      "/posts/create-quote": { target: validTarget, body: "Hi" },
      "/posts/list-quotes": { owner: user.handle, post_id: missingID },
      "/posts/detach-quote": {
        post_id: missingID,
        quoter: user.handle,
        quote_post_id: missingID,
      },
    };
    for (const operation of allOperations) {
      await expectProblem(
        await api.quotes.raw(operation, valid[operation]),
        401,
        AuthenticationRequiredError.type,
      );
      await expectProblem(
        await api.quotes.rawJSON(operation, "{not json", user.token),
        400,
        InvalidJSONError.type,
      );
    }
    const invalid: [QuoteOperation, unknown][] = [
      ["/posts/create-quote", { target: validTarget, body: "" }],
      ["/posts/create-quote", { target: validTarget, body: "   " }],
      ["/posts/create-quote", { target: validTarget, body: "x".repeat(513) }],
      ["/posts/create-quote", { target: validTarget }],
      ["/posts/create-quote", { body: "Hi" }],
      [
        "/posts/create-quote",
        { target: { ...validTarget, post_id: "short" }, body: "Hi" },
      ],
      [
        "/posts/create-quote",
        { target: { type: "reply", owner: user.handle }, body: "Hi" },
      ],
      [
        "/posts/create-quote",
        {
          target: {
            type: "opening",
            org_domain: "a.example",
            opening_number: 0,
          },
          body: "Hi",
        },
      ],
      [
        "/posts/create-quote",
        { target: validTarget, body: "Hi", reply_policy: "some" },
      ],
      [
        "/posts/create-quote",
        { target: validTarget, body: "Hi", quote_policy: "some" },
      ],
      ["/posts/list-quotes", { owner: user.handle, post_id: "short" }],
      ["/posts/list-quotes", { post_id: missingID }],
      [
        "/posts/list-quotes",
        { owner: user.handle, post_id: missingID, limit: 0 },
      ],
      [
        "/posts/list-quotes",
        { owner: user.handle, post_id: missingID, limit: 51 },
      ],
      [
        "/posts/detach-quote",
        { post_id: "short", quoter: user.handle, quote_post_id: missingID },
      ],
      [
        "/posts/detach-quote",
        { post_id: missingID, quoter: user.handle, quote_post_id: "short" },
      ],
      ["/posts/detach-quote", { post_id: missingID, quote_post_id: missingID }],
    ];
    for (const [operation, body] of invalid) {
      await expectProblem(
        await api.quotes.raw(operation, body, user.token),
        400,
        ValidationFailedError.type,
      );
    }
  } finally {
    cast.cleanup();
  }
});

test("mesh quote reads serve a verified viewer and refuse an unverified one, a refused quote, bad input, and a missing relay credential", async ({
  request,
  apiCoverage,
}) => {
  const cast = new Cast(request);
  try {
    const w = await world(cast, request, scenarios[0]!);
    const viewer = await cast.user("usa1", "Mesh Quoter");
    const quote = await expectPost(
      await apis(request, "usa1").quotes.create(
        { target: target(w), body: "mesh words" },
        viewer.token,
      ),
      201,
    );
    await awaitCount(w, 1);
    const as = {
      viewer_hub_user_did: viewer.did,
      viewer_handle: viewer.handle,
    };
    const read: MeshReadQuoteTargetRequest = {
      owner_hub_user_did: w.owner.did,
      target_post_id: w.post.post_id,
      ...as,
    };
    const embeds: MeshReadEmbedsRequest = {
      ...as,
      items: [
        {
          owner_hub_user_did: w.owner.did,
          target_post_id: w.post.post_id,
          quote_post_id: quote.post_id,
          quoter_hub_user_did: viewer.did,
        },
        // Another quoter's DID does not match the row.
        {
          owner_hub_user_did: w.owner.did,
          target_post_id: w.post.post_id,
          quote_post_id: quote.post_id,
          quoter_hub_user_did: randomHubUserDID(),
        },
      ],
    };
    const list: MeshListQuotesRequest = {
      owner_hub_user_did: w.owner.did,
      post_id: w.post.post_id,
      ...as,
    };
    const requests = [
      ["read-quote-target", read],
      ["read-embeds", embeds],
      ["list-quotes", list],
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
    const target1 = meshPeerRequest("usa1", "sgp", read, apiCoverage, {
      path: "/api/mesh/posts/read-quote-target",
    }).body as Post & { owner_hub_user_did: string };
    expect(target1).toMatchObject({
      post_id: w.post.post_id,
      body: "The post",
      owner_hub_user_did: w.owner.did,
    });
    const embedded = meshPeerRequest("usa1", "sgp", embeds, apiCoverage, {
      path: "/api/mesh/posts/read-embeds",
    }).body as MeshReadEmbedsResponse;
    expect(embedded.results.map((result) => result.status)).toEqual([
      "post",
      "unavailable",
    ]);
    const listed = meshPeerRequest("usa1", "sgp", list, apiCoverage, {
      path: "/api/mesh/posts/list-quotes",
    }).body as MeshListQuotesResponse;
    expect(listed.quotes).toHaveLength(1);
    expect(listed.quotes[0]).toMatchObject({
      quote_post_id: quote.post_id,
      quoter_hub_user_did: viewer.did,
      quoter_handle: viewer.handle,
      quoter_tenant_id: "usa1",
    });
    expect(JSON.stringify(listed)).not.toContain("mesh words");

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

    // A missing target, a refused quote, and a block.
    const missing = meshPeerRequest(
      "usa1",
      "sgp",
      { ...read, target_post_id: missingID },
      apiCoverage,
      { path: "/api/mesh/posts/read-quote-target" },
    );
    expect(missing.status, JSON.stringify(missing.body)).toBe(404);
    expect(missing.body).toMatchObject({ type: HubPostNotFoundError.type });
    const missingList = meshPeerRequest(
      "usa1",
      "sgp",
      { ...list, post_id: missingID },
      apiCoverage,
      { path: "/api/mesh/posts/list-quotes" },
    );
    expect(missingList.status).toBe(404);
    expect(missingList.body).toMatchObject({ type: HubPostNotFoundError.type });
    await expectPost(
      await w.at.posts.setPolicies(
        {
          post_id: w.post.post_id,
          reply_policy: "everyone",
          quote_policy: "nobody",
          locked: false,
        },
        w.owner.token,
      ),
      200,
    );
    for (const call of [
      meshPeerRequest("usa1", "sgp", read, apiCoverage, {
        path: "/api/mesh/posts/read-quote-target",
      }),
      meshRelayRequest(
        "usa1",
        "/mesh/posts/read-quote-target",
        read,
        apiCoverage,
      ),
    ]) {
      expect(call.status, JSON.stringify(call.body)).toBe(403);
      expect(call.body).toMatchObject({ type: HubPostQuoteRefusedError.type });
    }
    await expectPost(
      await w.at.posts.setPolicies(
        {
          post_id: w.post.post_id,
          reply_policy: "everyone",
          quote_policy: "everyone",
          locked: false,
        },
        w.owner.token,
      ),
      200,
    );
    await expectNoContent(
      await w.at.blocks.block({ user: viewer.handle }, w.owner.token),
    );
    const blocked = meshPeerRequest("usa1", "sgp", read, apiCoverage, {
      path: "/api/mesh/posts/read-quote-target",
    });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(403);
    expect(blocked.body).toMatchObject({ type: HubPostQuoteRefusedError.type });

    for (const [name, valid, invalid] of [
      ["read-quote-target", read, { ...read, target_post_id: "short" }],
      ["read-embeds", embeds, { ...embeds, items: [] }],
      ["list-quotes", list, { ...list, limit: 51 }],
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
    const badKey = meshPeerRequest(
      "usa1",
      "sgp",
      { ...list, pagination_key: "not-a-key" },
      apiCoverage,
      { path: "/api/mesh/posts/list-quotes" },
    );
    expect(badKey.status, JSON.stringify(badKey.body)).toBe(400);
    expect(badKey.body).toMatchObject({ type: InvalidPaginationKeyError.type });
  } finally {
    cast.cleanup();
  }
});
