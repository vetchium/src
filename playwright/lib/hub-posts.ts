import { randomUUID } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";
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

  create(body: CreatePostRequest, token: string): Promise<APIResponse> {
    return this.hub.post("/posts/create", body, { token });
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
  ): Promise<APIResponse> {
    return this.hub.post(operation, body, token ? { token } : {});
  }

  /** A body that is not JSON. */
  rawJSON(
    operation: PostOperation,
    body: string,
    token?: string,
  ): Promise<APIResponse> {
    return this.hub.postRaw(operation, body, token ? { token } : {});
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
