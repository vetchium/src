import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import {
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  globalHubPrincipal,
  seedHubSignupDomain,
  seedPendingHubSignup,
  type TestTenant,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { hubIdempotencyKey, MAILPIT_ORIGIN } from "../lib/hub-api.ts";
import { signup } from "../lib/hub-signup.ts";
import { apiOrigin, emailedLinkToken, HUB_PORTAL } from "../lib/portals.ts";

// Destination admission and global handle claims. The destination region is
// authoritative: closed regions, country restrictions, and allowlists are
// enforced at initiation and again at completion.

async function requestSignupToken(
  request: APIRequestContext,
  tenant: TestTenant,
  email: string,
  keys: string[],
): Promise<string> {
  const origin = apiOrigin(tenant);
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
    .toContain(`${HUB_PORTAL}/complete-signup?region=${tenant}&token=`);
  const token = emailedLinkToken(text, "/complete-signup", tenant);
  if (token === undefined)
    throw new Error("signup email did not contain a token");
  return token;
}

test("online tenants claim global handles while an offline tenant remains pending", async ({
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  // A distinct address per tenant: the Hub account email is globally unique
  // (agent-guides/hub-signup.md); hub-global-email.spec.ts covers the race.
  const indiaEmail = `e2e+${randomUUID()}@${domain}`;
  const singaporeEmail = `e2e+${randomUUID()}@${domain}`;
  const usaEmail = `e2e+${randomUUID()}@${domain}`;
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
      indiaEmail,
      indiaKeys,
    );
    const indiaCompleteKey = hubIdempotencyKey();
    indiaKeys.push(indiaCompleteKey);
    const indiaPassword = `Password!${randomUUID()}`;
    const indiaCompletion = await request.post(
      `${apiOrigin("ind1")}/api/hub/complete-signup`,
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

    const singapore = await signup(
      request,
      "sgp",
      singaporeEmail,
      singaporeKeys,
    );
    const usa = await signup(request, "usa1", usaEmail, usaKeys);
    expect(singapore.hubUserDID).not.toBe(usa.hubUserDID);
    expect(singapore.handle).not.toBe(usa.handle);
    // The handle is public and the DID is not, so the suffix is random
    // rather than derived from the DID or from the signup time.
    for (const [tenant, account] of [
      ["sgp", singapore],
      ["usa1", usa],
    ] as const) {
      expect(account.handle).toMatch(/^independ-[0-9a-hjkmnp-tv-z]{11}$/);
      expect(account.handle).not.toContain(
        account.hubUserDID.replaceAll("-", ""),
      );
      expect(account.hubUserDID).not.toContain(
        account.handle.replace("independ-", ""),
      );
      expect(globalHubPrincipal(account.hubUserDID)).toEqual({
        handle: account.handle,
        homeTenantID: tenant,
        state: "active",
      });
    }
  } finally {
    cleanupHubUser(indiaEmail, "ind1");
    cleanupHubUser(singaporeEmail, "sgp");
    cleanupHubUser(usaEmail, "usa1");
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
      `${apiOrigin("deu")}/api/hub/request-signup`,
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
    const login = await request.post(`${apiOrigin("deu")}/api/hub/login`, {
      data: { email_address: email, password: "No-account-created-password" },
    });
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
      `${apiOrigin("deu")}/api/hub/complete-signup`,
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
  const origin = apiOrigin("ind1");
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
