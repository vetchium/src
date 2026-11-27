import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type {
  BlockState,
  CheckBlockRequest,
  CheckBlockResponse,
  ListBlockedUsersResponse,
} from "typespec/hub/blocks/blocks";
import type { OperationStatus } from "typespec/hub/operations/operations";
import type { PublicProfile } from "typespec/hub/profile/public";
import { InvalidPaginationKeyError } from "typespec/problem/common";
import {
  InvalidJSONError,
  ValidationFailedError,
} from "typespec/problem/details";
import { AuthenticationRequiredError } from "typespec/problem/hub/authentication";
import {
  ProfileNotFoundError,
  ProfileUnavailableError,
} from "typespec/problem/hub/profile";
import {
  cleanupHubAliasClaim,
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  cleanupHubUserAuditEvents,
  hubAuditEventsForActor,
  seedHubSignupDomain,
  type TestTenant,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { HubAPI, hubIdempotencyKey } from "../lib/hub-api.ts";
import { type BlockOperation, HubBlocksAPI } from "../lib/hub-blocks.ts";
import { login, signup } from "../lib/hub-signup.ts";
import { meshPeerRequest, meshRelayRequest } from "../lib/mesh.ts";

interface User {
  tenant: TestTenant;
  email: string;
  handle: string;
  did: string;
  token: string;
  keys: string[];
}

/** Creates and removes the users and signup domains of one test. */
class Cast {
  readonly users: User[] = [];
  readonly domain = `e2e-${randomUUID()}.example.test`;
  private readonly seeded = new Set<TestTenant>();

  constructor(private readonly request: APIRequestContext) {}

  async user(tenant: TestTenant, displayName = "Block Tester"): Promise<User> {
    if (!this.seeded.has(tenant)) {
      seedHubSignupDomain(this.domain, tenant);
      this.seeded.add(tenant);
    }
    const email = `e2e+${randomUUID()}@${this.domain}`;
    const keys: string[] = [];
    const created: User = {
      tenant,
      email,
      handle: "",
      did: "",
      token: "",
      keys,
    };
    // Track the user before sign-in so cleanup covers a partial setup.
    this.users.push(created);
    const signedUp = await signup(this.request, tenant, email, keys, {
      displayName,
    });
    created.handle = signedUp.handle;
    created.did = signedUp.hubUserDID;
    created.token = await login(this.request, tenant, email, signedUp.password);
    return created;
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

interface Kind {
  name: "block" | "mute";
  add: keyof Pick<HubBlocksAPI, "block" | "mute">;
  remove: keyof Pick<HubBlocksAPI, "unblock" | "unmute">;
  list: keyof Pick<HubBlocksAPI, "listBlocks" | "listMutes">;
  otherList: keyof Pick<HubBlocksAPI, "listBlocks" | "listMutes">;
  addPath: BlockOperation;
  removePath: BlockOperation;
  listPath: BlockOperation;
  created: string;
  deleted: string;
  flag: keyof BlockState;
}

const kinds: Kind[] = [
  {
    name: "block",
    add: "block",
    remove: "unblock",
    list: "listBlocks",
    otherList: "listMutes",
    addPath: "/blocks/block",
    removePath: "/blocks/unblock",
    listPath: "/blocks/list",
    created: "hub.block.created",
    deleted: "hub.block.deleted",
    flag: "blocked",
  },
  {
    name: "mute",
    add: "mute",
    remove: "unmute",
    list: "listMutes",
    otherList: "listBlocks",
    addPath: "/mutes/mute",
    removePath: "/mutes/unmute",
    listPath: "/mutes/list",
    created: "hub.mute.created",
    deleted: "hub.mute.deleted",
    flag: "muted",
  },
];

const allOperations: BlockOperation[] = [
  "/blocks/block",
  "/blocks/unblock",
  "/blocks/list",
  "/blocks/state",
  "/mutes/mute",
  "/mutes/unmute",
  "/mutes/list",
];

function unknownHandle(): string {
  return `${randomUUID().replaceAll("-", "").slice(0, 8)}-0123456789a`;
}

function randomHubUserDID(): string {
  return `018f7e32-7b5a-7d31-8fd0-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function stateOf(
  api: HubBlocksAPI,
  token: string,
  user: string,
): Promise<BlockState> {
  const response = await api.state({ user }, token);
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as BlockState;
}

async function handles(
  response: Awaited<ReturnType<HubBlocksAPI["listBlocks"]>>,
): Promise<ListBlockedUsersResponse> {
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ListBlockedUsersResponse;
}

async function expectProblem(
  response: Awaited<ReturnType<HubBlocksAPI["block"]>>,
  status: number,
  type: string,
): Promise<void> {
  expect(response.status(), await response.text()).toBe(status);
  expect(response.headers()["content-type"]).toContain(
    "application/problem+json",
  );
  expect((await response.json()).type).toBe(type);
}

for (const kind of kinds) {
  test(`${kind.name} and ${kind.remove} change one-way state, audit once, and tell the other user nothing`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    const sgp = new HubBlocksAPI(new HubAPI(request, "sgp"));
    try {
      const actor = await cast.user("sgp", "Actor");
      const local = await cast.user("sgp", "Local Target");
      const remote = await cast.user("usa1", "Remote Target");

      expect(await stateOf(sgp, actor.token, local.handle)).toEqual({
        blocked: false,
        muted: false,
      });
      expect(await handles(await sgp[kind.list]({}, actor.token))).toEqual({
        users: [],
      });

      const first = await sgp[kind.add]({ user: local.handle }, actor.token);
      expect(first.status(), await first.text()).toBe(204);
      expect(await first.text()).toBe("");
      const repeat = await sgp[kind.add]({ user: local.handle }, actor.token);
      expect(repeat.status(), await repeat.text()).toBe(204);
      const other = kind.flag === "blocked" ? "muted" : "blocked";
      expect(await stateOf(sgp, actor.token, local.handle)).toMatchObject({
        [kind.flag]: true,
        [other]: false,
      });
      // A repeat is a no-op: one audit event, no words, no target DID in the
      // payload.
      const created = hubAuditEventsForActor(actor.did, kind.created, "sgp");
      expect(created).toHaveLength(1);
      expect(created[0]?.entity_id).toBe(local.did);
      expect(created[0]?.payload).toEqual({ schema_version: 1 });

      const added = await sgp[kind.add]({ user: remote.handle }, actor.token);
      expect(added.status(), await added.text()).toBe(204);
      expect(await stateOf(sgp, actor.token, remote.handle)).toMatchObject({
        [kind.flag]: true,
      });
      const listed = await handles(await sgp[kind.list]({}, actor.token));
      expect(listed.users.map((entry) => entry.handle)).toEqual([
        remote.handle,
        local.handle,
      ]);
      expect(listed.next_pagination_key).toBeUndefined();
      expect(Date.parse(listed.users[0]?.created_at ?? "")).toBeGreaterThan(0);
      // The other list is separate.
      expect(await handles(await sgp[kind.otherList]({}, actor.token))).toEqual(
        { users: [] },
      );

      // The other side sees no change: empty state, empty lists, and the
      // actor's profile still reads.
      const mirror = new HubBlocksAPI(new HubAPI(request, "sgp"));
      expect(await stateOf(mirror, local.token, actor.handle)).toEqual({
        blocked: false,
        muted: false,
      });
      expect(await handles(await mirror[kind.list]({}, local.token))).toEqual({
        users: [],
      });
      const read = await new HubAPI(request, "sgp").readProfile(
        { address: actor.handle },
        local.token,
      );
      expect(read.status(), await read.text()).toBe(200);
      expect(((await read.json()) as PublicProfile).handle).toBe(actor.handle);

      const removed = await sgp[kind.remove](
        { user: local.handle },
        actor.token,
      );
      expect(removed.status(), await removed.text()).toBe(204);
      expect(await stateOf(sgp, actor.token, local.handle)).toEqual({
        blocked: false,
        muted: false,
      });
      const afterRemove = await handles(await sgp[kind.list]({}, actor.token));
      expect(afterRemove.users.map((entry) => entry.handle)).toEqual([
        remote.handle,
      ]);
      const removedAgain = await sgp[kind.remove](
        { user: local.handle },
        actor.token,
      );
      expect(removedAgain.status(), await removedAgain.text()).toBe(204);
      expect(
        hubAuditEventsForActor(actor.did, kind.deleted, "sgp"),
      ).toHaveLength(1);
      expect(
        hubAuditEventsForActor(actor.did, kind.created, "sgp"),
      ).toHaveLength(2);
    } finally {
      cast.cleanup();
    }
  });

  test(`${kind.name} refuses a missing user, the caller, and a bad address`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    const api = new HubBlocksAPI(new HubAPI(request, "sgp"));
    try {
      const actor = await cast.user("sgp");
      for (const operation of [kind.add, kind.remove] as const) {
        await expectProblem(
          await api[operation]({ user: unknownHandle() }, actor.token),
          404,
          ProfileNotFoundError.type,
        );
        await expectProblem(
          await api[operation]({ user: actor.handle }, actor.token),
          400,
          ValidationFailedError.type,
        );
        await expectProblem(
          await api[operation]({ user: "!" }, actor.token),
          400,
          ValidationFailedError.type,
        );
      }
      expect(await handles(await api[kind.list]({}, actor.token))).toEqual({
        users: [],
      });
      expect(
        hubAuditEventsForActor(actor.did, kind.created, "sgp"),
      ).toHaveLength(0);
    } finally {
      cast.cleanup();
    }
  });

  test(`${kind.name} list pages newest first by keyset and refuses bad limits and keys`, async ({
    request,
  }) => {
    const cast = new Cast(request);
    const api = new HubBlocksAPI(new HubAPI(request, "sgp"));
    try {
      const actor = await cast.user("sgp");
      const targets = [
        await cast.user("sgp"),
        await cast.user("usa1"),
        await cast.user("sgp"),
      ];
      const stranger = await cast.user("sgp");
      for (const target of targets) {
        const added = await api[kind.add]({ user: target.handle }, actor.token);
        expect(added.status(), await added.text()).toBe(204);
      }
      const expected = [...targets].reverse().map((target) => target.handle);

      const seen: string[] = [];
      let key: string | undefined;
      for (let pageNumber = 0; pageNumber < 3; pageNumber++) {
        const page = await handles(
          await api[kind.list](
            { limit: 1, ...(key === undefined ? {} : { pagination_key: key }) },
            actor.token,
          ),
        );
        expect(page.users).toHaveLength(1);
        seen.push(page.users[0]?.handle ?? "");
        key = page.next_pagination_key;
        if (pageNumber < 2) expect(key).toBeDefined();
        else expect(key).toBeUndefined();
      }
      expect(seen).toEqual(expected);

      const first = await handles(
        await api[kind.list]({ limit: 1 }, actor.token),
      );
      const validKey = first.next_pagination_key ?? "";
      expect(validKey).not.toBe("");
      for (const limit of [0, 51]) {
        await expectProblem(
          await api[kind.list]({ limit }, actor.token),
          400,
          ValidationFailedError.type,
        );
      }
      const tampered = `${validKey.slice(0, -1)}${validKey.endsWith("A") ? "B" : "A"}`;
      await expectProblem(
        await api[kind.list]({ pagination_key: tampered }, actor.token),
        400,
        InvalidPaginationKeyError.type,
      );
      await expectProblem(
        await api[kind.list]({ pagination_key: "not-a-key" }, actor.token),
        400,
        InvalidPaginationKeyError.type,
      );
      // A key belongs to one user and one list.
      await expectProblem(
        await api[kind.list]({ pagination_key: validKey }, stranger.token),
        400,
        InvalidPaginationKeyError.type,
      );
      await expectProblem(
        await api[kind.otherList]({ pagination_key: validKey }, actor.token),
        400,
        InvalidPaginationKeyError.type,
      );
      const maximum = await handles(
        await api[kind.list]({ limit: 50 }, actor.token),
      );
      expect(maximum.users.map((entry) => entry.handle)).toEqual(expected);
    } finally {
      cast.cleanup();
    }
  });
}

test("every block and mute operation refuses a missing session, a bad session, and invalid JSON", async ({
  request,
}) => {
  const cast = new Cast(request);
  const hub = new HubAPI(request, "sgp");
  const api = new HubBlocksAPI(hub);
  try {
    const actor = await cast.user("sgp");
    for (const operation of allOperations) {
      const body = operation.endsWith("/list") ? {} : { user: actor.handle };
      for (const token of [undefined, "not-a-session"]) {
        const response = await api.raw(operation, body, token);
        expect(response.status(), `${operation} ${await response.text()}`).toBe(
          401,
        );
        expect(response.headers()["www-authenticate"]).toContain("Bearer");
        expect((await response.json()).type).toBe(
          AuthenticationRequiredError.type,
        );
      }
      const malformed = await api.rawJSON(operation, "{not json", actor.token);
      await expectProblem(malformed, 400, InvalidJSONError.type);
      const wrongShape = await api.raw(
        operation,
        operation.endsWith("/list") ? { limit: "many" } : { user: 7 },
        actor.token,
      );
      // A field of the wrong JSON type fails decoding, not validation.
      await expectProblem(wrongShape, 400, InvalidJSONError.type);
    }
  } finally {
    cast.cleanup();
  }
});

test("a block and a mute resolve an alias to the permanent handle", async ({
  request,
}) => {
  const cast = new Cast(request);
  const hub = new HubAPI(request, "sgp");
  const api = new HubBlocksAPI(hub);
  try {
    const actor = await cast.user("sgp");
    const target = await cast.user("sgp");
    const upgradeKey = hubIdempotencyKey();
    target.keys.push(upgradeKey);
    const upgraded = await hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "month" },
      { token: target.token, idempotencyKey: upgradeKey },
    );
    expect(upgraded.status(), await upgraded.text()).toBe(200);
    const alias = `alias-${randomUUID().replaceAll("-", "").slice(0, 18)}`;
    const aliasKey = hubIdempotencyKey();
    target.keys.push(aliasKey);
    const claim = await hub.setAlias(
      { profile_alias: alias },
      { token: target.token, idempotencyKey: aliasKey },
    );
    expect(claim.status(), await claim.text()).toBe(202);
    const operationID = ((await claim.json()) as { operation_id: string })
      .operation_id;
    await expect
      .poll(
        async () => {
          const status = await hub.operationStatus(
            { operation_id: operationID },
            target.token,
          );
          return ((await status.json()) as OperationStatus).state;
        },
        { timeout: 15000 },
      )
      .toBe("succeeded");

    const blocked = await api.block({ user: alias }, actor.token);
    expect(blocked.status(), await blocked.text()).toBe(204);
    const muted = await api.mute({ user: alias }, actor.token);
    expect(muted.status(), await muted.text()).toBe(204);
    expect(await stateOf(api, actor.token, alias)).toEqual({
      blocked: true,
      muted: true,
    });
    expect(await stateOf(api, actor.token, target.handle)).toEqual({
      blocked: true,
      muted: true,
    });
    const blockedList = await handles(await api.listBlocks({}, actor.token));
    expect(blockedList.users.map((entry) => entry.handle)).toEqual([
      target.handle,
    ]);
    const mutedList = await handles(await api.listMutes({}, actor.token));
    expect(mutedList.users.map((entry) => entry.handle)).toEqual([
      target.handle,
    ]);
    // The same user by handle is the same row.
    const again = await api.block({ user: target.handle }, actor.token);
    expect(again.status(), await again.text()).toBe(204);
    expect(
      hubAuditEventsForActor(actor.did, "hub.block.created", "sgp"),
    ).toHaveLength(1);
    const unblocked = await api.unblock({ user: alias }, actor.token);
    expect(unblocked.status(), await unblocked.text()).toBe(204);
    expect(await stateOf(api, actor.token, target.handle)).toEqual({
      blocked: false,
      muted: true,
    });
  } finally {
    cast.cleanup();
  }
});

// The mesh block check is what a post owner's tenant uses to refuse a
// blocked replier. The serving tenant must home the blocker and must verify
// that the calling tenant homes the viewer (PST-RD-003).
test("mesh block check answers for a blocker in another region and refuses a caller that does not home the viewer", async ({
  request,
  apiCoverage,
}) => {
  const cast = new Cast(request);
  const usa1 = new HubBlocksAPI(new HubAPI(request, "usa1"));
  try {
    const blocker = await cast.user("usa1", "Blocker");
    const viewer = await cast.user("sgp", "Viewer");
    const body: CheckBlockRequest = {
      blocker_hub_user_did: blocker.did,
      blocked_hub_user_did: viewer.did,
      viewer_handle: viewer.handle,
    };
    const check = (): { status: number; body: unknown } =>
      meshPeerRequest("sgp", "usa1", body, apiCoverage, {
        path: "/api/mesh/blocks/check",
      });
    const relay = (): { status: number; body: unknown } =>
      meshRelayRequest("sgp", "/mesh/blocks/check", body, apiCoverage);

    for (const call of [check, relay]) {
      const before = call();
      expect(before.status, JSON.stringify(before.body)).toBe(200);
      expect((before.body as CheckBlockResponse).blocked).toBe(false);
    }
    const added = await usa1.block({ user: viewer.handle }, blocker.token);
    expect(added.status(), await added.text()).toBe(204);
    for (const call of [check, relay]) {
      const after = call();
      expect(after.status, JSON.stringify(after.body)).toBe(200);
      expect((after.body as CheckBlockResponse).blocked).toBe(true);
    }
    // The reverse direction is not a block.
    const reverse = meshPeerRequest(
      "sgp",
      "usa1",
      {
        blocker_hub_user_did: viewer.did,
        blocked_hub_user_did: blocker.did,
        viewer_handle: blocker.handle,
      } satisfies CheckBlockRequest,
      apiCoverage,
      { path: "/api/mesh/blocks/check" },
    );
    expect(reverse.status).toBe(404);

    // deu does not home the viewer, so usa1 refuses and reveals nothing.
    const stranger = meshPeerRequest("deu", "usa1", body, apiCoverage, {
      path: "/api/mesh/blocks/check",
    });
    expect(stranger.status, JSON.stringify(stranger.body)).toBe(404);
    expect(stranger.body).toMatchObject({ type: ProfileNotFoundError.type });
    expect(JSON.stringify(stranger.body)).not.toContain("blocked");

    // A viewer handle that does not match the viewer DID is refused too.
    const mismatch = meshRelayRequest(
      "sgp",
      "/mesh/blocks/check",
      { ...body, viewer_handle: unknownHandle() },
      apiCoverage,
    );
    expect(mismatch.status, JSON.stringify(mismatch.body)).toBe(404);
    expect(mismatch.body).toMatchObject({ type: ProfileNotFoundError.type });
  } finally {
    cast.cleanup();
  }
});

test("mesh block check rejects malformed JSON, an invalid field, an unknown blocker, and a missing relay credential", async ({
  request,
  apiCoverage,
}) => {
  const cast = new Cast(request);
  try {
    const viewer = await cast.user("sgp", "Viewer");
    const valid: CheckBlockRequest = {
      blocker_hub_user_did: randomHubUserDID(),
      blocked_hub_user_did: viewer.did,
      viewer_handle: viewer.handle,
    };
    const relayPath = "/mesh/blocks/check";
    const peerPath = "/api/mesh/blocks/check";

    const relayMalformed = meshRelayRequest(
      "sgp",
      relayPath,
      undefined,
      apiCoverage,
      { rawBody: "{not json" },
    );
    expect(relayMalformed.status).toBe(400);
    expect(relayMalformed.body).toMatchObject({ type: InvalidJSONError.type });
    const peerMalformed = meshPeerRequest(
      "sgp",
      "usa1",
      undefined,
      apiCoverage,
      {
        path: peerPath,
        rawBody: "{not json",
      },
    );
    expect(peerMalformed.status).toBe(400);
    expect(peerMalformed.body).toMatchObject({ type: InvalidJSONError.type });

    const invalid = { ...valid, blocker_hub_user_did: "not-a-did" };
    const relayInvalid = meshRelayRequest(
      "sgp",
      relayPath,
      invalid,
      apiCoverage,
    );
    expect(relayInvalid.status).toBe(400);
    expect(relayInvalid.body).toMatchObject({
      type: ValidationFailedError.type,
    });
    const peerInvalid = meshPeerRequest("sgp", "usa1", invalid, apiCoverage, {
      path: peerPath,
    });
    expect(peerInvalid.status).toBe(400);
    expect(peerInvalid.body).toMatchObject({
      type: ValidationFailedError.type,
    });

    const missing = meshRelayRequest("sgp", relayPath, valid, apiCoverage, {
      authorization: null,
    });
    expect(missing.status).toBe(401);
    expect(missing.body).toMatchObject({
      type: "vetchium-problem-details/mesh-relay-authentication-required",
    });

    // The blocker is in no directory: the answer is the same not-found.
    const unknown = meshRelayRequest("sgp", relayPath, valid, apiCoverage);
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(404);
    expect(unknown.body).toMatchObject({ type: ProfileNotFoundError.type });
  } finally {
    cast.cleanup();
  }
});

// ind1's coordinator link is deliberately broken in CI (config/ci/ind1.json),
// so ind1 cannot verify the viewer and answers unavailable.
test("mesh block check reports unavailable when the serving tenant cannot reach its directory", async ({
  apiCoverage,
}) => {
  const body: CheckBlockRequest = {
    blocker_hub_user_did: randomHubUserDID(),
    blocked_hub_user_did: randomHubUserDID(),
    viewer_handle: unknownHandle(),
  };
  const response = meshPeerRequest("sgp", "ind1", body, apiCoverage, {
    path: "/api/mesh/blocks/check",
  });
  expect(response.status, JSON.stringify(response.body)).toBe(503);
  expect(response.body).toMatchObject({ type: ProfileUnavailableError.type });
});
