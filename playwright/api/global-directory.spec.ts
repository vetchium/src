import { randomBytes, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type {
  ActivateHubPrincipalRequest,
  PrincipalCommandResponse,
  ReserveHubPrincipalRequest,
  ResolveProfileSlugRequest,
  ResolveProfileSlugResponse,
  SetHubAliasRequest,
} from "typespec/directory/directory";
import { cleanupHubAliasClaim } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { coordinator, coordinatorContext } from "../lib/coordinator.ts";

const DIRECTORY = "/api/global-coordinator/directory";

const ROUTES = [
  { name: "resolve-profile-slug", path: "/resolve-profile-slug" },
  { name: "reserve-hub-principal", path: "/reserve-hub-principal" },
  { name: "activate-hub-principal", path: "/activate-hub-principal" },
  { name: "set-hub-alias", path: "/set-hub-alias" },
] as const;

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
  const prefix = randomUUID().replaceAll("-", "").slice(0, 5);
  return `${prefix}-${randomSuffix(11)}`;
}

function randomAlias(): string {
  return `e2e-${randomSuffix(20)}`;
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
    ...overrides,
  };
}

async function resolveProfileSlug(context: APIRequestContext, slug: string) {
  const body: ResolveProfileSlugRequest = { slug };
  return context.post(`${coordinator}${DIRECTORY}/resolve-profile-slug`, {
    data: body,
  });
}

async function reserveHubPrincipal(
  context: APIRequestContext,
  request: ReserveHubPrincipalRequest,
) {
  return context.post(`${coordinator}${DIRECTORY}/reserve-hub-principal`, {
    data: request,
  });
}

async function activateHubPrincipal(
  context: APIRequestContext,
  request: ActivateHubPrincipalRequest,
) {
  return context.post(`${coordinator}${DIRECTORY}/activate-hub-principal`, {
    data: request,
  });
}

async function setHubAlias(
  context: APIRequestContext,
  request: SetHubAliasRequest,
) {
  return context.post(`${coordinator}${DIRECTORY}/set-hub-alias`, {
    data: request,
  });
}

/** Reserve and activate a fresh principal, returning its DID and handle. */
async function activePrincipal(
  context: APIRequestContext,
  homeTenantID: string,
): Promise<{ hubUserDID: string; handle: string }> {
  const reservation = freshReservation(homeTenantID);
  const reserved = await reserveHubPrincipal(context, reservation);
  expect(reserved.status(), await reserved.text()).toBe(200);
  const activated = await activateHubPrincipal(context, {
    command_id: randomUUID(),
    hub_user_did: reservation.hub_user_did,
  });
  expect(activated.status(), await activated.text()).toBe(200);
  return { hubUserDID: reservation.hub_user_did, handle: reservation.handle };
}

// A structurally valid body for each route, used as the base for the 400
// cases below. Values need not correspond to real directory state: every
// case here is rejected before the service is called.
function baseBody(
  path: (typeof ROUTES)[number]["path"],
): Record<string, unknown> {
  switch (path) {
    case "/resolve-profile-slug":
      return { slug: randomHubHandle() };
    case "/reserve-hub-principal":
      return { ...freshReservation("sgp") };
    case "/activate-hub-principal":
      return { command_id: randomUUID(), hub_user_did: randomHubUserDID() };
    case "/set-hub-alias":
      return {
        command_id: randomUUID(),
        hub_user_did: randomHubUserDID(),
        profile_alias: randomAlias(),
      };
  }
}

function invalidFieldBody(
  path: (typeof ROUTES)[number]["path"],
): Record<string, unknown> {
  const base = baseBody(path);
  switch (path) {
    case "/resolve-profile-slug":
      return { ...base, slug: "ab" };
    case "/reserve-hub-principal":
    case "/activate-hub-principal":
      return { ...base, command_id: "not-a-command-id" };
    case "/set-hub-alias":
      return { ...base, profile_alias: "ab" };
  }
}

for (const route of ROUTES) {
  test(`${route.name} rejects a non-tenant certificate`, async ({
    apiCoverage,
    playwright,
  }) => {
    const context = await coordinatorContext(
      playwright.request,
      "health",
      apiCoverage,
    );
    try {
      const response = await context.post(
        `${coordinator}${DIRECTORY}${route.path}`,
        {
          data: {},
        },
      );
      expect(response.status()).toBe(401);
      expect(response.headers()["www-authenticate"]).toBe(
        'MutualTLS realm="global-coordinator"',
      );
      expect(response.headers()["content-type"]).toContain(
        "application/problem+json",
      );
      expect(await response.json()).toMatchObject({
        type: "vetchium-problem-details/directory-authentication-required",
        status: 401,
      });
    } finally {
      await context.dispose();
    }
  });
}

for (const route of ROUTES) {
  test(`${route.name} rejects missing and wrong-purpose client certificates`, async ({
    apiCoverage,
    playwright,
  }) => {
    const withoutCertificate = await playwright.request.newContext({
      ignoreHTTPSErrors: true,
    });
    const wrongPurpose = await coordinatorContext(
      playwright.request,
      "server",
      apiCoverage,
    );
    try {
      for (const context of [withoutCertificate, wrongPurpose]) {
        await expect(
          context.post(`${coordinator}${DIRECTORY}${route.path}`, { data: {} }),
        ).rejects.toThrow();
      }
    } finally {
      await withoutCertificate.dispose();
      await wrongPurpose.dispose();
    }
  });
}

for (const route of ROUTES) {
  test(`${route.name} rejects malformed JSON and an invalid field`, async ({
    apiCoverage,
    playwright,
  }) => {
    const context = await coordinatorContext(
      playwright.request,
      "sgp",
      apiCoverage,
    );
    try {
      const malformed = await context.post(
        `${coordinator}${DIRECTORY}${route.path}`,
        {
          data: { ...baseBody(route.path), unexpected_field: true },
        },
      );
      expect(malformed.status(), await malformed.text()).toBe(400);
      expect(malformed.headers()["content-type"]).toContain(
        "application/problem+json",
      );
      expect(await malformed.json()).toMatchObject({
        type: "vetchium-problem-details/invalid-json",
        status: 400,
      });

      const invalid = await context.post(
        `${coordinator}${DIRECTORY}${route.path}`,
        {
          data: invalidFieldBody(route.path),
        },
      );
      expect(invalid.status(), await invalid.text()).toBe(400);
      expect(await invalid.json()).toMatchObject({
        type: "vetchium-problem-details/validation-failed",
        status: 400,
      });
    } finally {
      await context.dispose();
    }
  });
}

test("resolve-profile-slug resolves an active principal's handle", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  try {
    const { hubUserDID, handle } = await activePrincipal(context, "sgp");
    const response = await resolveProfileSlug(context, handle);
    expect(response.status(), await response.text()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body = (await response.json()) as ResolveProfileSlugResponse;
    expect(body).toEqual({
      hub_user_did: hubUserDID,
      slug: handle,
      kind: "handle",
      home_tenant_id: "sgp",
      routing_version: 1,
    });
  } finally {
    await context.dispose();
  }
});

test("resolve-profile-slug reports not-found for an unknown or not-yet-active slug", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  try {
    const reservation = freshReservation("sgp");
    const reserved = await reserveHubPrincipal(context, reservation);
    expect(reserved.status(), await reserved.text()).toBe(200);

    // A provisioning handle is not yet public, and a slug never reserved
    // behaves identically: both are indistinguishable "not found" responses.
    for (const slug of [reservation.handle, randomHubHandle()]) {
      const response = await resolveProfileSlug(context, slug);
      expect(response.status(), await response.text()).toBe(404);
      expect(response.headers()["content-type"]).toContain(
        "application/problem+json",
      );
      expect(await response.json()).toMatchObject({
        type: "vetchium-problem-details/directory-entry-not-found",
        status: 404,
      });
    }
  } finally {
    await context.dispose();
  }
});

test("reserve-hub-principal deduplicates a repeated command and rejects a changed digest", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  try {
    const reservation = freshReservation("sgp");
    const first = await reserveHubPrincipal(context, reservation);
    expect(first.status(), await first.text()).toBe(200);
    const firstBody = (await first.json()) as PrincipalCommandResponse;
    expect(firstBody).toEqual({
      hub_user_did: reservation.hub_user_did,
      handle: reservation.handle,
      profile_alias: null,
      home_tenant_id: "sgp",
      routing_version: 1,
      state: "provisioning",
    });

    // PROF-XTN-002: the identical command replays its stored result instead
    // of re-running the mutation or reporting a conflict.
    const replay = await reserveHubPrincipal(context, reservation);
    expect(replay.status(), await replay.text()).toBe(200);
    expect(await replay.json()).toEqual(firstBody);

    const changedDigest = await reserveHubPrincipal(context, {
      ...reservation,
      handle: randomHubHandle(),
    });
    expect(changedDigest.status(), await changedDigest.text()).toBe(409);
    expect(await changedDigest.json()).toMatchObject({
      type: "vetchium-problem-details/idempotency-key-conflict",
      status: 409,
    });
  } finally {
    await context.dispose();
  }
});

test("reserve-hub-principal rejects a caller reserving another tenant's principal", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  try {
    const reservation = freshReservation("ind1");
    const mismatch = await reserveHubPrincipal(context, reservation);
    expect(mismatch.status(), await mismatch.text()).toBe(403);
    expect(await mismatch.json()).toMatchObject({
      type: "vetchium-problem-details/directory-caller-tenant-mismatch",
      status: 403,
    });

    // The rejected attempt must not have created a principal or claimed the
    // handle: the identical identity reserves cleanly once the tenant
    // matches the caller.
    const corrected = await reserveHubPrincipal(context, {
      ...reservation,
      command_id: randomUUID(),
      home_tenant_id: "sgp",
    });
    expect(corrected.status(), await corrected.text()).toBe(200);
  } finally {
    await context.dispose();
  }
});

test("reserve-hub-principal rejects a competing handle claim", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  try {
    const first = freshReservation("sgp");
    const reserved = await reserveHubPrincipal(context, first);
    expect(reserved.status(), await reserved.text()).toBe(200);

    const competing = await reserveHubPrincipal(context, {
      ...freshReservation("sgp"),
      handle: first.handle,
    });
    expect(competing.status(), await competing.text()).toBe(409);
    expect(await competing.json()).toMatchObject({
      type: "vetchium-problem-details/directory-claim-conflict",
      status: 409,
    });
  } finally {
    await context.dispose();
  }
});

test("reserve-hub-principal rejects a provisioning window that has already expired", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  try {
    const expired = freshReservation("sgp", {
      provisioning_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const response = await reserveHubPrincipal(context, expired);
    expect(response.status(), await response.text()).toBe(409);
    expect(await response.json()).toMatchObject({
      type: "vetchium-problem-details/directory-state-conflict",
      status: 409,
    });
  } finally {
    await context.dispose();
  }
});

test("activate-hub-principal activates a reserved principal and makes it resolvable", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  try {
    const reservation = freshReservation("sgp");
    const reserved = await reserveHubPrincipal(context, reservation);
    expect(reserved.status(), await reserved.text()).toBe(200);

    const activated = await activateHubPrincipal(context, {
      command_id: randomUUID(),
      hub_user_did: reservation.hub_user_did,
    });
    expect(activated.status(), await activated.text()).toBe(200);
    expect(await activated.json()).toEqual({
      hub_user_did: reservation.hub_user_did,
      handle: reservation.handle,
      profile_alias: null,
      home_tenant_id: "sgp",
      routing_version: 1,
      state: "active",
    });

    const resolved = await resolveProfileSlug(context, reservation.handle);
    expect(resolved.status(), await resolved.text()).toBe(200);
  } finally {
    await context.dispose();
  }
});

test("activate-hub-principal rejects a caller outside the principal's home tenant", async ({
  apiCoverage,
  playwright,
}) => {
  const sgp = await coordinatorContext(playwright.request, "sgp", apiCoverage);
  const ind1 = await coordinatorContext(
    playwright.request,
    "ind1",
    apiCoverage,
  );
  try {
    const reservation = freshReservation("sgp");
    const reserved = await reserveHubPrincipal(sgp, reservation);
    expect(reserved.status(), await reserved.text()).toBe(200);

    const mismatch = await activateHubPrincipal(ind1, {
      command_id: randomUUID(),
      hub_user_did: reservation.hub_user_did,
    });
    expect(mismatch.status(), await mismatch.text()).toBe(403);
    expect(await mismatch.json()).toMatchObject({
      type: "vetchium-problem-details/directory-caller-tenant-mismatch",
      status: 403,
    });

    // The rejected attempt must not have activated the principal.
    const corrected = await activateHubPrincipal(sgp, {
      command_id: randomUUID(),
      hub_user_did: reservation.hub_user_did,
    });
    expect(corrected.status(), await corrected.text()).toBe(200);
  } finally {
    await sgp.dispose();
    await ind1.dispose();
  }
});

test("activate-hub-principal rejects an unknown principal and a repeat activation", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  try {
    const unknown = await activateHubPrincipal(context, {
      command_id: randomUUID(),
      hub_user_did: randomHubUserDID(),
    });
    expect(unknown.status(), await unknown.text()).toBe(409);
    expect(await unknown.json()).toMatchObject({
      type: "vetchium-problem-details/directory-state-conflict",
      status: 409,
    });

    const reservation = freshReservation("sgp");
    const reserved = await reserveHubPrincipal(context, reservation);
    expect(reserved.status(), await reserved.text()).toBe(200);
    const activated = await activateHubPrincipal(context, {
      command_id: randomUUID(),
      hub_user_did: reservation.hub_user_did,
    });
    expect(activated.status(), await activated.text()).toBe(200);

    const repeat = await activateHubPrincipal(context, {
      command_id: randomUUID(),
      hub_user_did: reservation.hub_user_did,
    });
    expect(repeat.status(), await repeat.text()).toBe(409);
    expect(await repeat.json()).toMatchObject({
      type: "vetchium-problem-details/directory-state-conflict",
      status: 409,
    });

    // 409 idempotency-key-conflict: reusing a command_id against a different
    // principal changes the stored request digest.
    const otherReservation = freshReservation("sgp");
    const otherReserved = await reserveHubPrincipal(context, otherReservation);
    expect(otherReserved.status(), await otherReserved.text()).toBe(200);
    const sharedCommandID = randomUUID();
    const firstUseOfSharedID = await activateHubPrincipal(context, {
      command_id: sharedCommandID,
      hub_user_did: reservation.hub_user_did,
    });
    expect(firstUseOfSharedID.status(), await firstUseOfSharedID.text()).toBe(
      409,
    );
    expect(await firstUseOfSharedID.json()).toMatchObject({
      type: "vetchium-problem-details/directory-state-conflict",
      status: 409,
    });
    const reusedIDDifferentPrincipal = await activateHubPrincipal(context, {
      command_id: sharedCommandID,
      hub_user_did: otherReservation.hub_user_did,
    });
    expect(
      reusedIDDifferentPrincipal.status(),
      await reusedIDDifferentPrincipal.text(),
    ).toBe(409);
    expect(await reusedIDDifferentPrincipal.json()).toMatchObject({
      type: "vetchium-problem-details/idempotency-key-conflict",
      status: 409,
    });
  } finally {
    await context.dispose();
  }
});

test("set-hub-alias claims an alias for an active principal", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  const { hubUserDID } = await activePrincipal(context, "sgp");
  const alias = randomAlias();
  try {
    const claimCommandID = randomUUID();
    const claimed = await setHubAlias(context, {
      command_id: claimCommandID,
      hub_user_did: hubUserDID,
      profile_alias: alias,
    });
    expect(claimed.status(), await claimed.text()).toBe(200);
    expect((await claimed.json()).profile_alias).toBe(alias);

    const resolved = await resolveProfileSlug(context, alias);
    expect(resolved.status(), await resolved.text()).toBe(200);
    expect((await resolved.json()).kind).toBe("alias");

    // 409 idempotency-key-conflict: reusing the command_id with a different
    // alias changes the stored request digest.
    const replayed = await setHubAlias(context, {
      command_id: claimCommandID,
      hub_user_did: hubUserDID,
      profile_alias: randomAlias(),
    });
    expect(replayed.status(), await replayed.text()).toBe(409);
    expect(await replayed.json()).toMatchObject({
      type: "vetchium-problem-details/idempotency-key-conflict",
      status: 409,
    });
  } finally {
    cleanupHubAliasClaim(hubUserDID);
    await context.dispose();
  }
});

// A user-initiated release still observes the seven-day change cooldown
// (federation.md), so a same-run round trip must use the downgrade-cleanup
// path, which is the only way this command releases an alias immediately.
test("set-hub-alias releases an alias immediately as a downgrade cleanup", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  const { hubUserDID } = await activePrincipal(context, "sgp");
  const alias = randomAlias();
  try {
    const claimed = await setHubAlias(context, {
      command_id: randomUUID(),
      hub_user_did: hubUserDID,
      profile_alias: alias,
    });
    expect(claimed.status(), await claimed.text()).toBe(200);

    const released = await setHubAlias(context, {
      command_id: randomUUID(),
      hub_user_did: hubUserDID,
      profile_alias: null,
      downgrade_release_if_alias: alias,
    });
    expect(released.status(), await released.text()).toBe(200);
    expect((await released.json()).profile_alias).toBeNull();

    const goneAfterRelease = await resolveProfileSlug(context, alias);
    expect(goneAfterRelease.status()).toBe(404);
  } finally {
    cleanupHubAliasClaim(hubUserDID);
    await context.dispose();
  }
});

test("set-hub-alias rejects a caller outside the principal's home tenant", async ({
  apiCoverage,
  playwright,
}) => {
  const sgp = await coordinatorContext(playwright.request, "sgp", apiCoverage);
  const ind1 = await coordinatorContext(
    playwright.request,
    "ind1",
    apiCoverage,
  );
  try {
    const { hubUserDID } = await activePrincipal(sgp, "sgp");
    const mismatch = await setHubAlias(ind1, {
      command_id: randomUUID(),
      hub_user_did: hubUserDID,
      profile_alias: randomAlias(),
    });
    expect(mismatch.status(), await mismatch.text()).toBe(403);
    expect(await mismatch.json()).toMatchObject({
      type: "vetchium-problem-details/directory-caller-tenant-mismatch",
      status: 403,
    });
  } finally {
    await sgp.dispose();
    await ind1.dispose();
  }
});

test("set-hub-alias rejects a principal that has not been activated", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  try {
    const reservation = freshReservation("sgp");
    const reserved = await reserveHubPrincipal(context, reservation);
    expect(reserved.status(), await reserved.text()).toBe(200);

    const response = await setHubAlias(context, {
      command_id: randomUUID(),
      hub_user_did: reservation.hub_user_did,
      profile_alias: randomAlias(),
    });
    expect(response.status(), await response.text()).toBe(409);
    expect(await response.json()).toMatchObject({
      type: "vetchium-problem-details/directory-state-conflict",
      status: 409,
    });
  } finally {
    await context.dispose();
  }
});

test("set-hub-alias rejects an alias already claimed by another active principal", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  const first = await activePrincipal(context, "sgp");
  const second = await activePrincipal(context, "sgp");
  const alias = randomAlias();
  try {
    const claimed = await setHubAlias(context, {
      command_id: randomUUID(),
      hub_user_did: first.hubUserDID,
      profile_alias: alias,
    });
    expect(claimed.status(), await claimed.text()).toBe(200);

    const conflict = await setHubAlias(context, {
      command_id: randomUUID(),
      hub_user_did: second.hubUserDID,
      profile_alias: alias,
    });
    expect(conflict.status(), await conflict.text()).toBe(409);
    expect(await conflict.json()).toMatchObject({
      type: "vetchium-problem-details/directory-claim-conflict",
      status: 409,
    });
  } finally {
    cleanupHubAliasClaim(first.hubUserDID);
    await context.dispose();
  }
});
