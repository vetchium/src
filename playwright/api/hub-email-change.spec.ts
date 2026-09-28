import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type {
  ConfirmEmailChangeRequest,
  EmailChangeChallenge,
  RequestEmailChangeRequest,
} from "typespec/hub/auth/email_change";
import { Pending } from "typespec/hub/operations/operations";
import type { MyInfoResponse } from "typespec/hub/users/profile";
import {
  IdempotencyKeyConflictError,
  RateLimitExceededError,
} from "typespec/problem/common";
import {
  InvalidJSONError,
  ValidationFailedError,
} from "typespec/problem/details";
import {
  AuthenticationRequiredError,
  InvalidCredentialsError,
  InvalidPasswordResetTokenError,
  RecentAuthenticationRequiredError,
} from "typespec/problem/hub/authentication";
import {
  EmailAddressUnavailableError,
  EmailChangeCodeRejectedError,
  EmailChangeInProgressError,
} from "typespec/problem/hub/email";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import {
  ageHubSession,
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  hubAuditEventsByIdempotencyKey,
  hubAuditEventsForActor,
  seedHubSignupDomain,
  sqlLiteral,
  sqlScalarForTenant,
  type TestTenant,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { HubAPI, hubIdempotencyKey, MAILPIT_ORIGIN } from "../lib/hub-api.ts";
import { login, signup } from "../lib/hub-signup.ts";

interface Account {
  email: string;
  password: string;
  handle: string;
  hubUserDID: string;
  token: string;
}

/** Each test owns an allowlisted domain and removes everything it created. */
function testDomain(): string {
  return `e2e-${randomUUID()}.example.test`;
}

function addressAt(domain: string): string {
  return `e2e+${randomUUID()}@${domain}`;
}

async function createAccount(
  request: APIRequestContext,
  domain: string,
  keys: string[],
  tenant: TestTenant = "sgp",
): Promise<Account> {
  const email = addressAt(domain);
  const user = await signup(request, tenant, email, keys, {
    displayName: "Email Changer",
  });
  return {
    email,
    password: user.password,
    handle: user.handle,
    hubUserDID: user.hubUserDID,
    token: await login(request, tenant, email, user.password),
  };
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

async function emailChangeCode(
  request: APIRequestContext,
  address: string,
): Promise<string> {
  const text = await latestMail(request, address, "Your code is");
  const code = text.match(/Your code is (\d{6})/)?.[1];
  expect(code).toBeDefined();
  return code as string;
}

function requestChange(
  hub: HubAPI,
  token: string,
  body: RequestEmailChangeRequest,
  idempotencyKey = hubIdempotencyKey(),
) {
  return hub.post("/request-email-change", body, { token, idempotencyKey });
}

function confirmChange(
  hub: HubAPI,
  token: string,
  body: ConfirmEmailChangeRequest,
  idempotencyKey = hubIdempotencyKey(),
) {
  return hub.post("/confirm-email-change", body, { token, idempotencyKey });
}

async function myInfo(hub: HubAPI, token: string): Promise<MyInfoResponse> {
  const response = await hub.get("/my-info", token);
  expect(response.status(), await response.text()).toBe(200);
  return responseJSON<MyInfoResponse>(response);
}

function cleanup(
  domain: string,
  addresses: string[],
  keys: string[],
  hub: HubAPI,
) {
  for (const address of addresses) cleanupHubUser(address, "sgp");
  cleanupHubIdempotency([...keys, ...hub.idempotencyKeys], "sgp");
  cleanupHubSignupDomain(domain, "sgp");
}

test("a confirmed email change moves sign-in to the proven address and revokes old access", async ({
  request,
}) => {
  const domain = testDomain();
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const newAddress = addressAt(domain);
  let account: Account | undefined;
  try {
    seedHubSignupDomain(domain, "sgp");
    account = await createAccount(request, domain, keys);
    const otherSession = await login(
      request,
      "sgp",
      account.email,
      account.password,
    );

    const resetRequested = await hub.post(
      "/request-password-reset",
      { email_address: account.email },
      { idempotencyKey: hubIdempotencyKey() },
    );
    expect(resetRequested.status()).toBe(202);
    const resetMail = await latestMail(
      request,
      account.email,
      "reset-password",
    );
    const resetToken = resetMail.match(
      /reset-password\?token=([0-9a-f]{64})/,
    )?.[1];
    expect(resetToken).toBeDefined();

    const requestKey = hubIdempotencyKey();
    const requested = await requestChange(
      hub,
      account.token,
      { new_email_address: ` ${newAddress.toUpperCase()} ` },
      requestKey,
    );
    expect(requested.status(), await requested.text()).toBe(202);
    expect(requested.headers()["cache-control"]).toBe("no-store");
    const challenge = await responseJSON<EmailChangeChallenge>(requested);
    expect(Object.keys(challenge).sort()).toEqual([
      "challenge_id",
      "expires_at",
    ]);
    expect(Date.parse(challenge.expires_at)).toBeGreaterThan(Date.now());

    const replay = await requestChange(
      hub,
      account.token,
      { new_email_address: newAddress },
      requestKey,
    );
    expect(replay.status()).toBe(202);
    expect(await responseJSON<EmailChangeChallenge>(replay)).toEqual(challenge);
    await expectProblem(
      await requestChange(
        hub,
        account.token,
        { new_email_address: addressAt(domain) },
        requestKey,
      ),
      409,
      IdempotencyKeyConflictError.type,
    );
    const requestAudit = hubAuditEventsByIdempotencyKey(requestKey);
    expect(requestAudit).toHaveLength(1);
    expect(requestAudit[0]).toMatchObject({
      action: "hub.email-change.requested",
      entity_id: account.hubUserDID,
      actor_id: account.hubUserDID,
      payload: { code_queued: true },
    });
    expect(JSON.stringify(requestAudit[0]?.payload)).not.toContain("@");

    const code = await emailChangeCode(request, newAddress);
    const wrongCode = code === "000000" ? "000001" : "000000";

    // The challenge belongs to the session that asked for it.
    await expectProblem(
      await confirmChange(hub, otherSession, {
        challenge_id: challenge.challenge_id,
        code,
      }),
      400,
      EmailChangeCodeRejectedError.type,
    );

    // Confirmation needs no fresh password: the recently authenticated
    // request already proved that, and the code proves the new mailbox.
    ageHubSession(account.token);

    // A wrong-code attempt no longer creates a durable operation (GU-ECH-002:
    // only a correct code does), so unlike a completed change, it has
    // nothing for a replay to conflict against. Each call with its own key
    // genuinely re-attempts and bumps attempt_count independently — a
    // deliberate M4 trade-off, see docs/global-uniqueness.md §10.
    const wrongKey1 = hubIdempotencyKey();
    await expectProblem(
      await confirmChange(
        hub,
        account.token,
        { challenge_id: challenge.challenge_id, code: wrongCode },
        wrongKey1,
      ),
      400,
      EmailChangeCodeRejectedError.type,
    );
    const wrongKey2 = hubIdempotencyKey();
    await expectProblem(
      await confirmChange(
        hub,
        account.token,
        { challenge_id: challenge.challenge_id, code: wrongCode },
        wrongKey2,
      ),
      400,
      EmailChangeCodeRejectedError.type,
    );
    const failedAudit1 = hubAuditEventsByIdempotencyKey(wrongKey1);
    expect(failedAudit1).toHaveLength(1);
    expect(failedAudit1[0]).toMatchObject({
      action: "hub.email-change.verification-failed",
      payload: { attempt_count: 1 },
    });
    const failedAudit2 = hubAuditEventsByIdempotencyKey(wrongKey2);
    expect(failedAudit2).toHaveLength(1);
    expect(failedAudit2[0]).toMatchObject({
      action: "hub.email-change.verification-failed",
      payload: { attempt_count: 2 },
    });

    const confirmKey = hubIdempotencyKey();
    const confirmed = await confirmChange(
      hub,
      account.token,
      { challenge_id: challenge.challenge_id, code },
      confirmKey,
    );
    expect(confirmed.status(), await confirmed.text()).toBe(204);
    expect(confirmed.headers()["cache-control"]).toBe("no-store");
    // The client's idempotency key now only covers accepting the code
    // (GU-ECH-002); the local apply that actually changes the address is a
    // separate durable step keyed by the operation id, not the client's key.
    const confirmAudit = hubAuditEventsByIdempotencyKey(confirmKey);
    expect(confirmAudit).toHaveLength(1);
    expect(confirmAudit[0]).toMatchObject({
      action: "hub.email-change.accepted",
      entity_type: "hub_user",
      entity_id: account.hubUserDID,
      actor_type: "hub_user",
      actor_id: account.hubUserDID,
    });
    const changedAudit = hubAuditEventsForActor(
      account.hubUserDID,
      "hub.email.changed",
    );
    expect(changedAudit).toHaveLength(1);
    expect(changedAudit[0]).toMatchObject({
      payload: {
        changed_fields: ["email_address"],
        other_sessions_revoked: true,
        previous_address_notified: true,
      },
    });
    expect(JSON.stringify(changedAudit[0]?.payload)).not.toContain("@");

    const info = await myInfo(hub, account.token);
    expect(info.email_address).toBe(newAddress);
    await expectProblem(
      await hub.get("/my-info", otherSession),
      401,
      AuthenticationRequiredError.type,
    );
    await expectProblem(
      await hub.post(
        "/complete-password-reset",
        { reset_token: resetToken, new_password: `Reset!${randomUUID()}` },
        { idempotencyKey: hubIdempotencyKey() },
      ),
      401,
      InvalidPasswordResetTokenError.type,
    );
    await expectProblem(
      await hub.post("/login", {
        email_address: account.email,
        password: account.password,
      }),
      401,
      InvalidCredentialsError.type,
    );
    expect(
      await login(request, "sgp", newAddress, account.password),
    ).toBeTruthy();
    await latestMail(request, account.email, "was changed");

    // A used challenge cannot change the address again.
    await expectProblem(
      await confirmChange(hub, account.token, {
        challenge_id: challenge.challenge_id,
        code,
      }),
      400,
      EmailChangeCodeRejectedError.type,
    );
  } finally {
    cleanup(domain, [account?.email ?? newAddress, newAddress], keys, hub);
  }
});

test("after signup a user may move to an address outside the signup allowlist", async ({
  request,
}) => {
  const domain = testDomain();
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  // Never added to the allowlist, like a personal mailbox provider.
  const firstAddress = addressAt(testDomain());
  let account: Account | undefined;
  try {
    seedHubSignupDomain(domain, "sgp");
    account = await createAccount(request, domain, keys);

    const anonymous = await hub.post(
      "/request-email-change",
      { new_email_address: firstAddress },
      { idempotencyKey: hubIdempotencyKey() },
    );
    await expectProblem(anonymous, 401, AuthenticationRequiredError.type);
    expect(anonymous.headers()["www-authenticate"]).toBe('Bearer realm="hub"');
    await expectProblem(
      await hub.postRaw("/request-email-change", "{", {
        token: account.token,
        idempotencyKey: hubIdempotencyKey(),
      }),
      400,
      InvalidJSONError.type,
    );
    await expectProblem(
      await requestChange(hub, account.token, {
        new_email_address: "not-an-address",
      }),
      400,
      ValidationFailedError.type,
      ["new_email_address"],
    );
    const first = await requestChange(hub, account.token, {
      new_email_address: firstAddress,
    });
    expect(first.status(), await first.text()).toBe(202);
    const challenge = await responseJSON<EmailChangeChallenge>(first);
    await expectProblem(
      await requestChange(hub, account.token, {
        new_email_address: addressAt(domain),
      }),
      429,
      RateLimitExceededError.type,
    );

    // The refused resend rolled back, so the first challenge still works.
    const code = await emailChangeCode(request, firstAddress);
    const confirmed = await confirmChange(hub, account.token, {
      challenge_id: challenge.challenge_id,
      code,
    });
    expect(confirmed.status(), await confirmed.text()).toBe(204);
    expect((await myInfo(hub, account.token)).email_address).toBe(firstAddress);
    expect(
      await login(request, "sgp", firstAddress, account.password),
    ).toBeTruthy();

    ageHubSession(account.token);
    const stale = await requestChange(hub, account.token, {
      new_email_address: addressAt(domain),
    });
    await expectProblem(stale, 401, RecentAuthenticationRequiredError.type);
    expect(stale.headers()["www-authenticate"]).toBe('Bearer realm="hub"');
  } finally {
    cleanup(domain, [account?.email ?? firstAddress, firstAddress], keys, hub);
  }
});

test("an address that already has an account gets the same response and no code", async ({
  request,
}) => {
  const domain = testDomain();
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const accounts: Account[] = [];
  try {
    seedHubSignupDomain(domain, "sgp");
    accounts.push(await createAccount(request, domain, keys));
    accounts.push(await createAccount(request, domain, keys));
    const [changer, owner] = accounts as [Account, Account];

    const key = hubIdempotencyKey();
    const requested = await requestChange(
      hub,
      changer.token,
      { new_email_address: owner.email },
      key,
    );
    expect(requested.status(), await requested.text()).toBe(202);
    const challenge = await responseJSON<EmailChangeChallenge>(requested);
    expect(Object.keys(challenge).sort()).toEqual([
      "challenge_id",
      "expires_at",
    ]);
    expect(hubAuditEventsByIdempotencyKey(key)[0]).toMatchObject({
      action: "hub.email-change.requested",
      payload: { code_queued: false },
    });

    await expectProblem(
      await confirmChange(hub, changer.token, {
        challenge_id: challenge.challenge_id,
        code: "123456",
      }),
      400,
      EmailChangeCodeRejectedError.type,
    );
    expect((await myInfo(hub, changer.token)).email_address).toBe(
      changer.email,
    );
  } finally {
    cleanup(
      domain,
      accounts.map((account) => account.email),
      keys,
      hub,
    );
  }
});

test("confirming after another account claimed the address keeps the old address", async ({
  request,
}) => {
  const domain = testDomain();
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const contested = addressAt(domain);
  let account: Account | undefined;
  try {
    seedHubSignupDomain(domain, "sgp");
    account = await createAccount(request, domain, keys);
    const requested = await requestChange(hub, account.token, {
      new_email_address: contested,
    });
    expect(requested.status(), await requested.text()).toBe(202);
    const challenge = await responseJSON<EmailChangeChallenge>(requested);
    const code = await emailChangeCode(request, contested);

    await signup(request, "sgp", contested, keys, {
      displayName: "Faster Claimant",
    });

    const key = hubIdempotencyKey();
    await expectProblem(
      await confirmChange(
        hub,
        account.token,
        { challenge_id: challenge.challenge_id, code },
        key,
      ),
      409,
      EmailAddressUnavailableError.type,
    );
    // The code was correct, so the durable operation was accepted before the
    // global reserve rejected it (GU-ECH-002/003): the accept audit carries
    // the client's idempotency key, and the terminal rejection is audited
    // separately, keyed by the operation id it drives rather than the
    // client's key.
    const acceptedAudit = hubAuditEventsByIdempotencyKey(key);
    expect(acceptedAudit).toHaveLength(1);
    expect(acceptedAudit[0]).toMatchObject({
      action: "hub.email-change.accepted",
      entity_id: account.hubUserDID,
      actor_id: account.hubUserDID,
    });
    const rejectedAudit = hubAuditEventsForActor(
      account.hubUserDID,
      "hub.email-change.rejected",
    );
    expect(rejectedAudit).toHaveLength(1);
    expect(rejectedAudit[0]).toMatchObject({
      payload: { reason: "address_unavailable" },
    });
    expect((await myInfo(hub, account.token)).email_address).toBe(
      account.email,
    );
  } finally {
    cleanup(domain, [account?.email ?? contested, contested], keys, hub);
  }
});

test("five wrong codes exhaust an email change challenge", async ({
  request,
}) => {
  const domain = testDomain();
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const newAddress = addressAt(domain);
  let account: Account | undefined;
  try {
    seedHubSignupDomain(domain, "sgp");
    account = await createAccount(request, domain, keys);
    const requested = await requestChange(hub, account.token, {
      new_email_address: newAddress,
    });
    expect(requested.status(), await requested.text()).toBe(202);
    const challenge = await responseJSON<EmailChangeChallenge>(requested);
    const code = await emailChangeCode(request, newAddress);
    const wrongCode = code === "999999" ? "999998" : "999999";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectProblem(
        await confirmChange(hub, account.token, {
          challenge_id: challenge.challenge_id,
          code: wrongCode,
        }),
        400,
        EmailChangeCodeRejectedError.type,
      );
    }
    await expectProblem(
      await confirmChange(hub, account.token, {
        challenge_id: challenge.challenge_id,
        code,
      }),
      400,
      EmailChangeCodeRejectedError.type,
    );
    expect((await myInfo(hub, account.token)).email_address).toBe(
      account.email,
    );
  } finally {
    cleanup(domain, [account?.email ?? newAddress, newAddress], keys, hub);
  }
});

test("confirming an email change validates the session and body", async ({
  request,
}) => {
  const domain = testDomain();
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  let account: Account | undefined;
  try {
    seedHubSignupDomain(domain, "sgp");
    account = await createAccount(request, domain, keys);
    const body = { challenge_id: randomUUID(), code: "123456" };

    const anonymous = await hub.post("/confirm-email-change", body, {
      idempotencyKey: hubIdempotencyKey(),
    });
    await expectProblem(anonymous, 401, AuthenticationRequiredError.type);
    expect(anonymous.headers()["www-authenticate"]).toBe('Bearer realm="hub"');
    await expectProblem(
      await hub.postRaw("/confirm-email-change", "{", {
        token: account.token,
        idempotencyKey: hubIdempotencyKey(),
      }),
      400,
      InvalidJSONError.type,
    );
    await expectProblem(
      await confirmChange(hub, account.token, {
        challenge_id: "not-a-challenge",
        code: "12a",
      }),
      400,
      ValidationFailedError.type,
      ["challenge_id", "code"],
    );

    await expectProblem(
      await confirmChange(hub, account.token, body),
      400,
      EmailChangeCodeRejectedError.type,
    );
  } finally {
    cleanup(domain, account === undefined ? [] : [account.email], keys, hub);
  }
});

test("the address of a usa1 user sends no code and the same response from sgp", async ({
  request,
}) => {
  const domain = testDomain();
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  let changer: Account | undefined;
  let owner: Account | undefined;
  try {
    seedHubSignupDomain(domain, "sgp");
    seedHubSignupDomain(domain, "usa1");
    changer = await createAccount(request, domain, keys, "sgp");
    owner = await createAccount(request, domain, keys, "usa1");

    const key = hubIdempotencyKey();
    const requested = await requestChange(
      hub,
      changer.token,
      { new_email_address: owner.email },
      key,
    );
    expect(requested.status(), await requested.text()).toBe(202);
    const challenge = await responseJSON<EmailChangeChallenge>(requested);
    expect(hubAuditEventsByIdempotencyKey(key)[0]).toMatchObject({
      action: "hub.email-change.requested",
      payload: { code_queued: false },
    });

    await expectProblem(
      await confirmChange(hub, changer.token, {
        challenge_id: challenge.challenge_id,
        code: "123456",
      }),
      400,
      EmailChangeCodeRejectedError.type,
    );
    expect((await myInfo(hub, changer.token)).email_address).toBe(
      changer.email,
    );
  } finally {
    if (changer !== undefined) cleanupHubUser(changer.email, "sgp");
    if (owner !== undefined) cleanupHubUser(owner.email, "usa1");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubIdempotency(keys, "usa1");
    cleanupHubSignupDomain(domain, "sgp");
    cleanupHubSignupDomain(domain, "usa1");
  }
});

test("confirming after the address is claimed by a usa1 signup keeps the old address", async ({
  request,
}) => {
  const domain = testDomain();
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const contested = addressAt(domain);
  let account: Account | undefined;
  try {
    seedHubSignupDomain(domain, "sgp");
    seedHubSignupDomain(domain, "usa1");
    account = await createAccount(request, domain, keys, "sgp");
    const requested = await requestChange(hub, account.token, {
      new_email_address: contested,
    });
    expect(requested.status(), await requested.text()).toBe(202);
    const challenge = await responseJSON<EmailChangeChallenge>(requested);
    const code = await emailChangeCode(request, contested);

    // Claimed at another tenant, not the changer's own: the reserve step's
    // rejection comes from the global directory, not a local unique index.
    await signup(request, "usa1", contested, keys, {
      displayName: "Faster Claimant Elsewhere",
    });

    const key = hubIdempotencyKey();
    await expectProblem(
      await confirmChange(
        hub,
        account.token,
        { challenge_id: challenge.challenge_id, code },
        key,
      ),
      409,
      EmailAddressUnavailableError.type,
    );
    const acceptedAudit = hubAuditEventsByIdempotencyKey(key);
    expect(acceptedAudit).toHaveLength(1);
    expect(acceptedAudit[0]).toMatchObject({
      action: "hub.email-change.accepted",
      entity_id: account.hubUserDID,
      actor_id: account.hubUserDID,
    });
    const rejectedAudit = hubAuditEventsForActor(
      account.hubUserDID,
      "hub.email-change.rejected",
    );
    expect(rejectedAudit).toHaveLength(1);
    expect(rejectedAudit[0]).toMatchObject({
      payload: { reason: "address_unavailable" },
    });
    expect((await myInfo(hub, account.token)).email_address).toBe(
      account.email,
    );
  } finally {
    if (account !== undefined) cleanupHubUser(account.email, "sgp");
    cleanupHubUser(contested, "sgp");
    cleanupHubUser(contested, "usa1");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubIdempotency(keys, "usa1");
    cleanupHubSignupDomain(domain, "sgp");
    cleanupHubSignupDomain(domain, "usa1");
  }
});

test("after a successful change the old address frees up elsewhere and the new one is protected there", async ({
  request,
}) => {
  const domain = testDomain();
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const newAddress = addressAt(domain);
  let account: Account | undefined;
  try {
    seedHubSignupDomain(domain, "sgp");
    seedHubSignupDomain(domain, "usa1");
    account = await createAccount(request, domain, keys, "sgp");
    const oldAddress = account.email;
    const requested = await requestChange(hub, account.token, {
      new_email_address: newAddress,
    });
    expect(requested.status(), await requested.text()).toBe(202);
    const challenge = await responseJSON<EmailChangeChallenge>(requested);
    const code = await emailChangeCode(request, newAddress);
    const confirmed = await confirmChange(hub, account.token, {
      challenge_id: challenge.challenge_id,
      code,
    });
    expect(confirmed.status(), await confirmed.text()).toBe(204);

    // Finalizing the change released the old address's global claim, so a
    // brand-new signup elsewhere can now claim it.
    await signup(request, "usa1", oldAddress, keys, {
      displayName: "New Owner Of The Old Address",
    });

    // The new address now belongs to the sgp account, so a signup attempt
    // anywhere else gets the registered-elsewhere notice instead of a link.
    const usa1 = new HubAPI(request, "usa1");
    const elsewhereKey = hubIdempotencyKey();
    keys.push(elsewhereKey);
    const elsewhereRequested = await usa1.post(
      "/request-signup",
      {
        email_address: newAddress,
        display_name: "Too Late",
        preferred_language: "en-US",
        resident_country: "US",
      },
      { idempotencyKey: elsewhereKey },
    );
    expect(elsewhereRequested.status(), await elsewhereRequested.text()).toBe(
      202,
    );
    const mail = await latestMail(
      request,
      newAddress,
      "already have an account",
    );
    expect(mail).toContain("sgp region");
    expect(mail).not.toContain("complete-signup");
  } finally {
    if (account !== undefined) {
      cleanupHubUser(account.email, "sgp");
      cleanupHubUser(account.email, "usa1");
    }
    cleanupHubUser(newAddress, "sgp");
    cleanupHubUser(newAddress, "usa1");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubIdempotency(keys, "usa1");
    cleanupHubSignupDomain(domain, "sgp");
    cleanupHubSignupDomain(domain, "usa1");
  }
});

test("a pending confirm on ind1 changes nothing yet, blocks a new request, replays deterministically, and survives logout", async ({
  request,
}) => {
  const domain = testDomain();
  const keys: string[] = [];
  const hub = new HubAPI(request, "ind1");
  const newAddress = addressAt(domain);
  let account: Account | undefined;
  try {
    seedHubSignupDomain(domain, "ind1");
    account = await createAccount(request, domain, keys, "ind1");
    const otherSession = await login(
      request,
      "ind1",
      account.email,
      account.password,
    );

    const requested = await requestChange(hub, account.token, {
      new_email_address: newAddress,
    });
    expect(requested.status(), await requested.text()).toBe(202);
    const challenge = await responseJSON<EmailChangeChallenge>(requested);
    const code = await emailChangeCode(request, newAddress);

    const confirmKey = hubIdempotencyKey();
    const confirmed = await confirmChange(
      hub,
      account.token,
      { challenge_id: challenge.challenge_id, code },
      confirmKey,
    );
    expect(confirmed.status(), await confirmed.text()).toBe(202);
    const pending = await responseJSON<{ operation_id: string }>(confirmed);
    expect(pending.operation_id).toBeTruthy();

    // The reserve step never reached its answer, so nothing local changed:
    // every session still sees the old address.
    expect((await myInfo(hub, account.token)).email_address).toBe(
      account.email,
    );
    expect((await myInfo(hub, otherSession)).email_address).toBe(account.email);

    await expectProblem(
      await requestChange(hub, account.token, {
        new_email_address: addressAt(domain),
      }),
      409,
      EmailChangeInProgressError.type,
    );

    // A replay with the same idempotency key reaches the same pending
    // result rather than re-deriving it (GU-ECH-005/007).
    const replay = await confirmChange(
      hub,
      account.token,
      { challenge_id: challenge.challenge_id, code },
      confirmKey,
    );
    expect(replay.status(), await replay.text()).toBe(202);
    expect(await responseJSON<{ operation_id: string }>(replay)).toEqual(
      pending,
    );

    // Logging out and back in touches only the session, never the durable
    // change row, which stays pollable under a fresh session.
    await hub.post("/logout", undefined, { token: account.token });
    const status = await hub.operationStatus(
      { operation_id: pending.operation_id },
      otherSession,
    );
    expect(status.status(), await status.text()).toBe(200);
    expect((await responseJSON<{ state: string }>(status)).state).toBe(Pending);
    expect(
      sqlScalarForTenant(
        "ind1",
        `SELECT count(*)::text FROM vetchium.hub_account_email_changes
         WHERE hub_user_did = ${sqlLiteral(account.hubUserDID)}::uuid;`,
      ),
    ).toBe("1");
  } finally {
    if (account !== undefined) cleanupHubUser(account.email, "ind1");
    cleanupHubUser(newAddress, "ind1");
    cleanupHubIdempotency(keys, "ind1");
    cleanupHubSignupDomain(domain, "ind1");
  }
});
