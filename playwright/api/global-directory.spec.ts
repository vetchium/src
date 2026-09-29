import { randomBytes, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type {
  AbandonHubAccountEmailChangeRequest,
  ActivateHubPrincipalRequest,
  FinalizeHubAccountEmailChangeRequest,
  HubAccountEmailChangeReservationResponse,
  PrincipalCommandResponse,
  ReserveHubAccountEmailChangeRequest,
  ReserveHubPrincipalRequest,
  ResolveHubAccountEmailRequest,
  ResolveHubAccountEmailResponse,
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
  { name: "resolve-hub-account-email", path: "/resolve-hub-account-email" },
  {
    name: "reserve-hub-account-email-change",
    path: "/reserve-hub-account-email-change",
  },
  {
    name: "finalize-hub-account-email-change",
    path: "/finalize-hub-account-email-change",
  },
  {
    name: "abandon-hub-account-email-change",
    path: "/abandon-hub-account-email-change",
  },
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

function freshEmailChange(
  hubUserDID: string,
  overrides: Partial<ReserveHubAccountEmailChangeRequest> = {},
): ReserveHubAccountEmailChangeRequest {
  return {
    command_id: randomUUID(),
    change_id: randomUUID(),
    hub_user_did: hubUserDID,
    new_email_digest: randomEmailDigest(),
    not_after: new Date(Date.now() + 60 * 60_000).toISOString(),
    digest_key_id: DIGEST_KEY_ID,
    ...overrides,
  };
}

async function resolveHubAccountEmail(
  context: APIRequestContext,
  request: ResolveHubAccountEmailRequest,
) {
  return context.post(`${coordinator}${DIRECTORY}/resolve-hub-account-email`, {
    data: request,
  });
}

async function reserveEmailChange(
  context: APIRequestContext,
  request: ReserveHubAccountEmailChangeRequest,
) {
  return context.post(
    `${coordinator}${DIRECTORY}/reserve-hub-account-email-change`,
    { data: request },
  );
}

async function finalizeEmailChange(
  context: APIRequestContext,
  request: FinalizeHubAccountEmailChangeRequest,
) {
  return context.post(
    `${coordinator}${DIRECTORY}/finalize-hub-account-email-change`,
    { data: request },
  );
}

async function abandonEmailChange(
  context: APIRequestContext,
  request: AbandonHubAccountEmailChangeRequest,
) {
  return context.post(
    `${coordinator}${DIRECTORY}/abandon-hub-account-email-change`,
    { data: request },
  );
}

async function expectReservationState(
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
  state: HubAccountEmailChangeReservationResponse["state"],
) {
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({
    state,
  } satisfies HubAccountEmailChangeReservationResponse);
}

async function expectDirectoryProblem(
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
  status: number,
  type: string,
) {
  expect(response.status(), await response.text()).toBe(status);
  expect(response.headers()["content-type"]).toContain(
    "application/problem+json",
  );
  expect(await response.json()).toMatchObject({
    type: `vetchium-problem-details/${type}`,
    status,
  });
}

/** Reserve and activate a fresh principal that holds a known account email
 * digest. */
async function activeEmailPrincipal(
  context: APIRequestContext,
  homeTenantID: string,
): Promise<{ hubUserDID: string; emailDigest: string }> {
  const reservation = freshReservation(homeTenantID);
  const reserved = await reserveHubPrincipal(context, reservation);
  expect(reserved.status(), await reserved.text()).toBe(200);
  const activated = await activateHubPrincipal(context, {
    command_id: randomUUID(),
    hub_user_did: reservation.hub_user_did,
  });
  expect(activated.status(), await activated.text()).toBe(200);
  return {
    hubUserDID: reservation.hub_user_did,
    emailDigest: reservation.account_email_digest,
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
    case "/resolve-hub-account-email":
      return {
        email_digest: randomEmailDigest(),
        digest_key_id: DIGEST_KEY_ID,
      };
    case "/reserve-hub-account-email-change":
      return { ...freshEmailChange(randomHubUserDID()) };
    case "/finalize-hub-account-email-change":
      return {
        command_id: randomUUID(),
        change_id: randomUUID(),
        hub_user_did: randomHubUserDID(),
      };
    case "/abandon-hub-account-email-change":
      return {
        command_id: randomUUID(),
        change_id: randomUUID(),
        hub_user_did: randomHubUserDID(),
        not_after: new Date(Date.now() + 60_000).toISOString(),
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
    case "/resolve-hub-account-email":
    case "/reserve-hub-account-email-change":
      return {
        ...base,
        ...(path === "/resolve-hub-account-email"
          ? { email_digest: "not-a-digest" }
          : { new_email_digest: "not-a-digest" }),
      };
    case "/finalize-hub-account-email-change":
    case "/abandon-hub-account-email-change":
      return { ...base, change_id: "not-a-change-id" };
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

test("reserve-hub-principal rejects a held account email and a foreign digest key", async ({
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

    // The email is checked before the handle, so a held address never
    // burns a handle attempt (GU-DIR-002).
    const competing = freshReservation("sgp", {
      account_email_digest: first.account_email_digest,
    });
    await expectDirectoryProblem(
      await reserveHubPrincipal(context, competing),
      409,
      "directory-email-claim-conflict",
    );
    await expectDirectoryProblem(
      await reserveHubPrincipal(
        context,
        freshReservation("sgp", { digest_key_id: "0000000000000000" }),
      ),
      409,
      "directory-digest-key-mismatch",
    );
    // Neither rejection claimed the competing handle.
    const corrected = await reserveHubPrincipal(context, {
      ...competing,
      command_id: randomUUID(),
      account_email_digest: randomEmailDigest(),
    });
    expect(corrected.status(), await corrected.text()).toBe(200);
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

test("resolve-hub-account-email names only the home tenant of a held address", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  try {
    // A provisioning claim already holds the address (GU-DIR-001).
    const reservation = freshReservation("sgp");
    const reserved = await reserveHubPrincipal(context, reservation);
    expect(reserved.status(), await reserved.text()).toBe(200);
    const request: ResolveHubAccountEmailRequest = {
      email_digest: reservation.account_email_digest,
      digest_key_id: DIGEST_KEY_ID,
    };
    const resolved = await resolveHubAccountEmail(context, request);
    expect(resolved.status(), await resolved.text()).toBe(200);
    expect(resolved.headers()["cache-control"]).toBe("no-store");
    expect(await resolved.json()).toEqual({
      home_tenant_id: "sgp",
    } satisfies ResolveHubAccountEmailResponse);

    await expectDirectoryProblem(
      await resolveHubAccountEmail(context, {
        email_digest: randomEmailDigest(),
        digest_key_id: DIGEST_KEY_ID,
      }),
      404,
      "directory-entry-not-found",
    );
    await expectDirectoryProblem(
      await resolveHubAccountEmail(context, {
        ...request,
        digest_key_id: "0000000000000000",
      }),
      409,
      "directory-digest-key-mismatch",
    );
  } finally {
    await context.dispose();
  }
});

test("an email change reserves the new address, finalizes it, and replays each command", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  try {
    const { hubUserDID, emailDigest } = await activeEmailPrincipal(
      context,
      "sgp",
    );
    const change = freshEmailChange(hubUserDID);
    await expectReservationState(
      await reserveEmailChange(context, change),
      "reserved",
    );
    await expectReservationState(
      await reserveEmailChange(context, change),
      "reserved",
    );
    await expectDirectoryProblem(
      await reserveEmailChange(context, {
        ...change,
        new_email_digest: randomEmailDigest(),
      }),
      409,
      "idempotency-key-conflict",
    );
    // A pending address is held but does not resolve until finalized.
    await expectDirectoryProblem(
      await resolveHubAccountEmail(context, {
        email_digest: change.new_email_digest,
        digest_key_id: DIGEST_KEY_ID,
      }),
      404,
      "directory-entry-not-found",
    );

    const finalize: FinalizeHubAccountEmailChangeRequest = {
      command_id: randomUUID(),
      change_id: change.change_id,
      hub_user_did: hubUserDID,
    };
    await expectReservationState(
      await finalizeEmailChange(context, finalize),
      "finalized",
    );
    await expectReservationState(
      await finalizeEmailChange(context, {
        ...finalize,
        command_id: randomUUID(),
      }),
      "finalized",
    );
    await expectDirectoryProblem(
      await finalizeEmailChange(context, {
        ...finalize,
        change_id: randomUUID(),
      }),
      409,
      "idempotency-key-conflict",
    );

    const moved = await resolveHubAccountEmail(context, {
      email_digest: change.new_email_digest,
      digest_key_id: DIGEST_KEY_ID,
    });
    expect(moved.status(), await moved.text()).toBe(200);
    await expectDirectoryProblem(
      await resolveHubAccountEmail(context, {
        email_digest: emailDigest,
        digest_key_id: DIGEST_KEY_ID,
      }),
      404,
      "directory-entry-not-found",
    );

    // The tenant never abandons after applying locally.
    await expectDirectoryProblem(
      await abandonEmailChange(context, {
        command_id: randomUUID(),
        change_id: change.change_id,
        hub_user_did: hubUserDID,
        not_after: change.not_after,
      }),
      409,
      "directory-state-conflict",
    );
  } finally {
    await context.dispose();
  }
});

test("reserve-hub-account-email-change rejects a held address, a stale or fenced change, and a foreign caller", async ({
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
    const owner = await activeEmailPrincipal(sgp, "sgp");
    const other = await activeEmailPrincipal(sgp, "sgp");

    await expectDirectoryProblem(
      await reserveEmailChange(
        sgp,
        freshEmailChange(other.hubUserDID, {
          new_email_digest: owner.emailDigest,
        }),
      ),
      409,
      "directory-email-claim-conflict",
    );
    await expectDirectoryProblem(
      await reserveEmailChange(
        sgp,
        freshEmailChange(other.hubUserDID, {
          digest_key_id: "0000000000000000",
        }),
      ),
      409,
      "directory-digest-key-mismatch",
    );
    await expectDirectoryProblem(
      await reserveEmailChange(
        sgp,
        freshEmailChange(other.hubUserDID, {
          not_after: new Date(Date.now() - 60_000).toISOString(),
        }),
      ),
      409,
      "directory-reservation-expired",
    );

    // An abandon that overtakes its reserve leaves a tombstone that fences
    // the late reserve (GU-DIR-006).
    const fenced = freshEmailChange(other.hubUserDID);
    await expectReservationState(
      await abandonEmailChange(sgp, {
        command_id: randomUUID(),
        change_id: fenced.change_id,
        hub_user_did: other.hubUserDID,
        not_after: fenced.not_after,
      }),
      "cancelled",
    );
    await expectDirectoryProblem(
      await reserveEmailChange(sgp, fenced),
      409,
      "directory-reservation-cancelled",
    );

    await expectDirectoryProblem(
      await reserveEmailChange(ind1, freshEmailChange(other.hubUserDID)),
      403,
      "directory-caller-tenant-mismatch",
    );
    await expectDirectoryProblem(
      await reserveEmailChange(sgp, freshEmailChange(randomHubUserDID())),
      409,
      "directory-state-conflict",
    );

    // None of the rejections moved the owner's address.
    const held = await resolveHubAccountEmail(sgp, {
      email_digest: owner.emailDigest,
      digest_key_id: DIGEST_KEY_ID,
    });
    expect(held.status(), await held.text()).toBe(200);
  } finally {
    await sgp.dispose();
    await ind1.dispose();
  }
});

test("finalize and abandon act only on the caller's own reservation", async ({
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
    const victim = await activeEmailPrincipal(sgp, "sgp");
    const attacker = await activeEmailPrincipal(sgp, "sgp");
    const change = freshEmailChange(victim.hubUserDID);
    await expectReservationState(
      await reserveEmailChange(sgp, change),
      "reserved",
    );

    // Naming another user's change id proves nothing about owning it.
    await expectDirectoryProblem(
      await abandonEmailChange(sgp, {
        command_id: randomUUID(),
        change_id: change.change_id,
        hub_user_did: attacker.hubUserDID,
        not_after: change.not_after,
      }),
      409,
      "directory-state-conflict",
    );
    await expectDirectoryProblem(
      await finalizeEmailChange(sgp, {
        command_id: randomUUID(),
        change_id: change.change_id,
        hub_user_did: attacker.hubUserDID,
      }),
      409,
      "directory-state-conflict",
    );
    for (const response of [
      await finalizeEmailChange(ind1, {
        command_id: randomUUID(),
        change_id: change.change_id,
        hub_user_did: victim.hubUserDID,
      }),
      await abandonEmailChange(ind1, {
        command_id: randomUUID(),
        change_id: change.change_id,
        hub_user_did: victim.hubUserDID,
        not_after: change.not_after,
      }),
    ]) {
      await expectDirectoryProblem(
        response,
        403,
        "directory-caller-tenant-mismatch",
      );
    }
    await expectDirectoryProblem(
      await finalizeEmailChange(sgp, {
        command_id: randomUUID(),
        change_id: randomUUID(),
        hub_user_did: victim.hubUserDID,
      }),
      409,
      "directory-state-conflict",
    );

    // The owner can still cancel it, which frees the address, and a later
    // finalize of the cancelled change is refused.
    const abandon: AbandonHubAccountEmailChangeRequest = {
      command_id: randomUUID(),
      change_id: change.change_id,
      hub_user_did: victim.hubUserDID,
      not_after: change.not_after,
    };
    await expectReservationState(
      await abandonEmailChange(sgp, abandon),
      "cancelled",
    );
    await expectReservationState(
      await abandonEmailChange(sgp, { ...abandon, command_id: randomUUID() }),
      "cancelled",
    );
    await expectDirectoryProblem(
      await abandonEmailChange(sgp, { ...abandon, change_id: randomUUID() }),
      409,
      "idempotency-key-conflict",
    );
    await expectDirectoryProblem(
      await finalizeEmailChange(sgp, {
        command_id: randomUUID(),
        change_id: change.change_id,
        hub_user_did: victim.hubUserDID,
      }),
      409,
      "directory-state-conflict",
    );
    await expectReservationState(
      await reserveEmailChange(
        sgp,
        freshEmailChange(attacker.hubUserDID, {
          new_email_digest: change.new_email_digest,
        }),
      ),
      "reserved",
    );
  } finally {
    await sgp.dispose();
    await ind1.dispose();
  }
});
