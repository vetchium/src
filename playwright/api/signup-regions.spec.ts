import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type { CompleteSignupResponse } from "typespec/hub/auth/signup";
import type { ListSignupRegionsResponse } from "typespec/regions/regions";
import {
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  seedHubSignupDomain,
  seedPendingHubSignup,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { hubIdempotencyKey, MAILPIT_ORIGIN } from "../lib/hub-api.ts";

const coordinator =
  process.env.GLOBAL_COORDINATOR_TEST_URL ??
  `http://127.0.0.1:${process.env.GLOBAL_COORDINATOR_PORT ?? "18080"}`;
const credential =
  process.env.GLOBAL_COORDINATOR_CREDENTIAL ??
  "dev_global_coordinator_credential_32_bytes";
for (const [name, origin, prefix, headers] of [
  ["hub", "http://hub-ui.sgp.localhost", "/api/hub", {}],
  [
    "global",
    coordinator,
    "/api/global-coordinator",
    { Authorization: `Bearer ${credential}` },
  ],
  ["offline tenant via mesh", "http://hub-ui.ind1.localhost", "/api/hub", {}],
] as const) {
  test(`${name} discovers regions and validates its request`, async ({
    request,
  }) => {
    const url = `${origin}${prefix}/list-signup-regions`;
    const response = await request.post(url, {
      headers,
      data: { resident_country: "IND" },
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
      [{ resident_country: "ZZZ" }, "validation-failed"],
      [
        { resident_country: "IND", pagination_key: "invalid" },
        "invalid-pagination-key",
      ],
      [{ resident_country: "IND", extra: true }, "invalid-json"],
    ]) {
      const invalid = await request.post(url, { headers, data });
      expect(invalid.status()).toBe(400);
      expect(invalid.headers()["content-type"]).toContain(
        "application/problem+json",
      );
      expect(await invalid.json()).toMatchObject({
        type: `vetchium-problem-details/${problem}`,
        status: 400,
      });
    }
  });
}
test("global region discovery requires authentication", async ({ request }) => {
  const response = await request.post(
    `${coordinator}/api/global-coordinator/list-signup-regions`,
    { data: { resident_country: "IND" } },
  );
  expect(response.status()).toBe(401);
  expect(response.headers()["www-authenticate"]).toBe(
    'Bearer realm="global-coordinator"',
  );
  expect(await response.json()).toMatchObject({
    type: "vetchium-problem-details/global-coordinator-authentication-required",
    status: 401,
  });
});
async function signup(
  request: APIRequestContext,
  tenant: string,
  email: string,
  keys: string[],
): Promise<CompleteSignupResponse> {
  const signupKey = hubIdempotencyKey();
  const completeKey = hubIdempotencyKey();
  keys.push(signupKey, completeKey);
  const origin = `http://hub-ui.${tenant}.localhost`;
  const response = await request.post(`${origin}/api/hub/request-signup`, {
    headers: { "Idempotency-Key": signupKey },
    data: {
      email_address: email,
      display_name: "Independent User",
      preferred_language: "en-US",
      resident_country: "FRA",
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
      { timeout: 15000 },
    )
    .toContain(`${origin}/complete-signup`);
  const token = text.match(/complete-signup\?token=([0-9a-f]{64})/)?.[1];
  expect(token).toBeDefined();
  const complete = await request.post(`${origin}/api/hub/complete-signup`, {
    headers: { "Idempotency-Key": completeKey },
    data: { signup_token: token, password: `Password!${randomUUID()}` },
  });
  expect(complete.status(), await complete.text()).toBe(201);
  const body = (await complete.json()) as CompleteSignupResponse;
  expect(body.handle.replace("indep-", "")).toBe(
    body.hub_user_did.replaceAll("-", ""),
  );
  return body;
}
test("allowlisted signup works offline and the same email creates independent regional accounts", async ({
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const email = `e2e+${randomUUID()}@${domain}`;
  const indiaKeys: string[] = [];
  const usaKeys: string[] = [];
  try {
    for (const tenant of ["ind1", "usa1"] as const) {
      seedHubSignupDomain(domain, tenant);
    }
    // ind1 deliberately cannot reach the global coordinator in the CI config.
    const india = await signup(request, "ind1", email, indiaKeys);
    const usa = await signup(request, "usa1", email, usaKeys);
    expect(india.hub_user_did).not.toBe(usa.hub_user_did);
    expect(india.handle).not.toBe(usa.handle);
  } finally {
    cleanupHubUser(email, "ind1");
    cleanupHubUser(email, "usa1");
    cleanupHubIdempotency(indiaKeys, "ind1");
    cleanupHubIdempotency(usaKeys, "usa1");
    for (const tenant of ["ind1", "usa1"] as const) {
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
          resident_country: "DEU",
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
        resident_country: "IND",
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
    await signup(request, "ind1", email, keys);
  } finally {
    cleanupHubUser(email, "ind1");
    cleanupHubIdempotency(keys, "ind1");
    for (const tenant of ["sgp", "usa1", "deu", "ind1"] as const) {
      cleanupHubSignupDomain(domain, tenant);
    }
  }
});
