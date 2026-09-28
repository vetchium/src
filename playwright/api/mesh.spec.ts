import { randomBytes, randomUUID } from "node:crypto";
import type {
  ActivateHubPrincipalRequest,
  PrincipalCommandResponse,
  ReserveHubPrincipalRequest,
  ResolveProfileSlugRequest,
  ResolveProfileSlugResponse,
  SetHubAliasRequest,
} from "typespec/directory/directory";
import type {
  PeerReadProfileRequest,
  RelayReadProfileRequest,
} from "typespec/hub/profile/federation";
import type { PublicProfile } from "typespec/hub/profile/public";
import type {
  ListSignupRegionsRequest,
  ListSignupRegionsResponse,
} from "typespec/regions/regions";
import type { TestTenant } from "../lib/admin-db.ts";
import {
  cleanupGlobalHubPrincipal,
  cleanupHubAliasClaim,
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  seedGlobalHubPrincipal,
  seedHubSignupDomain,
} from "../lib/admin-db.ts";
import { type APIObservation, expect, test } from "../lib/admin-fixtures.ts";
import { signup } from "../lib/hub-signup.ts";
import type { MeshResponse } from "../lib/mesh.ts";
import { meshPeerRequest, meshRelayRequest } from "../lib/mesh.ts";

// Crockford base32 without i, l, o, u, matching the Hub handle suffix shape.
const HANDLE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function randomSuffix(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const byte of bytes)
    out += HANDLE_ALPHABET[byte % HANDLE_ALPHABET.length];
  return out;
}

// The global directory requires a UUIDv7 shape (version nibble '7'); the
// fixed prefix pins that shape while the suffix keeps each DID unique.
function randomHubUserDID(): string {
  return `018f7e32-7b5a-7d31-8fd0-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function randomHubHandle(): string {
  const prefix = randomUUID().replaceAll("-", "").slice(0, 8);
  return `${prefix}-${randomSuffix(11)}`;
}

function randomAlias(): string {
  return `e2e-${randomSuffix(20)}`;
}

// config/ci/global-coordinator.json's identityDigestKeyId; ReserveHubPrincipal
// rejects any other key id outright (GU-KEY-002), before ever looking at the
// digest itself, so every reservation here must send it. The digest value
// need not be a real HMAC output: the coordinator only stores and uniques it.
const DIGEST_KEY_ID = "909577e87ebd5395";

function randomEmailDigest(): string {
  return randomBytes(32).toString("hex");
}

function freshReservation(
  homeTenantID: string,
  overrides: Partial<ReserveHubPrincipalRequest> = {},
): ReserveHubPrincipalRequest {
  return {
    command_id: randomUUID(),
    hub_user_did: randomHubUserDID(),
    handle: randomHubHandle(),
    home_tenant_id: homeTenantID,
    provisioning_expires_at: new Date(Date.now() + 60_000).toISOString(),
    account_email_digest: randomEmailDigest(),
    digest_key_id: DIGEST_KEY_ID,
    ...overrides,
  };
}

const DIRECTORY_ROUTES = [
  {
    name: "resolve-profile-slug",
    path: "/mesh/directory/resolve-profile-slug",
  },
  {
    name: "reserve-hub-principal",
    path: "/mesh/directory/reserve-hub-principal",
  },
  {
    name: "activate-hub-principal",
    path: "/mesh/directory/activate-hub-principal",
  },
  { name: "set-hub-alias", path: "/mesh/directory/set-hub-alias" },
] as const;

// A structurally valid body for each route, used as the base for the 400
// cases below. Values need not correspond to real directory state: every
// case here is rejected before the directory is called.
function baseBody(
  path: (typeof DIRECTORY_ROUTES)[number]["path"],
): Record<string, unknown> {
  switch (path) {
    case "/mesh/directory/resolve-profile-slug":
      return { slug: randomHubHandle() };
    case "/mesh/directory/reserve-hub-principal":
      return { ...freshReservation("sgp") };
    case "/mesh/directory/activate-hub-principal":
      return { command_id: randomUUID(), hub_user_did: randomHubUserDID() };
    case "/mesh/directory/set-hub-alias":
      return {
        command_id: randomUUID(),
        hub_user_did: randomHubUserDID(),
        profile_alias: randomAlias(),
      };
  }
}

function invalidFieldBody(
  path: (typeof DIRECTORY_ROUTES)[number]["path"],
): Record<string, unknown> {
  const base = baseBody(path);
  switch (path) {
    case "/mesh/directory/resolve-profile-slug":
      return { ...base, slug: "ab" };
    case "/mesh/directory/reserve-hub-principal":
    case "/mesh/directory/activate-hub-principal":
      return { ...base, command_id: "not-a-command-id" };
    case "/mesh/directory/set-hub-alias":
      return { ...base, profile_alias: "ab" };
  }
}

function resolveProfileSlug(
  tenant: TestTenant,
  slug: string,
  observations: APIObservation[],
): MeshResponse {
  const body: ResolveProfileSlugRequest = { slug };
  return meshRelayRequest(
    tenant,
    "/mesh/directory/resolve-profile-slug",
    body,
    observations,
  );
}

function reserveHubPrincipal(
  tenant: TestTenant,
  request: ReserveHubPrincipalRequest,
  observations: APIObservation[],
): MeshResponse {
  return meshRelayRequest(
    tenant,
    "/mesh/directory/reserve-hub-principal",
    request,
    observations,
  );
}

function activateHubPrincipal(
  tenant: TestTenant,
  request: ActivateHubPrincipalRequest,
  observations: APIObservation[],
): MeshResponse {
  return meshRelayRequest(
    tenant,
    "/mesh/directory/activate-hub-principal",
    request,
    observations,
  );
}

function setHubAlias(
  tenant: TestTenant,
  request: SetHubAliasRequest,
  observations: APIObservation[],
): MeshResponse {
  return meshRelayRequest(
    tenant,
    "/mesh/directory/set-hub-alias",
    request,
    observations,
  );
}

/** Reserve and activate a fresh principal through the mesh relay, returning
 * its DID and handle. */
function activeMeshPrincipal(
  tenant: TestTenant,
  homeTenantID: string,
  observations: APIObservation[],
): { hubUserDID: string; handle: string } {
  const reservation = freshReservation(homeTenantID);
  const reserved = reserveHubPrincipal(tenant, reservation, observations);
  expect(reserved.status, JSON.stringify(reserved.body)).toBe(200);
  const activated = activateHubPrincipal(
    tenant,
    { command_id: randomUUID(), hub_user_did: reservation.hub_user_did },
    observations,
  );
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);
  return { hubUserDID: reservation.hub_user_did, handle: reservation.handle };
}

for (const route of DIRECTORY_ROUTES) {
  test(`${route.name} rejects a missing or incorrect relay credential`, async ({
    apiCoverage,
  }) => {
    const missing = meshRelayRequest(
      "sgp",
      route.path,
      baseBody(route.path),
      apiCoverage,
      { authorization: null },
    );
    expect(missing.status, JSON.stringify(missing.body)).toBe(401);
    expect(missing.body).toMatchObject({
      type: "vetchium-problem-details/mesh-relay-authentication-required",
      status: 401,
    });

    const wrong = meshRelayRequest(
      "sgp",
      route.path,
      baseBody(route.path),
      apiCoverage,
      { authorization: "wrong-credential" },
    );
    expect(wrong.status, JSON.stringify(wrong.body)).toBe(401);
    expect(wrong.body).toMatchObject({
      type: "vetchium-problem-details/mesh-relay-authentication-required",
      status: 401,
    });
  });
}

for (const route of DIRECTORY_ROUTES) {
  test(`${route.name} rejects malformed JSON and an invalid field over the mesh relay`, async ({
    apiCoverage,
  }) => {
    const malformed = meshRelayRequest(
      "sgp",
      route.path,
      undefined,
      apiCoverage,
      { rawBody: "{not json" },
    );
    expect(malformed.status, JSON.stringify(malformed.body)).toBe(400);
    expect(malformed.body).toMatchObject({
      type: "vetchium-problem-details/invalid-json",
      status: 400,
    });

    const invalid = meshRelayRequest(
      "sgp",
      route.path,
      invalidFieldBody(route.path),
      apiCoverage,
    );
    expect(invalid.status, JSON.stringify(invalid.body)).toBe(400);
    expect(invalid.body).toMatchObject({
      type: "vetchium-problem-details/validation-failed",
      status: 400,
    });
  });
}

test("resolve-profile-slug resolves an active principal's handle over the mesh relay", async ({
  apiCoverage,
}) => {
  const { hubUserDID, handle } = activeMeshPrincipal("sgp", "sgp", apiCoverage);
  const response = resolveProfileSlug("sgp", handle, apiCoverage);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body).toEqual({
    hub_user_did: hubUserDID,
    slug: handle,
    kind: "handle",
    home_tenant_id: "sgp",
    routing_version: 1,
  } satisfies ResolveProfileSlugResponse);
});

test("resolve-profile-slug reports not-found for an unknown or not-yet-active slug over the mesh relay", async ({
  apiCoverage,
}) => {
  const reservation = freshReservation("sgp");
  const reserved = reserveHubPrincipal("sgp", reservation, apiCoverage);
  expect(reserved.status, JSON.stringify(reserved.body)).toBe(200);

  // A provisioning handle is not yet public, and a slug never reserved
  // behaves identically: both are indistinguishable "not found" responses.
  for (const slug of [reservation.handle, randomHubHandle()]) {
    const response = resolveProfileSlug("sgp", slug, apiCoverage);
    expect(response.status, JSON.stringify(response.body)).toBe(404);
    expect(response.body).toMatchObject({
      type: "vetchium-problem-details/directory-entry-not-found",
      status: 404,
    });
  }
});

test("reserve-hub-principal deduplicates a repeated command and rejects a changed digest over the mesh relay", async ({
  apiCoverage,
}) => {
  const reservation = freshReservation("sgp");
  const first = reserveHubPrincipal("sgp", reservation, apiCoverage);
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(first.body).toEqual({
    hub_user_did: reservation.hub_user_did,
    handle: reservation.handle,
    profile_alias: null,
    home_tenant_id: "sgp",
    routing_version: 1,
    state: "provisioning",
  } satisfies PrincipalCommandResponse);

  const replay = reserveHubPrincipal("sgp", reservation, apiCoverage);
  expect(replay.status, JSON.stringify(replay.body)).toBe(200);
  expect(replay.body).toEqual(first.body);

  const changedDigest = reserveHubPrincipal(
    "sgp",
    { ...reservation, handle: randomHubHandle() },
    apiCoverage,
  );
  expect(changedDigest.status, JSON.stringify(changedDigest.body)).toBe(409);
  expect(changedDigest.body).toMatchObject({
    type: "vetchium-problem-details/idempotency-key-conflict",
    status: 409,
  });
});

test("reserve-hub-principal rejects a caller reserving another tenant's principal over the mesh relay", async ({
  apiCoverage,
}) => {
  // The relay forwards using the calling tenant's own client certificate, so
  // a payload claiming a different home tenant is a caller/tenant mismatch.
  const reservation = freshReservation("ind1");
  const mismatch = reserveHubPrincipal("sgp", reservation, apiCoverage);
  expect(mismatch.status, JSON.stringify(mismatch.body)).toBe(403);
  expect(mismatch.body).toMatchObject({
    type: "vetchium-problem-details/directory-caller-tenant-mismatch",
    status: 403,
  });

  // The rejected attempt must not have created a principal or claimed the
  // handle: the identical identity reserves cleanly once the tenant matches.
  const corrected = reserveHubPrincipal(
    "sgp",
    { ...reservation, command_id: randomUUID(), home_tenant_id: "sgp" },
    apiCoverage,
  );
  expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
});

test("reserve-hub-principal rejects a competing handle claim over the mesh relay", async ({
  apiCoverage,
}) => {
  const first = freshReservation("sgp");
  const reserved = reserveHubPrincipal("sgp", first, apiCoverage);
  expect(reserved.status, JSON.stringify(reserved.body)).toBe(200);

  const competing = reserveHubPrincipal(
    "sgp",
    { ...freshReservation("sgp"), handle: first.handle },
    apiCoverage,
  );
  expect(competing.status, JSON.stringify(competing.body)).toBe(409);
  expect(competing.body).toMatchObject({
    type: "vetchium-problem-details/directory-claim-conflict",
    status: 409,
  });
});

test("reserve-hub-principal rejects a provisioning window that has already expired over the mesh relay", async ({
  apiCoverage,
}) => {
  const expired = freshReservation("sgp", {
    provisioning_expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  const response = reserveHubPrincipal("sgp", expired, apiCoverage);
  expect(response.status, JSON.stringify(response.body)).toBe(409);
  expect(response.body).toMatchObject({
    type: "vetchium-problem-details/directory-state-conflict",
    status: 409,
  });
});

test("activate-hub-principal activates a reserved principal and makes it resolvable over the mesh relay", async ({
  apiCoverage,
}) => {
  const reservation = freshReservation("sgp");
  const reserved = reserveHubPrincipal("sgp", reservation, apiCoverage);
  expect(reserved.status, JSON.stringify(reserved.body)).toBe(200);

  const activated = activateHubPrincipal(
    "sgp",
    { command_id: randomUUID(), hub_user_did: reservation.hub_user_did },
    apiCoverage,
  );
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);
  expect(activated.body).toEqual({
    hub_user_did: reservation.hub_user_did,
    handle: reservation.handle,
    profile_alias: null,
    home_tenant_id: "sgp",
    routing_version: 1,
    state: "active",
  } satisfies PrincipalCommandResponse);

  const resolved = resolveProfileSlug("sgp", reservation.handle, apiCoverage);
  expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
});

test("activate-hub-principal rejects a caller outside the principal's home tenant over the mesh relay", async ({
  apiCoverage,
}) => {
  const reservation = freshReservation("sgp");
  const reserved = reserveHubPrincipal("sgp", reservation, apiCoverage);
  expect(reserved.status, JSON.stringify(reserved.body)).toBe(200);

  // usa1, not ind1: the mismatch must be a business decision by a healthy
  // coordinator connection, not ind1's own permanently broken one (which
  // would fail the relay's own command send with a 500 instead).
  const mismatch = activateHubPrincipal(
    "usa1",
    { command_id: randomUUID(), hub_user_did: reservation.hub_user_did },
    apiCoverage,
  );
  expect(mismatch.status, JSON.stringify(mismatch.body)).toBe(403);
  expect(mismatch.body).toMatchObject({
    type: "vetchium-problem-details/directory-caller-tenant-mismatch",
    status: 403,
  });

  // The rejected attempt must not have activated the principal.
  const corrected = activateHubPrincipal(
    "sgp",
    { command_id: randomUUID(), hub_user_did: reservation.hub_user_did },
    apiCoverage,
  );
  expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
});

test("activate-hub-principal rejects an unknown principal and a repeat activation over the mesh relay", async ({
  apiCoverage,
}) => {
  const unknown = activateHubPrincipal(
    "sgp",
    { command_id: randomUUID(), hub_user_did: randomHubUserDID() },
    apiCoverage,
  );
  expect(unknown.status, JSON.stringify(unknown.body)).toBe(409);
  expect(unknown.body).toMatchObject({
    type: "vetchium-problem-details/directory-state-conflict",
    status: 409,
  });

  const reservation = freshReservation("sgp");
  const reserved = reserveHubPrincipal("sgp", reservation, apiCoverage);
  expect(reserved.status, JSON.stringify(reserved.body)).toBe(200);
  const activated = activateHubPrincipal(
    "sgp",
    { command_id: randomUUID(), hub_user_did: reservation.hub_user_did },
    apiCoverage,
  );
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);

  const repeat = activateHubPrincipal(
    "sgp",
    { command_id: randomUUID(), hub_user_did: reservation.hub_user_did },
    apiCoverage,
  );
  expect(repeat.status, JSON.stringify(repeat.body)).toBe(409);
  expect(repeat.body).toMatchObject({
    type: "vetchium-problem-details/directory-state-conflict",
    status: 409,
  });

  // Reusing a command_id against a different principal changes the stored
  // request digest, which is an idempotency conflict rather than a state one.
  const otherReservation = freshReservation("sgp");
  const otherReserved = reserveHubPrincipal(
    "sgp",
    otherReservation,
    apiCoverage,
  );
  expect(otherReserved.status, JSON.stringify(otherReserved.body)).toBe(200);
  const sharedCommandID = randomUUID();
  const firstUseOfSharedID = activateHubPrincipal(
    "sgp",
    { command_id: sharedCommandID, hub_user_did: reservation.hub_user_did },
    apiCoverage,
  );
  expect(
    firstUseOfSharedID.status,
    JSON.stringify(firstUseOfSharedID.body),
  ).toBe(409);
  expect(firstUseOfSharedID.body).toMatchObject({
    type: "vetchium-problem-details/directory-state-conflict",
    status: 409,
  });
  const reusedIDDifferentPrincipal = activateHubPrincipal(
    "sgp",
    {
      command_id: sharedCommandID,
      hub_user_did: otherReservation.hub_user_did,
    },
    apiCoverage,
  );
  expect(
    reusedIDDifferentPrincipal.status,
    JSON.stringify(reusedIDDifferentPrincipal.body),
  ).toBe(409);
  expect(reusedIDDifferentPrincipal.body).toMatchObject({
    type: "vetchium-problem-details/idempotency-key-conflict",
    status: 409,
  });
});

test("set-hub-alias claims an alias for an active principal and rejects a changed-digest replay over the mesh relay", async ({
  apiCoverage,
}) => {
  const { hubUserDID } = activeMeshPrincipal("sgp", "sgp", apiCoverage);
  const alias = randomAlias();
  try {
    const claimCommandID = randomUUID();
    const claimed = setHubAlias(
      "sgp",
      {
        command_id: claimCommandID,
        hub_user_did: hubUserDID,
        profile_alias: alias,
      },
      apiCoverage,
    );
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
    expect((claimed.body as PrincipalCommandResponse).profile_alias).toBe(
      alias,
    );

    const resolved = resolveProfileSlug("sgp", alias, apiCoverage);
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expect((resolved.body as ResolveProfileSlugResponse).kind).toBe("alias");

    // Reusing the command_id with a different alias changes the stored
    // request digest.
    const replayed = setHubAlias(
      "sgp",
      {
        command_id: claimCommandID,
        hub_user_did: hubUserDID,
        profile_alias: randomAlias(),
      },
      apiCoverage,
    );
    expect(replayed.status, JSON.stringify(replayed.body)).toBe(409);
    expect(replayed.body).toMatchObject({
      type: "vetchium-problem-details/idempotency-key-conflict",
      status: 409,
    });
  } finally {
    cleanupHubAliasClaim(hubUserDID);
  }
});

test("set-hub-alias rejects a caller outside the principal's home tenant over the mesh relay", async ({
  apiCoverage,
}) => {
  const { hubUserDID } = activeMeshPrincipal("sgp", "sgp", apiCoverage);
  // usa1, not ind1: the mismatch must be a business decision by a healthy
  // coordinator connection, not ind1's own permanently broken one.
  const mismatch = setHubAlias(
    "usa1",
    {
      command_id: randomUUID(),
      hub_user_did: hubUserDID,
      profile_alias: randomAlias(),
    },
    apiCoverage,
  );
  expect(mismatch.status, JSON.stringify(mismatch.body)).toBe(403);
  expect(mismatch.body).toMatchObject({
    type: "vetchium-problem-details/directory-caller-tenant-mismatch",
    status: 403,
  });
});

test("set-hub-alias rejects an alias already claimed by another active principal over the mesh relay", async ({
  apiCoverage,
}) => {
  const first = activeMeshPrincipal("sgp", "sgp", apiCoverage);
  const second = activeMeshPrincipal("sgp", "sgp", apiCoverage);
  const alias = randomAlias();
  try {
    const claimed = setHubAlias(
      "sgp",
      {
        command_id: randomUUID(),
        hub_user_did: first.hubUserDID,
        profile_alias: alias,
      },
      apiCoverage,
    );
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);

    const conflict = setHubAlias(
      "sgp",
      {
        command_id: randomUUID(),
        hub_user_did: second.hubUserDID,
        profile_alias: alias,
      },
      apiCoverage,
    );
    expect(conflict.status, JSON.stringify(conflict.body)).toBe(409);
    expect(conflict.body).toMatchObject({
      type: "vetchium-problem-details/directory-claim-conflict",
      status: 409,
    });
  } finally {
    cleanupHubAliasClaim(first.hubUserDID);
  }
});

test("set-hub-alias rejects a principal that has not been activated over the mesh relay", async ({
  apiCoverage,
}) => {
  const reservation = freshReservation("sgp");
  const reserved = reserveHubPrincipal("sgp", reservation, apiCoverage);
  expect(reserved.status, JSON.stringify(reserved.body)).toBe(200);

  const response = setHubAlias(
    "sgp",
    {
      command_id: randomUUID(),
      hub_user_did: reservation.hub_user_did,
      profile_alias: randomAlias(),
    },
    apiCoverage,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(409);
  expect(response.body).toMatchObject({
    type: "vetchium-problem-details/directory-state-conflict",
    status: 409,
  });
});

test("mesh relay lists signup regions for a healthy tenant", async ({
  apiCoverage,
}) => {
  const body: ListSignupRegionsRequest = { resident_country: "IN" };
  const response = meshRelayRequest(
    "sgp",
    "/mesh/list-signup-regions",
    body,
    apiCoverage,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const parsed = response.body as ListSignupRegionsResponse;
  expect(parsed.regions.map((region) => region.tenant_id)).toEqual([
    "ind1",
    "sgp",
    "usa1",
  ]);
  expect(parsed.next_pagination_key).toBeNull();
});

test("mesh relay rejects an invalid request for list-signup-regions", async ({
  apiCoverage,
}) => {
  const invalid = meshRelayRequest(
    "sgp",
    "/mesh/list-signup-regions",
    { resident_country: "ZZ" },
    apiCoverage,
  );
  expect(invalid.status, JSON.stringify(invalid.body)).toBe(400);
  expect(invalid.body).toMatchObject({
    type: "vetchium-problem-details/validation-failed",
    status: 400,
  });

  const malformed = meshRelayRequest(
    "sgp",
    "/mesh/list-signup-regions",
    { resident_country: "IN", extra: true },
    apiCoverage,
  );
  expect(malformed.status, JSON.stringify(malformed.body)).toBe(400);
  expect(malformed.body).toMatchObject({
    type: "vetchium-problem-details/invalid-json",
    status: 400,
  });

  // "invalid" is a well-formed pagination_key string but not a real cursor,
  // so it passes wire validation and fails only once the directory tries to
  // decode it.
  const badCursor = meshRelayRequest(
    "sgp",
    "/mesh/list-signup-regions",
    { resident_country: "IN", pagination_key: "invalid" },
    apiCoverage,
  );
  expect(badCursor.status, JSON.stringify(badCursor.body)).toBe(400);
  expect(badCursor.body).toMatchObject({
    type: "vetchium-problem-details/invalid-pagination-key",
    status: 400,
  });
});

test("mesh relay rejects a missing or incorrect credential for list-signup-regions", async ({
  apiCoverage,
}) => {
  const missing = meshRelayRequest(
    "sgp",
    "/mesh/list-signup-regions",
    { resident_country: "IN" },
    apiCoverage,
    { authorization: null },
  );
  expect(missing.status, JSON.stringify(missing.body)).toBe(401);
  expect(missing.body).toMatchObject({
    type: "vetchium-problem-details/mesh-relay-authentication-required",
    status: 401,
  });

  const wrong = meshRelayRequest(
    "sgp",
    "/mesh/list-signup-regions",
    { resident_country: "IN" },
    apiCoverage,
    { authorization: "wrong-credential" },
  );
  expect(wrong.status, JSON.stringify(wrong.body)).toBe(401);
  expect(wrong.body).toMatchObject({
    type: "vetchium-problem-details/mesh-relay-authentication-required",
    status: 401,
  });
});

// ind1 deliberately cannot reach the global coordinator in the CI config
// (config/ci/ind1.json), so its bundled catalog answers list-signup-regions
// requests. A cursor bound to a different catalog cannot be continued from
// that fallback, and the outage is reported rather than blamed on the caller.
test("mesh relay reports region discovery unavailable for a foreign cursor on the offline tenant", async ({
  apiCoverage,
}) => {
  const response = meshRelayRequest(
    "ind1",
    "/mesh/list-signup-regions",
    {
      resident_country: "IN",
      pagination_key:
        "eyJjb3VudHJ5IjoiSU4iLCJ2ZXJzaW9uIjoiZGVhZGJlZWYiLCJsYXN0Ijoic2dwIn0",
    },
    apiCoverage,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(503);
  expect(response.body).toMatchObject({
    type: "vetchium-problem-details/region-discovery-unavailable",
    status: 503,
  });
});

test("mesh profile relay reads a Hub user's own local profile by handle", async ({
  request,
  apiCoverage,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const email = `e2e+${randomUUID()}@${domain}`;
  const keys: string[] = [];
  try {
    seedHubSignupDomain(domain, "sgp");
    const user = await signup(request, "sgp", email, keys);
    const body: RelayReadProfileRequest = {
      viewer_hub_user_did: user.hubUserDID,
      viewer_handle: user.handle,
      address: user.handle,
    };
    const response = meshRelayRequest(
      "sgp",
      "/mesh/profile/read",
      body,
      apiCoverage,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((response.body as PublicProfile).handle).toBe(user.handle);
  } finally {
    cleanupHubUser(email, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(domain, "sgp");
  }
});

test("mesh profile relay rejects malformed JSON and an invalid field", async ({
  apiCoverage,
}) => {
  const malformed = meshRelayRequest(
    "sgp",
    "/mesh/profile/read",
    undefined,
    apiCoverage,
    { rawBody: "{not json" },
  );
  expect(malformed.status, JSON.stringify(malformed.body)).toBe(400);
  expect(malformed.body).toMatchObject({
    type: "vetchium-problem-details/invalid-json",
    status: 400,
  });

  const invalid: RelayReadProfileRequest = {
    viewer_hub_user_did: randomHubUserDID(),
    viewer_handle: randomHubHandle(),
    address: "ab",
  };
  const response = meshRelayRequest(
    "sgp",
    "/mesh/profile/read",
    invalid,
    apiCoverage,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(400);
  expect(response.body).toMatchObject({
    type: "vetchium-problem-details/validation-failed",
    status: 400,
  });
});

test("mesh profile relay rejects a missing or incorrect credential", async ({
  apiCoverage,
}) => {
  const body: RelayReadProfileRequest = {
    viewer_hub_user_did: randomHubUserDID(),
    viewer_handle: randomHubHandle(),
    address: randomHubHandle(),
  };
  const missing = meshRelayRequest(
    "sgp",
    "/mesh/profile/read",
    body,
    apiCoverage,
    { authorization: null },
  );
  expect(missing.status, JSON.stringify(missing.body)).toBe(401);
  expect(missing.body).toMatchObject({
    type: "vetchium-problem-details/mesh-relay-authentication-required",
    status: 401,
  });
});

test("mesh profile relay reports not-found for a viewer without a matching local profile", async ({
  apiCoverage,
}) => {
  const body: RelayReadProfileRequest = {
    viewer_hub_user_did: randomHubUserDID(),
    viewer_handle: randomHubHandle(),
    address: randomHubHandle(),
  };
  const response = meshRelayRequest(
    "sgp",
    "/mesh/profile/read",
    body,
    apiCoverage,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(404);
  expect(response.body).toMatchObject({
    type: "vetchium-problem-details/hub-profile-not-found",
    status: 404,
  });
});

// The target is homed at ind1, whose coordinator link is deliberately broken
// in CI (config/ci/ind1.json). sgp resolves the alias against the (healthy)
// global directory, then its own mesh-api forwards the read to ind1's peer
// listener over the real, working tenant WireGuard mesh; ind1's peer handler
// fails when it in turn tries to resolve the viewer against its own broken
// directory client, surfacing as an unavailable profile back at sgp.
test("mesh profile relay reports the profile unavailable when the resolved home tenant cannot reach the directory", async ({
  request,
  apiCoverage,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const email = `e2e+${randomUUID()}@${domain}`;
  const keys: string[] = [];
  const targetDID = randomHubUserDID();
  const alias = randomAlias();
  try {
    seedHubSignupDomain(domain, "sgp");
    const viewer = await signup(request, "sgp", email, keys);
    seedGlobalHubPrincipal(targetDID, "ind1", alias);
    const body: RelayReadProfileRequest = {
      viewer_hub_user_did: viewer.hubUserDID,
      viewer_handle: viewer.handle,
      address: alias,
    };
    const response = meshRelayRequest(
      "sgp",
      "/mesh/profile/read",
      body,
      apiCoverage,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(503);
    expect(response.body).toMatchObject({
      type: "vetchium-problem-details/hub-profile-unavailable",
      status: 503,
    });
  } finally {
    cleanupGlobalHubPrincipal(targetDID, alias);
    cleanupHubUser(email, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(domain, "sgp");
  }
});

test("mesh peer profile read returns the target tenant's public profile and reports a missing target", async ({
  request,
  apiCoverage,
}) => {
  const viewerDomain = `e2e-${randomUUID()}.example.test`;
  const targetDomain = `e2e-${randomUUID()}.example.test`;
  const viewerEmail = `e2e+${randomUUID()}@${viewerDomain}`;
  const targetEmail = `e2e+${randomUUID()}@${targetDomain}`;
  const viewerKeys: string[] = [];
  const targetKeys: string[] = [];
  try {
    seedHubSignupDomain(viewerDomain, "sgp");
    seedHubSignupDomain(targetDomain, "usa1");
    const viewer = await signup(request, "sgp", viewerEmail, viewerKeys);
    const target = await signup(request, "usa1", targetEmail, targetKeys);

    const found: PeerReadProfileRequest = {
      viewer_hub_user_did: viewer.hubUserDID,
      viewer_handle: viewer.handle,
      target_hub_user_did: target.hubUserDID,
    };
    const response = meshPeerRequest("sgp", "usa1", found, apiCoverage);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((response.body as PublicProfile).handle).toBe(target.handle);

    const missing: PeerReadProfileRequest = {
      viewer_hub_user_did: viewer.hubUserDID,
      viewer_handle: viewer.handle,
      target_hub_user_did: randomHubUserDID(),
    };
    const notFound = meshPeerRequest("sgp", "usa1", missing, apiCoverage);
    expect(notFound.status, JSON.stringify(notFound.body)).toBe(404);
    expect(notFound.body).toMatchObject({
      type: "vetchium-problem-details/hub-profile-not-found",
      status: 404,
    });
  } finally {
    cleanupHubUser(viewerEmail, "sgp");
    cleanupHubIdempotency(viewerKeys, "sgp");
    cleanupHubSignupDomain(viewerDomain, "sgp");
    cleanupHubUser(targetEmail, "usa1");
    cleanupHubIdempotency(targetKeys, "usa1");
    cleanupHubSignupDomain(targetDomain, "usa1");
  }
});

test("mesh peer profile read rejects malformed JSON and an invalid field", async ({
  apiCoverage,
}) => {
  const malformed = meshPeerRequest("sgp", "usa1", undefined, apiCoverage, {
    rawBody: "{not json",
  });
  expect(malformed.status, JSON.stringify(malformed.body)).toBe(400);
  expect(malformed.body).toMatchObject({
    type: "vetchium-problem-details/invalid-json",
    status: 400,
  });

  const invalid: PeerReadProfileRequest = {
    viewer_hub_user_did: randomHubUserDID(),
    viewer_handle: randomHubHandle(),
    target_hub_user_did: "not-a-hub-user-did",
  };
  const response = meshPeerRequest("sgp", "usa1", invalid, apiCoverage);
  expect(response.status, JSON.stringify(response.body)).toBe(400);
  expect(response.body).toMatchObject({
    type: "vetchium-problem-details/validation-failed",
    status: 400,
  });
});

// ind1 is the peer being called here, so it is ind1's own mesh-api that tries
// to resolve the viewer against its permanently unreachable coordinator
// (config/ci/ind1.json). No local state is needed on either side: resolution
// fails before the target is ever looked up.
test("mesh peer profile read reports the profile unavailable when the receiving tenant cannot reach its directory", async ({
  apiCoverage,
}) => {
  const body: PeerReadProfileRequest = {
    viewer_hub_user_did: randomHubUserDID(),
    viewer_handle: randomHubHandle(),
    target_hub_user_did: randomHubUserDID(),
  };
  const response = meshPeerRequest("sgp", "ind1", body, apiCoverage);
  expect(response.status, JSON.stringify(response.body)).toBe(503);
  expect(response.body).toMatchObject({
    type: "vetchium-problem-details/hub-profile-unavailable",
    status: 503,
  });
});
