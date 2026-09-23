import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type {
  ListProfessionalEmailsResponse,
  ProfessionalEmail,
  ProfessionalEmailChallenge,
} from "typespec/hub/profile/professional_email";
import type { PublicProfile } from "typespec/hub/profile/public";
import {
  IdempotencyKeyConflictError,
  InvalidPaginationKeyError,
  RateLimitExceededError,
} from "typespec/problem/common";
import {
  InvalidJSONError,
  ValidationFailedError,
} from "typespec/problem/details";
import { AuthenticationRequiredError } from "typespec/problem/hub/authentication";
import {
  ProfessionalEmailCodeRejectedError,
  ProfileConflictError,
  ProfileNotFoundError,
} from "typespec/problem/hub/profile";
import {
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  seedHubSignupDomain,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { HubAPI, hubIdempotencyKey, MAILPIT_ORIGIN } from "../lib/hub-api.ts";
import { login, signup } from "../lib/hub-signup.ts";

/** A professional domain distinct from the account-signup domain per test. */
function professionalDomain(label: string): string {
  return `${label}-${randomUUID().replaceAll("-", "")}.example.test`;
}

function professionalEmailAt(domain: string): string {
  return `e2e+${randomUUID()}@${domain}`;
}

/**
 * Polls Mailpit for the six-digit code Vetchium sends only after an explicit
 * code request (PROF-WEM-003/004), mirroring the signup-link polling in
 * `hub-signup.ts`.
 */
async function pollProfessionalEmailCode(
  request: APIRequestContext,
  emailAddress: string,
): Promise<string> {
  const mailbox = `${MAILPIT_ORIGIN}/view/latest.txt?query=${encodeURIComponent(
    `to:${emailAddress}`,
  )}`;
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
    .toContain("Your code is");
  const code = text.match(/Your code is (\d{6})/)?.[1];
  expect(code).toBeDefined();
  return code as string;
}

test("adding a professional email is private, domain-unique, and hard-deletes on removal", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const professionalDomainValue = professionalDomain("wem-unique");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Professional Email Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    const firstEmail = professionalEmailAt(professionalDomainValue);
    const addKey = hubIdempotencyKey();
    keys.push(addKey);
    const added = await hub.addProfessionalEmail(
      { email_address: firstEmail },
      { token, idempotencyKey: addKey },
    );
    expect(added.status(), await added.text()).toBe(201);
    const addedBody = (await added.json()) as ProfessionalEmail;
    expect(addedBody.email_address).toBe(firstEmail);
    expect(addedBody.domain).toBe(professionalDomainValue);
    expect(addedBody.first_verified_at).toBeUndefined();
    expect(addedBody.last_verified_at).toBeUndefined();

    // PROF-WEM-002: a second address on the same normalized domain is
    // rejected even though the local part differs.
    const secondEmailSameDomain = professionalEmailAt(professionalDomainValue);
    const duplicateKey = hubIdempotencyKey();
    keys.push(duplicateKey);
    const duplicate = await hub.addProfessionalEmail(
      { email_address: secondEmailSameDomain },
      { token, idempotencyKey: duplicateKey },
    );
    expect(duplicate.status(), await duplicate.text()).toBe(409);
    expect((await duplicate.json()).type).toBe(ProfileConflictError.type);

    const listed = await hub.listProfessionalEmails({}, token);
    expect(listed.status()).toBe(200);
    const listedBody = (await listed.json()) as ListProfessionalEmailsResponse;
    expect(listedBody.emails.map((e) => e.id)).toEqual([addedBody.id]);

    const deleteKey = hubIdempotencyKey();
    keys.push(deleteKey);
    const deleted = await hub.deleteProfessionalEmail(
      { id: addedBody.id },
      { token, idempotencyKey: deleteKey },
    );
    expect(deleted.status(), await deleted.text()).toBe(204);

    const afterDelete = await hub.listProfessionalEmails({}, token);
    expect(
      ((await afterDelete.json()) as ListProfessionalEmailsResponse).emails,
    ).toEqual([]);

    // PROF-GEN-010: the delete is a hard removal, so repeating it finds
    // nothing left to remove.
    const redeleteKey = hubIdempotencyKey();
    keys.push(redeleteKey);
    const redelete = await hub.deleteProfessionalEmail(
      { id: addedBody.id },
      { token, idempotencyKey: redeleteKey },
    );
    expect(redelete.status()).toBe(404);
    expect((await redelete.json()).type).toBe(ProfileNotFoundError.type);
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("a professional-email code is sent only on explicit request, a wrong code is rejected, and repeat requests are rate-limited", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const professionalDomainValue = professionalDomain("wem-code");
  const professionalEmail = professionalEmailAt(professionalDomainValue);
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Code Flow Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    const addKey = hubIdempotencyKey();
    keys.push(addKey);
    const added = await hub.addProfessionalEmail(
      { email_address: professionalEmail },
      { token, idempotencyKey: addKey },
    );
    expect(added.status(), await added.text()).toBe(201);
    const emailID = ((await added.json()) as ProfessionalEmail).id;

    // PROF-WEM-003: adding an address must never itself trigger a message.
    // The delivery worker polls every 250ms in this environment (see
    // config/ci/sgp.json), so waiting several cycles before asserting
    // absence is a deterministic check, not a flaky race.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const beforeRequest = await request.get(
      `${MAILPIT_ORIGIN}/view/latest.txt?query=${encodeURIComponent(
        `to:${professionalEmail}`,
      )}`,
    );
    const beforeRequestText = beforeRequest.ok()
      ? await beforeRequest.text()
      : "";
    expect(beforeRequestText).not.toContain("Your code is");

    const requestKey = hubIdempotencyKey();
    keys.push(requestKey);
    const codeRequest = await hub.requestProfessionalEmailCode(
      { id: emailID },
      { token, idempotencyKey: requestKey },
    );
    expect(codeRequest.status(), await codeRequest.text()).toBe(202);
    const challenge = (await codeRequest.json()) as ProfessionalEmailChallenge;

    const actualCode = await pollProfessionalEmailCode(
      request,
      professionalEmail,
    );
    // Guaranteed to differ from the real code, unlike a fixed guess that
    // could coincidentally match a randomly generated six-digit code.
    const wrongCode = actualCode === "000000" ? "111111" : "000000";

    const wrongVerifyKey = hubIdempotencyKey();
    keys.push(wrongVerifyKey);
    const wrongVerify = await hub.verifyProfessionalEmailCode(
      { id: emailID, challenge_id: challenge.challenge_id, code: wrongCode },
      { token, idempotencyKey: wrongVerifyKey },
    );
    expect(wrongVerify.status(), await wrongVerify.text()).toBe(400);
    expect((await wrongVerify.json()).type).toBe(
      ProfessionalEmailCodeRejectedError.type,
    );

    const stillUnverified = await hub.listProfessionalEmails({}, token);
    const stillUnverifiedBody =
      (await stillUnverified.json()) as ListProfessionalEmailsResponse;
    expect(stillUnverifiedBody.emails[0]?.first_verified_at).toBeUndefined();

    // PROF-WEM-006: a second code request inside 60 seconds is rejected.
    const secondRequestKey = hubIdempotencyKey();
    keys.push(secondRequestKey);
    const secondRequest = await hub.requestProfessionalEmailCode(
      { id: emailID },
      { token, idempotencyKey: secondRequestKey },
    );
    expect(secondRequest.status(), await secondRequest.text()).toBe(429);
    expect((await secondRequest.json()).type).toBe(RateLimitExceededError.type);
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("the private professional-email list orders verified addresses before pending ones (PROF-WEM-013)", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Ordering Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    async function addOnly(label: string): Promise<ProfessionalEmail> {
      const email = professionalEmailAt(professionalDomain(label));
      const key = hubIdempotencyKey();
      keys.push(key);
      const response = await hub.addProfessionalEmail(
        { email_address: email },
        { token, idempotencyKey: key },
      );
      expect(response.status(), await response.text()).toBe(201);
      return (await response.json()) as ProfessionalEmail;
    }

    async function addAndVerify(label: string): Promise<ProfessionalEmail> {
      const added = await addOnly(label);
      const requestKey = hubIdempotencyKey();
      keys.push(requestKey);
      const codeRequest = await hub.requestProfessionalEmailCode(
        { id: added.id },
        { token, idempotencyKey: requestKey },
      );
      expect(codeRequest.status(), await codeRequest.text()).toBe(202);
      const challenge =
        (await codeRequest.json()) as ProfessionalEmailChallenge;
      const code = await pollProfessionalEmailCode(
        request,
        added.email_address,
      );
      const verifyKey = hubIdempotencyKey();
      keys.push(verifyKey);
      const verified = await hub.verifyProfessionalEmailCode(
        { id: added.id, challenge_id: challenge.challenge_id, code },
        { token, idempotencyKey: verifyKey },
      );
      expect(verified.status(), await verified.text()).toBe(204);
      return added;
    }

    const pendingOlder = await addOnly("wem-order-p1");
    const pendingNewer = await addOnly("wem-order-p2");
    const verifiedOlder = await addAndVerify("wem-order-v1");
    const verifiedNewer = await addAndVerify("wem-order-v2");

    const listed = await hub.listProfessionalEmails({}, token);
    expect(listed.status()).toBe(200);
    const body = (await listed.json()) as ListProfessionalEmailsResponse;
    expect(body.emails.map((e) => e.id)).toEqual([
      verifiedNewer.id,
      verifiedOlder.id,
      pendingNewer.id,
      pendingOlder.id,
    ]);
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("another Hub user's profile view never exposes a professional email address, domain, or verification evidence", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const ownerEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const viewerEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const professionalDomainValue = professionalDomain("wem-privacy");
  const professionalEmail = professionalEmailAt(professionalDomainValue);
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const owner = await signup(request, "sgp", ownerEmail, keys, {
      displayName: "Privacy Owner",
    });
    const ownerToken = await login(request, "sgp", ownerEmail, owner.password);
    const viewer = await signup(request, "sgp", viewerEmail, keys, {
      displayName: "Privacy Viewer",
    });
    const viewerToken = await login(
      request,
      "sgp",
      viewerEmail,
      viewer.password,
    );

    const addKey = hubIdempotencyKey();
    keys.push(addKey);
    const added = await hub.addProfessionalEmail(
      { email_address: professionalEmail },
      { token: ownerToken, idempotencyKey: addKey },
    );
    expect(added.status(), await added.text()).toBe(201);
    const emailID = ((await added.json()) as ProfessionalEmail).id;

    const requestKey = hubIdempotencyKey();
    keys.push(requestKey);
    const codeRequest = await hub.requestProfessionalEmailCode(
      { id: emailID },
      { token: ownerToken, idempotencyKey: requestKey },
    );
    expect(codeRequest.status(), await codeRequest.text()).toBe(202);
    const challenge = (await codeRequest.json()) as ProfessionalEmailChallenge;
    const code = await pollProfessionalEmailCode(request, professionalEmail);
    const verifyKey = hubIdempotencyKey();
    keys.push(verifyKey);
    const verified = await hub.verifyProfessionalEmailCode(
      { id: emailID, challenge_id: challenge.challenge_id, code },
      { token: ownerToken, idempotencyKey: verifyKey },
    );
    expect(verified.status(), await verified.text()).toBe(204);

    const read = await hub.readProfile({ address: owner.handle }, viewerToken);
    expect(read.status(), await read.text()).toBe(200);
    const profile = (await read.json()) as PublicProfile;
    const profileText = JSON.stringify(profile);
    expect(profile.handle).toBe(owner.handle);
    expect(profileText).not.toContain(professionalEmail);
    expect(profileText).not.toContain(professionalDomainValue);
    expect(profileText).not.toContain("professional_email");
    expect(profileText).not.toContain("first_verified_at");
    expect(profileText).not.toContain("last_verified_at");
  } finally {
    cleanupHubUser(viewerEmail, "sgp");
    cleanupHubUser(ownerEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("professional email list, add, and delete require authentication, validate their input, and reject a replayed idempotency key with a different request", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Professional Email Mutation Guard",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    // PROF-GEN-002: every operation requires an authenticated session.
    const unauthenticatedList = await hub.post(
      "/profile/professional-email/list",
      {},
    );
    expect(unauthenticatedList.status()).toBe(401);
    expect((await unauthenticatedList.json()).type).toBe(
      AuthenticationRequiredError.type,
    );

    const unauthenticatedAdd = await hub.post(
      "/profile/professional-email/add",
      {
        email_address: professionalEmailAt(professionalDomain("wem-guard-add")),
      },
      { idempotencyKey: hubIdempotencyKey() },
    );
    expect(unauthenticatedAdd.status()).toBe(401);

    const unauthenticatedDelete = await hub.post(
      "/profile/professional-email/delete",
      { id: randomUUID() },
      { idempotencyKey: hubIdempotencyKey() },
    );
    expect(unauthenticatedDelete.status()).toBe(401);

    // 400 validation-failed: list rejects an out-of-range page size.
    const invalidList = await hub.listProfessionalEmails({ limit: 0 }, token);
    expect(invalidList.status()).toBe(400);
    const invalidListBody = await invalidList.json();
    expect(invalidListBody.type).toBe(ValidationFailedError.type);
    expect(invalidListBody.fields).toContain("limit");

    // 400 invalid-json: list, add, and delete all reject a malformed body
    // before validation runs.
    const malformedListKey = hubIdempotencyKey();
    keys.push(malformedListKey);
    const malformedList = await hub.postRaw(
      "/profile/professional-email/list",
      "{not json",
      { token },
    );
    expect(malformedList.status()).toBe(400);
    expect((await malformedList.json()).type).toBe(InvalidJSONError.type);

    // 400 invalid-pagination-key: list rejects an undecodable cursor.
    const invalidPaginationKey = await hub.listProfessionalEmails(
      { pagination_key: "not-a-cursor" },
      token,
    );
    expect(invalidPaginationKey.status()).toBe(400);
    expect((await invalidPaginationKey.json()).type).toBe(
      InvalidPaginationKeyError.type,
    );

    const malformedAddKey = hubIdempotencyKey();
    keys.push(malformedAddKey);
    const malformedAdd = await hub.postRaw(
      "/profile/professional-email/add",
      "{not json",
      { token, idempotencyKey: malformedAddKey },
    );
    expect(malformedAdd.status()).toBe(400);
    expect((await malformedAdd.json()).type).toBe(InvalidJSONError.type);

    const malformedDeleteKey = hubIdempotencyKey();
    keys.push(malformedDeleteKey);
    const malformedDelete = await hub.postRaw(
      "/profile/professional-email/delete",
      "{not json",
      { token, idempotencyKey: malformedDeleteKey },
    );
    expect(malformedDelete.status()).toBe(400);
    expect((await malformedDelete.json()).type).toBe(InvalidJSONError.type);

    // 400 validation-failed: add rejects a malformed address.
    const invalidAddKey = hubIdempotencyKey();
    keys.push(invalidAddKey);
    const invalidAdd = await hub.addProfessionalEmail(
      { email_address: "not-an-email" },
      { token, idempotencyKey: invalidAddKey },
    );
    expect(invalidAdd.status()).toBe(400);
    const invalidAddBody = await invalidAdd.json();
    expect(invalidAddBody.type).toBe(ValidationFailedError.type);
    expect(invalidAddBody.fields).toContain("email_address");

    // 400 validation-failed: delete rejects a malformed id.
    const invalidDeleteKey = hubIdempotencyKey();
    keys.push(invalidDeleteKey);
    const invalidDelete = await hub.deleteProfessionalEmail(
      { id: "not-a-uuid" },
      { token, idempotencyKey: invalidDeleteKey },
    );
    expect(invalidDelete.status()).toBe(400);
    expect((await invalidDelete.json()).fields).toContain("id");

    // 409 idempotency-key-conflict: replaying add with a different address.
    const reusedAddKey = hubIdempotencyKey();
    keys.push(reusedAddKey);
    const firstAdd = await hub.addProfessionalEmail(
      { email_address: professionalEmailAt(professionalDomain("wem-guard-a")) },
      { token, idempotencyKey: reusedAddKey },
    );
    expect(firstAdd.status(), await firstAdd.text()).toBe(201);
    const firstAddID = ((await firstAdd.json()) as ProfessionalEmail).id;
    const conflictingAdd = await hub.addProfessionalEmail(
      { email_address: professionalEmailAt(professionalDomain("wem-guard-b")) },
      { token, idempotencyKey: reusedAddKey },
    );
    expect(conflictingAdd.status()).toBe(409);
    expect((await conflictingAdd.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );

    // 409 idempotency-key-conflict: replaying delete against a different id.
    const secondAddKey = hubIdempotencyKey();
    keys.push(secondAddKey);
    const secondAdd = await hub.addProfessionalEmail(
      { email_address: professionalEmailAt(professionalDomain("wem-guard-c")) },
      { token, idempotencyKey: secondAddKey },
    );
    expect(secondAdd.status(), await secondAdd.text()).toBe(201);
    const secondAddID = ((await secondAdd.json()) as ProfessionalEmail).id;
    const reusedDeleteKey = hubIdempotencyKey();
    keys.push(reusedDeleteKey);
    const firstDelete = await hub.deleteProfessionalEmail(
      { id: firstAddID },
      { token, idempotencyKey: reusedDeleteKey },
    );
    expect(firstDelete.status(), await firstDelete.text()).toBe(204);
    const conflictingDelete = await hub.deleteProfessionalEmail(
      { id: secondAddID },
      { token, idempotencyKey: reusedDeleteKey },
    );
    expect(conflictingDelete.status()).toBe(409);
    expect((await conflictingDelete.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );

    const cleanupDeleteKey = hubIdempotencyKey();
    keys.push(cleanupDeleteKey);
    const cleanupDelete = await hub.deleteProfessionalEmail(
      { id: secondAddID },
      { token, idempotencyKey: cleanupDeleteKey },
    );
    expect(cleanupDelete.status(), await cleanupDelete.text()).toBe(204);
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("professional email code requests and verification require authentication, validate input, reject unknown ids, and reject a replayed idempotency key", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const professionalDomainValue = professionalDomain("wem-code-guard");
  const professionalEmail = professionalEmailAt(professionalDomainValue);
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Code Guard Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    // PROF-GEN-002: both operations require an authenticated session.
    const unauthenticatedRequest = await hub.post(
      "/profile/professional-email/request-code",
      { id: randomUUID() },
      { idempotencyKey: hubIdempotencyKey() },
    );
    expect(unauthenticatedRequest.status()).toBe(401);

    const unauthenticatedVerify = await hub.post(
      "/profile/professional-email/verify",
      { id: randomUUID(), challenge_id: randomUUID(), code: "123456" },
      { idempotencyKey: hubIdempotencyKey() },
    );
    expect(unauthenticatedVerify.status()).toBe(401);

    // 400 validation-failed: a malformed id fails before any lookup.
    const invalidRequestKey = hubIdempotencyKey();
    keys.push(invalidRequestKey);
    const invalidRequest = await hub.requestProfessionalEmailCode(
      { id: "not-a-uuid" },
      { token, idempotencyKey: invalidRequestKey },
    );
    expect(invalidRequest.status()).toBe(400);
    expect((await invalidRequest.json()).fields).toContain("id");

    // 400 invalid-json: a malformed body is rejected before validation, for
    // both the code request and the verify endpoint.
    const malformedRequestKey = hubIdempotencyKey();
    keys.push(malformedRequestKey);
    const malformedRequest = await hub.postRaw(
      "/profile/professional-email/request-code",
      "{not json",
      { token, idempotencyKey: malformedRequestKey },
    );
    expect(malformedRequest.status()).toBe(400);
    expect((await malformedRequest.json()).type).toBe(InvalidJSONError.type);

    // 400 invalid-json: a malformed body is rejected before validation.
    const malformedVerifyKey = hubIdempotencyKey();
    keys.push(malformedVerifyKey);
    const malformedVerify = await hub.postRaw(
      "/profile/professional-email/verify",
      "{not json",
      { token, idempotencyKey: malformedVerifyKey },
    );
    expect(malformedVerify.status()).toBe(400);
    expect((await malformedVerify.json()).type).toBe(InvalidJSONError.type);

    // 400 validation-failed: a malformed code fails before any lookup.
    const invalidVerifyKey = hubIdempotencyKey();
    keys.push(invalidVerifyKey);
    const invalidVerify = await hub.verifyProfessionalEmailCode(
      { id: randomUUID(), challenge_id: randomUUID(), code: "abc" },
      { token, idempotencyKey: invalidVerifyKey },
    );
    expect(invalidVerify.status()).toBe(400);
    const invalidVerifyBody = await invalidVerify.json();
    expect(invalidVerifyBody.type).toBe(ValidationFailedError.type);
    expect(invalidVerifyBody.fields).toContain("code");

    // 404: an id that does not belong to the caller cannot be actioned.
    const foreignRequestKey = hubIdempotencyKey();
    keys.push(foreignRequestKey);
    const foreignRequest = await hub.requestProfessionalEmailCode(
      { id: randomUUID() },
      { token, idempotencyKey: foreignRequestKey },
    );
    expect(foreignRequest.status()).toBe(404);
    expect((await foreignRequest.json()).type).toBe(ProfileNotFoundError.type);

    const foreignVerifyKey = hubIdempotencyKey();
    keys.push(foreignVerifyKey);
    const foreignVerify = await hub.verifyProfessionalEmailCode(
      { id: randomUUID(), challenge_id: randomUUID(), code: "123456" },
      { token, idempotencyKey: foreignVerifyKey },
    );
    expect(foreignVerify.status()).toBe(404);
    expect((await foreignVerify.json()).type).toBe(ProfileNotFoundError.type);

    // Set up a real, owned email to reach the idempotency-conflict paths.
    const addKey = hubIdempotencyKey();
    keys.push(addKey);
    const added = await hub.addProfessionalEmail(
      { email_address: professionalEmail },
      { token, idempotencyKey: addKey },
    );
    expect(added.status(), await added.text()).toBe(201);
    const emailID = ((await added.json()) as ProfessionalEmail).id;

    const secondAddKey = hubIdempotencyKey();
    keys.push(secondAddKey);
    const secondEmail = professionalEmailAt(
      professionalDomain("wem-code-guard-2"),
    );
    const secondAdded = await hub.addProfessionalEmail(
      { email_address: secondEmail },
      { token, idempotencyKey: secondAddKey },
    );
    expect(secondAdded.status(), await secondAdded.text()).toBe(201);
    const secondEmailID = ((await secondAdded.json()) as ProfessionalEmail).id;

    // 409 idempotency-key-conflict: replaying request-code for another id.
    const reusedRequestKey = hubIdempotencyKey();
    keys.push(reusedRequestKey);
    const firstRequest = await hub.requestProfessionalEmailCode(
      { id: emailID },
      { token, idempotencyKey: reusedRequestKey },
    );
    expect(firstRequest.status(), await firstRequest.text()).toBe(202);
    const conflictingRequest = await hub.requestProfessionalEmailCode(
      { id: secondEmailID },
      { token, idempotencyKey: reusedRequestKey },
    );
    expect(conflictingRequest.status()).toBe(409);
    expect((await conflictingRequest.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );

    const challenge = (await firstRequest.json()) as ProfessionalEmailChallenge;
    const code = await pollProfessionalEmailCode(request, professionalEmail);

    // 409 idempotency-key-conflict: replaying verify with a different code.
    const reusedVerifyKey = hubIdempotencyKey();
    keys.push(reusedVerifyKey);
    const wrongDigitCode = code === "000000" ? "111111" : "000000";
    const firstVerify = await hub.verifyProfessionalEmailCode(
      {
        id: emailID,
        challenge_id: challenge.challenge_id,
        code: wrongDigitCode,
      },
      { token, idempotencyKey: reusedVerifyKey },
    );
    expect(firstVerify.status(), await firstVerify.text()).toBe(400);
    const conflictingVerify = await hub.verifyProfessionalEmailCode(
      { id: emailID, challenge_id: challenge.challenge_id, code },
      { token, idempotencyKey: reusedVerifyKey },
    );
    expect(conflictingVerify.status()).toBe(409);
    expect((await conflictingVerify.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});
