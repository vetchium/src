import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type {
  CompleteSignupRequest,
  CompleteSignupResponse,
  RequestSignupRequest,
  SignupCompletionPendingResponse,
} from "typespec/hub/auth/signup";
import type { HubAccountHomedElsewhereDetails } from "typespec/problem/hub/signup";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import {
  auditEventJSONForTenant,
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  hubSignupCompletionState,
  seedHubSignupDomain,
  sqlLiteral,
  type TestTenant,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { HubAPI, hubIdempotencyKey, MAILPIT_ORIGIN } from "../lib/hub-api.ts";
import { signup } from "../lib/hub-signup.ts";

/** Each test owns an allowlisted domain and removes everything it created. */
function testDomain(): string {
  return `e2e-${randomUUID()}.example.test`;
}

function addressAt(domain: string): string {
  return `e2e+${randomUUID()}@${domain}`;
}

function originFor(tenant: TestTenant): string {
  return `http://hub-ui.${tenant}.localhost`;
}

async function latestMail(
  request: APIRequestContext,
  address: string,
  expected: string,
): Promise<string> {
  const mailbox = `${MAILPIT_ORIGIN}/view/latest.txt?query=${encodeURIComponent(
    `to:${address}`,
  )}`;
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
    .toContain(expected);
  return text;
}

function requestSignupBody(email: string): RequestSignupRequest {
  return {
    email_address: email,
    display_name: "Race Signer",
    preferred_language: "en-US",
    resident_country: "US",
  };
}

/** Requests signup and returns the raw 64-hex complete-signup token from the
 * mail Mailpit received, without asserting on the outcome the way
 * `lib/hub-signup.ts`'s `signup()` does — the tests here need to inspect or
 * interleave the two steps themselves. */
async function requestSignupAndGetToken(
  request: APIRequestContext,
  hub: HubAPI,
  tenant: TestTenant,
  email: string,
  key: string,
): Promise<string> {
  const requested = await hub.post(
    "/request-signup",
    requestSignupBody(email),
    {
      idempotencyKey: key,
    },
  );
  expect(requested.status(), await requested.text()).toBe(202);
  const origin = originFor(tenant);
  const mail = await latestMail(request, email, `${origin}/complete-signup`);
  const token = mail.match(/complete-signup\?token=([0-9a-f]{64})/)?.[1];
  expect(token).toBeDefined();
  return token as string;
}

test("a signup request for an address already registered elsewhere sends no link and is audited", async ({
  request,
}) => {
  const domain = testDomain();
  const keys: string[] = [];
  const usa1Keys: string[] = [];
  const email = addressAt(domain);
  try {
    seedHubSignupDomain(domain, "sgp");
    seedHubSignupDomain(domain, "usa1");
    const [signupKey, completeKey] = [hubIdempotencyKey(), hubIdempotencyKey()];
    keys.push(signupKey, completeKey);
    await signup(request, "sgp", email, keys, { displayName: "Sgp Owner" });

    const usa1 = new HubAPI(request, "usa1");
    const requestKey = hubIdempotencyKey();
    usa1Keys.push(requestKey);
    const requested = await usa1.post(
      "/request-signup",
      requestSignupBody(email),
      { idempotencyKey: requestKey },
    );
    expect(requested.status(), await requested.text()).toBe(202);

    const mail = await latestMail(request, email, "already have an account");
    expect(mail).toContain("sgp region");
    expect(mail).not.toContain("complete-signup");

    const audit = auditEventJSONForTenant(
      "usa1",
      `idempotency_key = ${sqlLiteral(requestKey)}`,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "hub.signup.rejected",
      payload: {
        reason: "email_registered_elsewhere",
        home_tenant_id: "sgp",
      },
    });
  } finally {
    cleanupHubUser(email, "sgp");
    cleanupHubUser(email, "usa1");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubIdempotency(usa1Keys, "usa1");
    cleanupHubSignupDomain(domain, "sgp");
    cleanupHubSignupDomain(domain, "usa1");
  }
});

test("racing signups for the same address: the second completion is sent to the first's region", async ({
  request,
}) => {
  const domain = testDomain();
  const email = addressAt(domain);
  const sgpKeys: string[] = [];
  const usa1Keys: string[] = [];
  try {
    seedHubSignupDomain(domain, "sgp");
    seedHubSignupDomain(domain, "usa1");
    const sgp = new HubAPI(request, "sgp");
    const usa1 = new HubAPI(request, "usa1");

    // Both requests are issued before either completes: at this point the
    // address is not yet claimed anywhere, so both get a real signup link.
    const sgpSignupKey = hubIdempotencyKey();
    sgpKeys.push(sgpSignupKey);
    const sgpToken = await requestSignupAndGetToken(
      request,
      sgp,
      "sgp",
      email,
      sgpSignupKey,
    );
    const usa1SignupKey = hubIdempotencyKey();
    usa1Keys.push(usa1SignupKey);
    const usa1Token = await requestSignupAndGetToken(
      request,
      usa1,
      "usa1",
      email,
      usa1SignupKey,
    );

    const sgpCompleteKey = hubIdempotencyKey();
    sgpKeys.push(sgpCompleteKey);
    const sgpCompleted = await sgp.post(
      "/complete-signup",
      {
        signup_token: sgpToken,
        password: `Password!${randomUUID()}`,
      } satisfies CompleteSignupRequest,
      { idempotencyKey: sgpCompleteKey },
    );
    expect(sgpCompleted.status(), await sgpCompleted.text()).toBe(201);
    await responseJSON<CompleteSignupResponse>(sgpCompleted);

    const usa1CompleteKey = hubIdempotencyKey();
    usa1Keys.push(usa1CompleteKey);
    const usa1CompleteBody: CompleteSignupRequest = {
      signup_token: usa1Token,
      password: `Password!${randomUUID()}`,
    };
    const lost = await usa1.post("/complete-signup", usa1CompleteBody, {
      idempotencyKey: usa1CompleteKey,
    });
    await expectProblem(
      lost,
      409,
      "vetchium-problem-details/hub-account-homed-elsewhere",
    );
    const lostBody = await responseJSON<HubAccountHomedElsewhereDetails>(lost);
    expect(lostBody.tenant_id).toBe("sgp");
    expect(lostBody.hub_url).toBe(originFor("sgp"));

    const state = hubSignupCompletionState(email, "usa1");
    expect(state).toMatchObject({
      state: "failed",
      attemptCount: 0,
      failureReason: "email_registered_elsewhere",
      conflictingHomeTenantID: "sgp",
      localAccountCreated: false,
    });

    // A replay with the same token and idempotency key reaches the same,
    // already-terminal outcome rather than re-deriving it.
    const replay = await usa1.post("/complete-signup", usa1CompleteBody, {
      idempotencyKey: usa1CompleteKey,
    });
    await expectProblem(
      replay,
      409,
      "vetchium-problem-details/hub-account-homed-elsewhere",
    );
  } finally {
    cleanupHubUser(email, "sgp");
    cleanupHubUser(email, "usa1");
    cleanupHubIdempotency(sgpKeys, "sgp");
    cleanupHubIdempotency(usa1Keys, "usa1");
    cleanupHubSignupDomain(domain, "sgp");
    cleanupHubSignupDomain(domain, "usa1");
  }
});

test("ind1 signup completion is pending while the coordinator is unreachable and never activates a user", async ({
  request,
}) => {
  const domain = testDomain();
  const email = addressAt(domain);
  const keys: string[] = [];
  try {
    seedHubSignupDomain(domain, "ind1");
    const ind1 = new HubAPI(request, "ind1");
    const signupKey = hubIdempotencyKey();
    keys.push(signupKey);
    // config/ci/ind1.json deliberately points ind1's mesh-api at an
    // unreachable coordinator; request-signup still fails open and sends a
    // real link (GU-SIG-002), since resolving the address is a best-effort
    // convenience, not the authoritative gate.
    const token = await requestSignupAndGetToken(
      request,
      ind1,
      "ind1",
      email,
      signupKey,
    );

    const completeKey = hubIdempotencyKey();
    keys.push(completeKey);
    const completed = await ind1.post(
      "/complete-signup",
      {
        signup_token: token,
        password: `Password!${randomUUID()}`,
      } satisfies CompleteSignupRequest,
      { idempotencyKey: completeKey },
    );
    expect(completed.status(), await completed.text()).toBe(202);
    const pending =
      await responseJSON<SignupCompletionPendingResponse>(completed);
    expect(pending.operation_id).toBeTruthy();

    const state = hubSignupCompletionState(email, "ind1");
    expect(state).toMatchObject({ localAccountCreated: false });
    expect(state?.state).not.toBe("completed");
  } finally {
    cleanupHubUser(email, "ind1");
    cleanupHubIdempotency(keys, "ind1");
    cleanupHubSignupDomain(domain, "ind1");
  }
});
