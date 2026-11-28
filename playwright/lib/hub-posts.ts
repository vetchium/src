import { randomUUID } from "node:crypto";
import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
import type {
  CreatePostRequest,
  EditPostRequest,
  GetPostRequest,
  ListPostsRequest,
  ListPostsResponse,
  Post,
  RemovePostRequest,
  SetPostPoliciesRequest,
} from "typespec/hub/posts/posts";
import type {
  CreateQuoteRequest,
  DetachQuoteRequest,
  ListQuotesRequest,
  ListQuotesResponse,
} from "typespec/hub/posts/quotes";
import type {
  EditReplyRequest,
  HideReplyRequest,
  ListAuthorRepliesRequest,
  ListAuthorRepliesResponse,
  ListRepliesRequest,
  ListRepliesResponse,
  LocateReplyRequest,
  LocateReplyResponse,
  RemoveReplyRequest,
  Reply,
  ReplyRequest,
} from "typespec/hub/posts/replies";
import type { ReadCardsRequest } from "typespec/hub/profile/cards";
import {
  cleanupHubAliasClaim,
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  cleanupHubUserAuditEvents,
  databaseNow,
  hubSubscriptionAuditEvents,
  seedHubSignupDomain,
  setHubSubscriptionPeriod,
  type TestTenant,
} from "./admin-db.ts";
import { expect } from "./admin-fixtures.ts";
import { HubAPI, hubIdempotencyKey } from "./hub-api.ts";
import { login, signup } from "./hub-signup.ts";

/** A signed-in caller. The test cleanup removes the keys it sends. */
export interface KeyedCaller {
  token: string;
  keys: string[];
}

/** Records the key a write sends, or a fresh one, for cleanup. */
function keyOf(caller: KeyedCaller, idempotencyKey?: string): string {
  const key = idempotencyKey ?? hubIdempotencyKey();
  caller.keys.push(key);
  return key;
}

/**
 * Sends the page's writes that match `path` with test keys, so cleanup
 * removes their ledger rows. One page key maps to one test key, so a retry of
 * the page still replays.
 */
export async function routeTestKeys(
  page: Page,
  caller: { keys: string[] },
  path: RegExp,
): Promise<void> {
  const mapped = new Map<string, string>();
  await page.route(path, async (route) => {
    const headers = route.request().headers();
    const own = headers["idempotency-key"] ?? "";
    let key = mapped.get(own);
    if (key === undefined) {
      key = hubIdempotencyKey();
      mapped.set(own, key);
      caller.keys.push(key);
    }
    await route.continue({ headers: { ...headers, "idempotency-key": key } });
  });
}

export type PostOperation =
  | "/posts/create"
  | "/posts/edit"
  | "/posts/remove"
  | "/posts/set-policies"
  | "/posts/list"
  | "/posts/get"
  | "/profile/read-cards";

/** Typed clients for the post and card operations. Malformed input goes
 * through `raw` and `rawJSON`. */
export class HubPostsAPI {
  constructor(readonly hub: HubAPI) {}

  /** Sends a fresh key unless the test names one, as a replay does. */
  create(
    body: CreatePostRequest,
    caller: KeyedCaller,
    idempotencyKey?: string,
  ): Promise<APIResponse> {
    return this.hub.post("/posts/create", body, {
      token: caller.token,
      idempotencyKey: keyOf(caller, idempotencyKey),
    });
  }

  edit(body: EditPostRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/posts/edit", body, { token });
  }

  remove(body: RemovePostRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/posts/remove", body, { token });
  }

  setPolicies(
    body: SetPostPoliciesRequest,
    token: string,
  ): Promise<APIResponse> {
    return this.hub.post("/posts/set-policies", body, { token });
  }

  list(body: ListPostsRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/posts/list", body, { token });
  }

  get(body: GetPostRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/posts/get", body, { token });
  }

  readCards(body: ReadCardsRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/profile/read-cards", body, { token });
  }

  /** A body of any shape, for validation cases. */
  raw(
    operation: PostOperation,
    body: unknown,
    token?: string,
    idempotencyKey?: string,
  ): Promise<APIResponse> {
    return this.hub.post(operation, body, {
      ...(token ? { token } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }

  /** A body that is not JSON. */
  rawJSON(
    operation: PostOperation,
    body: string,
    token?: string,
    idempotencyKey?: string,
  ): Promise<APIResponse> {
    return this.hub.postRaw(operation, body, {
      ...(token ? { token } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }
}

export type ReplyOperation =
  | "/posts/reply"
  | "/posts/edit-reply"
  | "/posts/remove-reply"
  | "/posts/hide-reply"
  | "/posts/unhide-reply"
  | "/posts/list-replies"
  | "/posts/locate-reply"
  | "/posts/list-author-replies";

/** Typed clients for the reply operations. Malformed input goes through
 * `raw` and `rawJSON`. */
export class HubRepliesAPI {
  constructor(readonly hub: HubAPI) {}

  reply(
    body: ReplyRequest,
    token: string,
    idempotencyKey: string,
  ): Promise<APIResponse> {
    return this.hub.post("/posts/reply", body, {
      token,
      idempotencyKey,
    });
  }

  edit(body: EditReplyRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/posts/edit-reply", body, { token });
  }

  remove(body: RemoveReplyRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/posts/remove-reply", body, { token });
  }

  hide(body: HideReplyRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/posts/hide-reply", body, { token });
  }

  unhide(body: HideReplyRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/posts/unhide-reply", body, { token });
  }

  list(body: ListRepliesRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/posts/list-replies", body, { token });
  }

  locate(body: LocateReplyRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/posts/locate-reply", body, { token });
  }

  listByAuthor(
    body: ListAuthorRepliesRequest,
    token: string,
  ): Promise<APIResponse> {
    return this.hub.post("/posts/list-author-replies", body, { token });
  }

  /** A body of any shape, for validation cases. */
  raw(
    operation: ReplyOperation,
    body: unknown,
    token?: string,
    idempotencyKey?: string,
  ): Promise<APIResponse> {
    return this.hub.post(operation, body, {
      ...(token ? { token } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }

  /** A body that is not JSON. */
  rawJSON(
    operation: ReplyOperation,
    body: string,
    token?: string,
    idempotencyKey?: string,
  ): Promise<APIResponse> {
    return this.hub.postRaw(operation, body, {
      ...(token ? { token } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }
}

export type QuoteOperation =
  | "/posts/create-quote"
  | "/posts/list-quotes"
  | "/posts/detach-quote";

/** Typed clients for the quote operations. Malformed input goes through
 * `raw` and `rawJSON`. */
export class HubQuotesAPI {
  constructor(readonly hub: HubAPI) {}

  /** Sends a fresh key unless the test names one, as a replay does. */
  create(
    body: CreateQuoteRequest,
    caller: KeyedCaller,
    idempotencyKey?: string,
  ): Promise<APIResponse> {
    return this.hub.post("/posts/create-quote", body, {
      token: caller.token,
      idempotencyKey: keyOf(caller, idempotencyKey),
    });
  }

  list(body: ListQuotesRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/posts/list-quotes", body, { token });
  }

  detach(body: DetachQuoteRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/posts/detach-quote", body, { token });
  }

  /** A body of any shape, for validation cases. */
  raw(
    operation: QuoteOperation,
    body: unknown,
    token?: string,
    idempotencyKey?: string,
  ): Promise<APIResponse> {
    return this.hub.post(operation, body, {
      ...(token ? { token } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }

  /** A body that is not JSON. */
  rawJSON(
    operation: QuoteOperation,
    body: string,
    token?: string,
    idempotencyKey?: string,
  ): Promise<APIResponse> {
    return this.hub.postRaw(operation, body, {
      ...(token ? { token } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }
}

export interface PostUser {
  tenant: TestTenant;
  email: string;
  handle: string;
  did: string;
  token: string;
  keys: string[];
}

/** Creates and removes the users and signup domains of one test. */
export class Cast {
  readonly users: PostUser[] = [];
  readonly domain = `e2e-${randomUUID()}.example.test`;
  private readonly seeded = new Set<TestTenant>();

  constructor(private readonly request: APIRequestContext) {}

  async user(
    tenant: TestTenant,
    displayName = "Post Tester",
  ): Promise<PostUser> {
    if (!this.seeded.has(tenant)) {
      seedHubSignupDomain(this.domain, tenant);
      this.seeded.add(tenant);
    }
    const email = `e2e+${randomUUID()}@${this.domain}`;
    const created: PostUser = {
      tenant,
      email,
      handle: "",
      did: "",
      token: "",
      keys: [],
    };
    // Track the user before sign-in so cleanup covers a partial setup.
    this.users.push(created);
    const signedUp = await signup(this.request, tenant, email, created.keys, {
      displayName,
    });
    created.handle = signedUp.handle;
    created.did = signedUp.hubUserDID;
    created.token = await login(this.request, tenant, email, signedUp.password);
    return created;
  }

  /** A fresh idempotency key that cleanup removes from the user's tenant. */
  key(user: PostUser): string {
    const key = hubIdempotencyKey();
    user.keys.push(key);
    return key;
  }

  /** Moves the user to a plan. Posting needs Silver or higher. */
  async plan(
    user: PostUser,
    planOID: "hub-free-tier" | "hub-silver-tier",
  ): Promise<void> {
    const key = hubIdempotencyKey();
    user.keys.push(key);
    const response = await new HubAPI(
      this.request,
      user.tenant,
    ).setSubscriptionPlan(
      planOID === "hub-free-tier"
        ? { plan_oid: planOID }
        : { plan_oid: planOID, billing_interval: "month" },
      { token: user.token, idempotencyKey: key },
    );
    expect(response.status(), await response.text()).toBe(200);
  }

  /** Downgrades a Silver user to the free tier. The change applies when the
   * billing period ends, so the period is moved into the past and the worker
   * applies it. */
  async downgrade(user: PostUser): Promise<void> {
    await this.plan(user, "hub-free-tier");
    const now = databaseNow(user.tenant);
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
    );
    setHubSubscriptionPeriod(user.did, user.tenant, {
      anchor: start,
      start,
      end,
    });
    await expect
      .poll(
        () =>
          hubSubscriptionAuditEvents(user.did, user.tenant).filter(
            (event) =>
              event.action === "hub.subscription.scheduled-change-applied",
          ).length,
        { timeout: 30_000, intervals: [500] },
      )
      .toBeGreaterThan(0);
  }

  /** A Silver user. */
  async silver(tenant: TestTenant, displayName?: string): Promise<PostUser> {
    const user = await this.user(tenant, displayName);
    await this.plan(user, "hub-silver-tier");
    return user;
  }

  cleanup(): void {
    for (const user of this.users) {
      if (user.did !== "") {
        cleanupHubAliasClaim(user.did);
        cleanupHubUserAuditEvents(user.did, user.tenant);
      }
      cleanupHubUser(user.email, user.tenant);
      cleanupHubIdempotency(user.keys, user.tenant);
    }
    for (const tenant of this.seeded)
      cleanupHubSignupDomain(this.domain, tenant);
  }
}

export async function expectProblem(
  response: APIResponse,
  status: number,
  type: string,
): Promise<void> {
  expect(response.status(), await response.text()).toBe(status);
  expect(response.headers()["content-type"]).toContain(
    "application/problem+json",
  );
  expect((await response.json()).type).toBe(type);
}

export async function expectPost(
  response: APIResponse,
  status: number,
): Promise<Post> {
  expect(response.status(), await response.text()).toBe(status);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as Post;
}

export async function expectList(
  response: APIResponse,
): Promise<ListPostsResponse> {
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ListPostsResponse;
}

export async function expectReply(
  response: APIResponse,
  status: number,
): Promise<Reply> {
  expect(response.status(), await response.text()).toBe(status);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as Reply;
}

export async function expectReplies(
  response: APIResponse,
): Promise<ListRepliesResponse> {
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ListRepliesResponse;
}

export async function expectAuthorReplies(
  response: APIResponse,
): Promise<ListAuthorRepliesResponse> {
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ListAuthorRepliesResponse;
}

export async function expectQuotes(
  response: APIResponse,
): Promise<ListQuotesResponse> {
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ListQuotesResponse;
}

export async function expectNoContent(response: APIResponse): Promise<void> {
  expect(response.status(), await response.text()).toBe(204);
}

export async function expectLocated(
  response: APIResponse,
): Promise<LocateReplyResponse> {
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as LocateReplyResponse;
}
