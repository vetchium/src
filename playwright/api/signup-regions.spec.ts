import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type { ListSignupRegionsResponse } from "typespec/regions/regions";
import {
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  globalHubPrincipal,
  seedHubSignupDomain,
  seedPendingHubSignup,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { coordinator, coordinatorContext } from "../lib/coordinator.ts";
import { hubIdempotencyKey, MAILPIT_ORIGIN } from "../lib/hub-api.ts";
import { signup } from "../lib/hub-signup.ts";

async function requestSignupToken(
  request: APIRequestContext,
  tenant: string,
  email: string,
  keys: string[],
): Promise<string> {
  const origin = `http://hub-ui.${tenant}.localhost`;
  const key = hubIdempotencyKey();
  keys.push(key);
  const response = await request.post(`${origin}/api/hub/request-signup`, {
    headers: { "Idempotency-Key": key },
    data: {
      email_address: email,
      display_name: "Independent User",
      preferred_language: "en-US",
      resident_country: "FR",
    },
  });
  expect(response.status(), await response.text()).toBe(202);
  const mailbox = `${MAILPIT_ORIGIN}/view/latest.txt?query=${encodeURIComponent(`to:${email}`)}`;
  let text = "";
  await expect
    .poll(
      async () => {
        const mail = await request.get(mailbox);
        text = mail.ok() ? await mail.text() : "";
        return text;
      },
      { timeout: 15_000 },
    )
    .toContain(`${origin}/complete-signup`);
  const token = text.match(/complete-signup\?token=([0-9a-f]{64})/)?.[1];
  if (token === undefined)
    throw new Error("signup email did not contain a token");
  return token;
}

async function expectRegionDiscovery(
  request: APIRequestContext,
  origin: string,
  prefix: string,
): Promise<void> {
  const url = `${origin}${prefix}/list-signup-regions`;
  const response = await request.post(url, {
    data: { resident_country: "IN" },
  });
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const body = (await response.json()) as ListSignupRegionsResponse;
  expect(body.regions.map((region) => region.tenant_id)).toEqual([
    "ind1",
    "sgp",
    "usa1",
  ]);
  expect(
    body.regions
      .filter((region) => region.recommended)
      .map((region) => region.tenant_id),
  ).toEqual(["ind1"]);
  expect(body.next_pagination_key).toBeNull();
  for (const [data, problem] of [
    [{ resident_country: "ZZ" }, "validation-failed"],
    [
      { resident_country: "IN", pagination_key: "invalid" },
      "invalid-pagination-key",
    ],
    [{ resident_country: "IN", extra: true }, "invalid-json"],
  ]) {
    const invalid = await request.post(url, { data });
    expect(invalid.status()).toBe(400);
    expect(invalid.headers()["content-type"]).toContain(
      "application/problem+json",
    );
    expect(await invalid.json()).toMatchObject({
      type: `vetchium-problem-details/${problem}`,
      status: 400,
    });
  }
}

for (const [name, origin] of [
  ["hub", "http://hub-ui.sgp.localhost"],
  ["offline tenant via mesh", "http://hub-ui.ind1.localhost"],
] as const) {
  test(`${name} discovers regions and validates its request`, async ({
    request,
  }) => {
    await expectRegionDiscovery(request, origin, "/api/hub");
  });
}

test("global coordinator discovers regions over tenant mTLS", async ({
  apiCoverage,
  playwright,
}) => {
  const context = await coordinatorContext(
    playwright.request,
    "sgp",
    apiCoverage,
  );
  try {
    await expectRegionDiscovery(
      context,
      coordinator,
      "/api/global-coordinator",
    );
  } finally {
    await context.dispose();
  }
});
// ind1 deliberately cannot reach the coordinator in the CI config, so its
// bundled catalog answers instead. A cursor bound to a different catalog cannot
// be continued from that fallback, and the outage is reported as such rather
// than blamed on the caller. A malformed cursor stays the caller's error.
test("a directory cursor cannot be continued from the bundled catalog", async ({
  request,
}) => {
  const url = "http://hub-ui.ind1.localhost/api/hub/list-signup-regions";
  const foreign = await request.post(url, {
    data: {
      resident_country: "IN",
      pagination_key:
        "eyJjb3VudHJ5IjoiSU4iLCJ2ZXJzaW9uIjoiZGVhZGJlZWYiLCJsYXN0Ijoic2dwIn0",
    },
  });
  expect(foreign.status(), await foreign.text()).toBe(503);
  expect(foreign.headers()["content-type"]).toContain(
    "application/problem+json",
  );
  expect(await foreign.json()).toMatchObject({
    type: "vetchium-problem-details/region-discovery-unavailable",
    status: 503,
  });

  const malformed = await request.post(url, {
    data: { resident_country: "IN", pagination_key: "not-a-cursor" },
  });
  expect(malformed.status()).toBe(400);
  expect(await malformed.json()).toMatchObject({
    type: "vetchium-problem-details/invalid-pagination-key",
    status: 400,
  });
});

test("global region discovery rejects a non-tenant certificate", async ({
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
      `${coordinator}/api/global-coordinator/list-signup-regions`,
      { data: { resident_country: "IN" } },
    );
    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toBe(
      'MutualTLS realm="global-coordinator"',
    );
    expect(await response.json()).toMatchObject({
      type: "vetchium-problem-details/global-coordinator-authentication-required",
      status: 401,
    });
  } finally {
    await context.dispose();
  }
});

test("global coordinator rejects missing and wrong-purpose client certificates", async ({
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
        context.post(
          `${coordinator}/api/global-coordinator/list-signup-regions`,
          { data: { resident_country: "IN" } },
        ),
      ).rejects.toThrow();
    }
  } finally {
    await withoutCertificate.dispose();
    await wrongPurpose.dispose();
  }
});
test("online tenants claim global handles while an offline tenant remains pending", async ({
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const email = `e2e+${randomUUID()}@${domain}`;
  const indiaKeys: string[] = [];
  const singaporeKeys: string[] = [];
  const usaKeys: string[] = [];
  try {
    for (const tenant of ["ind1", "sgp", "usa1"] as const) {
      seedHubSignupDomain(domain, tenant);
    }
    // ind1 deliberately cannot reach the global coordinator in the CI config.
    const indiaToken = await requestSignupToken(
      request,
      "ind1",
      email,
      indiaKeys,
    );
    const indiaCompleteKey = hubIdempotencyKey();
    indiaKeys.push(indiaCompleteKey);
    const indiaPassword = `Password!${randomUUID()}`;
    const indiaCompletion = await request.post(
      "http://hub-ui.ind1.localhost/api/hub/complete-signup",
      {
        headers: { "Idempotency-Key": indiaCompleteKey },
        data: { signup_token: indiaToken, password: indiaPassword },
      },
    );
    expect(indiaCompletion.status(), await indiaCompletion.text()).toBe(202);
    const pending = (await indiaCompletion.json()) as {
      operation_id: string;
    };
    expect(pending.operation_id).toMatch(/^[0-9a-f-]{36}$/);

    const singapore = await signup(request, "sgp", email, singaporeKeys);
    const usa = await signup(request, "usa1", email, usaKeys);
    expect(singapore.hubUserDID).not.toBe(usa.hubUserDID);
    expect(singapore.handle).not.toBe(usa.handle);
    // The handle is public and the DID is not, so the suffix is random
    // rather than derived from the DID or from the signup time.
    for (const [tenant, account] of [
      ["sgp", singapore],
      ["usa1", usa],
    ] as const) {
      expect(account.handle).toMatch(/^indep-[0-9a-hjkmnp-tv-z]{11}$/);
      expect(account.handle).not.toContain(
        account.hubUserDID.replaceAll("-", ""),
      );
      expect(account.hubUserDID).not.toContain(
        account.handle.replace("indep-", ""),
      );
      expect(globalHubPrincipal(account.hubUserDID)).toEqual({
        handle: account.handle,
        homeTenantID: tenant,
        state: "active",
      });
    }
  } finally {
    cleanupHubUser(email, "ind1");
    cleanupHubUser(email, "sgp");
    cleanupHubUser(email, "usa1");
    cleanupHubIdempotency(indiaKeys, "ind1");
    cleanupHubIdempotency(singaporeKeys, "sgp");
    cleanupHubIdempotency(usaKeys, "usa1");
    for (const tenant of ["ind1", "sgp", "usa1"] as const) {
      cleanupHubSignupDomain(domain, tenant);
    }
  }
});

test("a closed tenant rejects signup without creating an account", async ({
  request,
}) => {
  const email = `e2e+${randomUUID()}@e2e-${randomUUID()}.example.test`;
  const key = hubIdempotencyKey();
  try {
    const response = await request.post(
      "http://hub-ui.deu.localhost/api/hub/request-signup",
      {
        headers: { "Idempotency-Key": key },
        data: {
          email_address: email,
          display_name: "Closed Signup",
          preferred_language: "en-US",
          resident_country: "DE",
        },
      },
    );
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      type: "vetchium-problem-details/hub-signup-unavailable",
      status: 403,
    });
    const login = await request.post(
      "http://hub-ui.deu.localhost/api/hub/login",
      {
        data: { email_address: email, password: "No-account-created-password" },
      },
    );
    expect(login.status()).toBe(401);
  } finally {
    cleanupHubUser(email, "deu");
    cleanupHubIdempotency([key], "deu");
  }
});

test("signup completion rechecks regional admission", async ({ request }) => {
  const email = `e2e+${randomUUID()}@e2e-${randomUUID()}.example.test`;
  const token =
    randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  const key = hubIdempotencyKey();
  try {
    seedPendingHubSignup(email, token, "deu");
    const response = await request.post(
      "http://hub-ui.deu.localhost/api/hub/complete-signup",
      {
        headers: { "Idempotency-Key": key },
        data: { signup_token: token, password: `Password!${randomUUID()}` },
      },
    );
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      type: "vetchium-problem-details/hub-signup-unavailable",
      status: 403,
    });
  } finally {
    cleanupHubUser(email, "deu");
    cleanupHubIdempotency([key], "deu");
  }
});

test("India requires its own allowlist at signup initiation and completion", async ({
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const email = `e2e+${randomUUID()}@${domain}`;
  const keys: string[] = [];
  const origin = "http://hub-ui.ind1.localhost";
  const token =
    randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  const password = `Password!${randomUUID()}`;
  try {
    for (const tenant of ["sgp", "usa1", "deu"] as const) {
      seedHubSignupDomain(domain, tenant);
    }
    const requestKey = hubIdempotencyKey();
    keys.push(requestKey);
    const rejected = await request.post(`${origin}/api/hub/request-signup`, {
      headers: { "Idempotency-Key": requestKey },
      data: {
        email_address: email,
        display_name: "Independent User",
        resident_country: "IN",
        preferred_language: "en-US",
      },
    });
    expect(rejected.status()).toBe(403);
    expect(rejected.headers()["content-type"]).toContain(
      "application/problem+json",
    );
    expect(await rejected.json()).toMatchObject({
      type: "vetchium-problem-details/hub-signup-domain-not-allowed",
      status: 403,
    });

    // A pending token is not authority to bypass destination admission either.
    seedPendingHubSignup(email, token, "ind1");
    const completeKey = hubIdempotencyKey();
    keys.push(completeKey);
    const completion = await request.post(`${origin}/api/hub/complete-signup`, {
      headers: { "Idempotency-Key": completeKey },
      data: { signup_token: token, password },
    });
    expect(completion.status()).toBe(401);
    expect(completion.headers()["content-type"]).toContain(
      "application/problem+json",
    );
    expect(completion.headers()["www-authenticate"]).toBeDefined();
    expect(await completion.json()).toMatchObject({
      type: "vetchium-problem-details/hub-invalid-signup-token",
      status: 401,
    });
    const login = await request.post(`${origin}/api/hub/login`, {
      data: { email_address: email, password },
    });
    expect(login.status()).toBe(401);

    seedHubSignupDomain(domain, "ind1");
    const allowedToken = await requestSignupToken(request, "ind1", email, keys);
    const allowedKey = hubIdempotencyKey();
    keys.push(allowedKey);
    const pending = await request.post(`${origin}/api/hub/complete-signup`, {
      headers: { "Idempotency-Key": allowedKey },
      data: { signup_token: allowedToken, password },
    });
    expect(pending.status(), await pending.text()).toBe(202);
  } finally {
    cleanupHubUser(email, "ind1");
    cleanupHubIdempotency(keys, "ind1");
    for (const tenant of ["sgp", "usa1", "deu", "ind1"] as const) {
      cleanupHubSignupDomain(domain, tenant);
    }
  }
});
