import { randomBytes, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type {
  OperationStatus,
  PendingOperation,
} from "typespec/hub/operations/operations";
import type { AliasState } from "typespec/hub/profile/alias";
import type { PublicProfile } from "typespec/hub/profile/public";
import { IdempotencyKeyConflictError } from "typespec/problem/common";
import {
  InvalidJSONError,
  ValidationFailedError,
} from "typespec/problem/details";
import { AuthenticationRequiredError } from "typespec/problem/hub/authentication";
import {
  ProfileConflictError,
  ProfileNotFoundError,
  ProfileUnavailableError,
} from "typespec/problem/hub/profile";
import { PlanRequiredErrorType } from "typespec/problem/hub/subscriptions";
import {
  cleanupGlobalHubPrincipal,
  cleanupHubAliasClaim,
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  seedGlobalHubPrincipal,
  seedHubSignupDomain,
  type TestTenant,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { HubAPI, hubIdempotencyKey } from "../lib/hub-api.ts";
import { login, signup } from "../lib/hub-signup.ts";

const CROCKFORD_BASE32 = "0123456789abcdefghjkmnpqrstvwxyz";

function randomFromAlphabet(alphabet: string, length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let index = 0; index < length; index++) {
    out += alphabet.charAt(bytes.readUInt8(index) % alphabet.length);
  }
  return out;
}

/** A syntactically valid alias-shaped slug that no real principal owns. */
function unreachableProfileAlias(): string {
  return `e2e-${randomFromAlphabet(CROCKFORD_BASE32, 20)}`;
}

/** A UUIDv7-shaped DID: version and variant nibbles set, rest random. */
function fakeHubUserDID(): string {
  const bytes = randomBytes(16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

interface ProfileUser {
  email: string;
  handle: string;
  did: string;
  token: string;
  keys: string[];
}

async function createUser(
  request: APIRequestContext,
  tenant: TestTenant,
  domain: string,
  displayName: string,
  residentCountry?: string,
): Promise<ProfileUser> {
  const email = `e2e+${randomUUID()}@${domain}`;
  const keys: string[] = [];
  const signedUp = await signup(request, tenant, email, keys, {
    displayName,
    ...(residentCountry === undefined ? {} : { residentCountry }),
  });
  const token = await login(request, tenant, email, signedUp.password);
  return {
    email,
    handle: signedUp.handle,
    did: signedUp.hubUserDID,
    token,
    keys,
  };
}

function cleanupUser(user: ProfileUser, tenant: TestTenant) {
  cleanupHubAliasClaim(user.did);
  cleanupHubUser(user.email, tenant);
  cleanupHubIdempotency(user.keys, tenant);
}

test("a Hub session reads local and remote profiles without private email evidence", async ({
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const sgp = new HubAPI(request, "sgp");
  // usa1 is the remote home tenant: deu keeps signup closed for the
  // regional-admission cases in signup-regions.spec.ts.
  const usa1 = new HubAPI(request, "usa1");
  let owner: ProfileUser | undefined;
  let viewer: ProfileUser | undefined;
  try {
    seedHubSignupDomain(domain, "sgp");
    seedHubSignupDomain(domain, "usa1");
    owner = await createUser(request, "usa1", domain, "Remote Colleague", "US");
    viewer = await createUser(request, "sgp", domain, "Local Viewer");

    const local = await usa1.readProfile(
      { address: owner.handle },
      owner.token,
    );
    expect(local.status(), await local.text()).toBe(200);
    expect(local.headers()["cache-control"]).toBe("no-store");
    const localProfile = (await local.json()) as PublicProfile;
    expect(localProfile.handle).toBe(owner.handle);
    expect(localProfile.display_name).toBe("Remote Colleague");
    expect(JSON.stringify(localProfile)).not.toContain("email_address");

    const remote = await sgp.readProfile(
      { address: owner.handle },
      viewer.token,
    );
    expect(remote.status(), await remote.text()).toBe(200);
    expect(remote.headers()["cache-control"]).toBe("no-store");
    const remoteProfile = (await remote.json()) as PublicProfile;
    expect(remoteProfile).toEqual(localProfile);
    expect(JSON.stringify(remoteProfile)).not.toContain("professional_email");

    const unknown = `ghost-${randomBytes(8).toString("hex").slice(0, 11)}`;
    const missing = await sgp.readProfile({ address: unknown }, viewer.token);
    expect(missing.status()).toBe(404);
    expect((await missing.json()).type).toBe(ProfileNotFoundError.type);

    const malformed = await sgp.post(
      "/profile/read",
      { address: "bad--alias" },
      { token: viewer.token },
    );
    expect(malformed.status()).toBe(400);
    expect(malformed.headers()["content-type"]).toContain(
      "application/problem+json",
    );
    const withoutSession = await sgp.post("/profile/read", {
      address: owner.handle,
    });
    expect(withoutSession.status()).toBe(401);
    expect(withoutSession.headers()["www-authenticate"]).toContain("Bearer");
  } finally {
    if (viewer !== undefined) cleanupUser(viewer, "sgp");
    if (owner !== undefined) cleanupUser(owner, "usa1");
    cleanupHubSignupDomain(domain, "sgp");
    cleanupHubSignupDomain(domain, "usa1");
  }
});

test("paid aliases are globally claimed through a durable owner operation", async ({
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const hub = new HubAPI(request, "sgp");
  let owner: ProfileUser | undefined;
  let other: ProfileUser | undefined;
  try {
    seedHubSignupDomain(domain, "sgp");
    owner = await createUser(request, "sgp", domain, "Alias Owner");
    other = await createUser(request, "sgp", domain, "Another User");
    const initial = await hub.aliasState(owner.token);
    expect(initial.status()).toBe(200);
    expect(initial.headers()["cache-control"]).toBe("no-store");
    expect((await initial.json()) as AliasState).toEqual({
      profile_alias: null,
    });
    const unauthenticated = await request.get(
      `${hub.origin}/api/hub/profile/alias/state`,
    );
    expect(unauthenticated.status()).toBe(401);

    const alias = `alias-${randomUUID().replaceAll("-", "").slice(0, 18)}`;
    const freeKey = hubIdempotencyKey();
    owner.keys.push(freeKey);
    const free = await hub.setAlias(
      { profile_alias: alias },
      { token: owner.token, idempotencyKey: freeKey },
    );
    expect(free.status()).toBe(403);
    expect((await free.json()).type).toBe(PlanRequiredErrorType);

    for (const user of [owner, other]) {
      const key = hubIdempotencyKey();
      user.keys.push(key);
      const upgraded = await hub.setSubscriptionPlan(
        { plan_oid: "hub-silver-tier", billing_interval: "month" },
        { token: user.token, idempotencyKey: key },
      );
      expect(upgraded.status(), await upgraded.text()).toBe(200);
    }

    const claimKey = hubIdempotencyKey();
    owner.keys.push(claimKey);
    const claim = await hub.setAlias(
      { profile_alias: alias },
      { token: owner.token, idempotencyKey: claimKey },
    );
    expect(claim.status(), await claim.text()).toBe(202);
    expect(claim.headers()["cache-control"]).toBe("no-store");
    const pending = (await claim.json()) as PendingOperation;
    expect(pending.operation_id).toMatch(/^[0-9a-f-]{36}$/);
    const ownerToken = owner.token;
    await expect
      .poll(
        async () => {
          const status = await hub.operationStatus(
            { operation_id: pending.operation_id },
            ownerToken,
          );
          expect(status.status()).toBe(200);
          return ((await status.json()) as OperationStatus).state;
        },
        { timeout: 15000 },
      )
      .toBe("succeeded");
    const claimedState = await hub.aliasState(owner.token);
    expect(claimedState.status()).toBe(200);
    const state = (await claimedState.json()) as AliasState;
    expect(state.profile_alias).toBe(alias);
    expect(state.next_change_at).toBeDefined();
    const read = await hub.readProfile({ address: alias }, other.token);
    expect(read.status(), await read.text()).toBe(200);
    expect(((await read.json()) as PublicProfile).handle).toBe(owner.handle);

    const cooldownKey = hubIdempotencyKey();
    owner.keys.push(cooldownKey);
    const cooldown = await hub.setAlias(
      { profile_alias: `${alias}-new` },
      { token: owner.token, idempotencyKey: cooldownKey },
    );
    expect(cooldown.status()).toBe(409);
    expect((await cooldown.json()).type).toBe(ProfileConflictError.type);
    const privateStatus = await hub.operationStatus(
      { operation_id: pending.operation_id },
      other.token,
    );
    expect(privateStatus.status()).toBe(404);

    const duplicateKey = hubIdempotencyKey();
    other.keys.push(duplicateKey);
    const duplicate = await hub.setAlias(
      { profile_alias: alias },
      { token: other.token, idempotencyKey: duplicateKey },
    );
    expect(duplicate.status(), await duplicate.text()).toBe(202);
    const collision = (await duplicate.json()) as PendingOperation;
    const otherToken = other.token;
    await expect
      .poll(
        async () => {
          const status = await hub.operationStatus(
            { operation_id: collision.operation_id },
            otherToken,
          );
          return ((await status.json()) as OperationStatus).state;
        },
        { timeout: 15000 },
      )
      .toBe("failed");
    const stillOwner = await hub.readProfile({ address: alias }, owner.token);
    expect(stillOwner.status()).toBe(200);
    expect(((await stillOwner.json()) as PublicProfile).handle).toBe(
      owner.handle,
    );
  } finally {
    if (other !== undefined) cleanupUser(other, "sgp");
    if (owner !== undefined) cleanupUser(owner, "sgp");
    cleanupHubSignupDomain(domain, "sgp");
  }
});

test("a replayed alias idempotency key with a different alias is a conflict", async ({
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const hub = new HubAPI(request, "sgp");
  let owner: ProfileUser | undefined;
  try {
    seedHubSignupDomain(domain, "sgp");
    owner = await createUser(request, "sgp", domain, "Alias Conflict Owner");
    const upgradeKey = hubIdempotencyKey();
    owner.keys.push(upgradeKey);
    const upgraded = await hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "month" },
      { token: owner.token, idempotencyKey: upgradeKey },
    );
    expect(upgraded.status(), await upgraded.text()).toBe(200);

    const key = hubIdempotencyKey();
    owner.keys.push(key);
    const firstAlias = `alias-${randomUUID().replaceAll("-", "").slice(0, 18)}`;
    const first = await hub.setAlias(
      { profile_alias: firstAlias },
      { token: owner.token, idempotencyKey: key },
    );
    expect(first.status(), await first.text()).toBe(202);

    const secondAlias = `alias-${randomUUID().replaceAll("-", "").slice(0, 18)}`;
    const conflicting = await hub.setAlias(
      { profile_alias: secondAlias },
      { token: owner.token, idempotencyKey: key },
    );
    expect(conflicting.status()).toBe(409);
    expect((await conflicting.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );
  } finally {
    if (owner !== undefined) cleanupUser(owner, "sgp");
    cleanupHubSignupDomain(domain, "sgp");
  }
});

test("setting an alias requires authentication and rejects a malformed or invalid request", async ({
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const hub = new HubAPI(request, "sgp");
  let owner: ProfileUser | undefined;
  try {
    seedHubSignupDomain(domain, "sgp");
    owner = await createUser(request, "sgp", domain, "Alias Guard Owner");

    // PROF-GEN-002: every write requires an authenticated session.
    const unauthenticated = await hub.post(
      "/profile/alias/set",
      { profile_alias: `alias-${randomUUID().replaceAll("-", "")}` },
      { idempotencyKey: hubIdempotencyKey() },
    );
    expect(unauthenticated.status()).toBe(401);
    expect((await unauthenticated.json()).type).toBe(
      AuthenticationRequiredError.type,
    );
    expect(unauthenticated.headers()["www-authenticate"]).toContain("Bearer");

    // 400 invalid-json: a malformed body is rejected before validation runs.
    const malformedKey = hubIdempotencyKey();
    owner.keys.push(malformedKey);
    const malformed = await hub.postRaw("/profile/alias/set", "{not json", {
      token: owner.token,
      idempotencyKey: malformedKey,
    });
    expect(malformed.status()).toBe(400);
    expect((await malformed.json()).type).toBe(InvalidJSONError.type);

    // 400 validation-failed: an alias shorter than the three-character
    // minimum fails before any plan or availability check runs.
    const invalidKey = hubIdempotencyKey();
    owner.keys.push(invalidKey);
    const invalid = await hub.setAlias(
      { profile_alias: "ab" },
      { token: owner.token, idempotencyKey: invalidKey },
    );
    expect(invalid.status()).toBe(400);
    const invalidBody = await invalid.json();
    expect(invalidBody.type).toBe(ValidationFailedError.type);
    expect(invalidBody.fields).toContain("profile_alias");
  } finally {
    if (owner !== undefined) cleanupUser(owner, "sgp");
    cleanupHubSignupDomain(domain, "sgp");
  }
});

test("operation status requires authentication and a well-formed operation id", async ({
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const hub = new HubAPI(request, "sgp");
  let owner: ProfileUser | undefined;
  try {
    seedHubSignupDomain(domain, "sgp");
    owner = await createUser(request, "sgp", domain, "Operation Status Guard");

    const unauthenticated = await hub.post("/operations/status", {
      operation_id: randomUUID(),
    });
    expect(unauthenticated.status()).toBe(401);
    expect(unauthenticated.headers()["www-authenticate"]).toContain("Bearer");

    const malformed = await hub.operationStatus(
      { operation_id: "not-a-uuid" },
      owner.token,
    );
    expect(malformed.status()).toBe(400);
    const malformedBody = await malformed.json();
    expect(malformedBody.type).toBe(ValidationFailedError.type);
    expect(malformedBody.fields).toContain("operation_id");

    // 400 invalid-json: a malformed body is rejected before validation runs.
    const malformedJSON = await hub.postRaw("/operations/status", "{not json", {
      token: owner.token,
    });
    expect(malformedJSON.status()).toBe(400);
    expect((await malformedJSON.json()).type).toBe(InvalidJSONError.type);
  } finally {
    if (owner !== undefined) cleanupUser(owner, "sgp");
    cleanupHubSignupDomain(domain, "sgp");
  }
});

test("reading a profile rejects a malformed request body", async ({
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const hub = new HubAPI(request, "sgp");
  let viewer: ProfileUser | undefined;
  try {
    seedHubSignupDomain(domain, "sgp");
    viewer = await createUser(request, "sgp", domain, "Malformed Read Viewer");
    const malformed = await hub.postRaw("/profile/read", "{not json", {
      token: viewer.token,
    });
    expect(malformed.status()).toBe(400);
    expect((await malformed.json()).type).toBe(InvalidJSONError.type);
  } finally {
    if (viewer !== undefined) cleanupUser(viewer, "sgp");
    cleanupHubSignupDomain(domain, "sgp");
  }
});

test("reading a profile whose home tenant cannot be reached over the mesh is unavailable (PROF-FED-006)", async ({
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const hub = new HubAPI(request, "sgp");
  let viewer: ProfileUser | undefined;
  const fakeDID = fakeHubUserDID();
  const alias = unreachableProfileAlias();
  try {
    seedHubSignupDomain(domain, "sgp");
    viewer = await createUser(
      request,
      "sgp",
      domain,
      "Unreachable Home Viewer",
    );

    // config/ci/ind1.json deliberately points ind1's mesh-api at an
    // unreachable coordinator (see signup-regions.spec.ts). Seeding a
    // directory entry that homes an address at ind1, then reading it from
    // sgp, drives the peer relay into that broken resolution without
    // stopping any container.
    seedGlobalHubPrincipal(fakeDID, "ind1", alias);

    const response = await hub.readProfile({ address: alias }, viewer.token);
    expect(response.status(), await response.text()).toBe(503);
    expect((await response.json()).type).toBe(ProfileUnavailableError.type);
  } finally {
    cleanupGlobalHubPrincipal(fakeDID, alias);
    if (viewer !== undefined) cleanupUser(viewer, "sgp");
    cleanupHubSignupDomain(domain, "sgp");
  }
});
