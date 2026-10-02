import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import type { LoginResponse } from "typespec/hub/auth/login";
import type { CompleteSignupResponse } from "typespec/hub/auth/signup";
import { hubUserDIDForHandle, type TestTenant } from "./admin-db.ts";
import { hubIdempotencyKey, MAILPIT_ORIGIN } from "./hub-api.ts";
import { apiOrigin, emailedLinkToken, HUB_PORTAL } from "./portals.ts";

export interface SignedUpHubUser {
  hubUserDID: string;
  handle: string;
  password: string;
}

/**
 * Signs up a new Hub user in a tenant, following the email
 * verification link through Mailpit, and returns the identifiers and
 * password the caller needs to log in and clean up. Every idempotency key
 * used is appended to `keys` for cleanup.
 */
export async function signup(
  request: APIRequestContext,
  tenant: TestTenant,
  email: string,
  keys: string[],
  options: {
    displayName?: string;
    language?: string;
    residentCountry?: string;
  } = {},
): Promise<SignedUpHubUser> {
  const displayName = options.displayName ?? "Independent User";
  const language = options.language ?? "en-US";
  const residentCountry = options.residentCountry ?? "FR";
  const signupKey = hubIdempotencyKey();
  const completeKey = hubIdempotencyKey();
  keys.push(signupKey, completeKey);
  const origin = apiOrigin(tenant);
  const response = await request.post(`${origin}/api/hub/request-signup`, {
    headers: { "Idempotency-Key": signupKey },
    data: {
      email_address: email,
      display_name: displayName,
      preferred_language: language,
      resident_country: residentCountry,
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
    .toContain(`${HUB_PORTAL}/complete-signup?region=${tenant}&token=`);
  const token = emailedLinkToken(text, "/complete-signup", tenant);
  expect(token).toBeDefined();
  const password = `Password!${randomUUID()}`;
  const complete = await request.post(`${origin}/api/hub/complete-signup`, {
    headers: { "Idempotency-Key": completeKey },
    data: { signup_token: token, password },
  });
  expect(complete.status(), await complete.text()).toBe(201);
  const body = (await complete.json()) as CompleteSignupResponse;
  return {
    hubUserDID: hubUserDIDForHandle(body.handle, tenant),
    handle: body.handle,
    password,
  };
}

/** Logs in a signed-up Hub user and returns a bearer session token. */
export async function login(
  request: APIRequestContext,
  tenant: TestTenant,
  email: string,
  password: string,
): Promise<string> {
  const response = await request.post(`${apiOrigin(tenant)}/api/hub/login`, {
    data: { email_address: email, password },
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as LoginResponse;
  if (body.authentication_state !== "authenticated") {
    throw new Error("login unexpectedly required a second factor");
  }
  return body.session_token;
}
