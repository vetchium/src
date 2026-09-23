import { randomUUID } from "node:crypto";
import { MAX_PICTURE_BYTES, PicturePNG } from "typespec/hub/profile/picture";
import type { PublicProfile } from "typespec/hub/profile/public";
import { IdempotencyKeyConflictError } from "typespec/problem/common";
import { AuthenticationRequiredError } from "typespec/problem/hub/authentication";
import {
  ProfileConflictError,
  ProfilePictureInvalidError,
  ProfilePictureTooLargeError,
} from "typespec/problem/hub/profile";
import { PlanRequiredErrorType } from "typespec/problem/hub/subscriptions";
import {
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  type HeldRowLock,
  holdHubUserRowLock,
  seedHubSignupDomain,
  waitForBlockedBy,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { HubAPI, hubIdempotencyKey } from "../lib/hub-api.ts";
import { login, signup } from "../lib/hub-signup.ts";
import { makePNG } from "../lib/profile-picture-fixture.ts";

async function readProfile(
  hub: HubAPI,
  address: string,
  token: string,
): Promise<PublicProfile> {
  const response = await hub.readProfile({ address }, token);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as PublicProfile;
}

test("a free-tier user cannot upload a profile picture (PROF-PIC-001)", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Free Tier Picture Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    const key = hubIdempotencyKey();
    keys.push(key);
    const upload = await hub.uploadPicture(PicturePNG, makePNG(500, 500), {
      token,
      idempotencyKey: key,
    });
    expect(upload.status(), await upload.text()).toBe(403);
    const body = await upload.json();
    expect(body.type).toBe(PlanRequiredErrorType);
    expect(body.required_plan_oid).toBe("hub-silver-tier");

    const profile = await readProfile(hub, user.handle, token);
    expect(profile.profile_picture_url).toBeUndefined();
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("an upload body larger than 8 MiB is rejected before decoding (PROF-PIC-003)", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Oversized Picture Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    // Not a decodable image: proves the size check runs before any decode
    // attempt, per PROF-PIC-003 and object-storage.md.
    const oversized = Buffer.alloc(MAX_PICTURE_BYTES + 1);
    const key = hubIdempotencyKey();
    keys.push(key);
    const upload = await hub.uploadPicture(PicturePNG, oversized, {
      token,
      idempotencyKey: key,
    });
    expect(upload.status(), await upload.text()).toBe(413);
    expect((await upload.json()).type).toBe(ProfilePictureTooLargeError.type);
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("an image under 400 pixels on a side is rejected (PROF-PIC-004)", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Too Small Picture Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    const tooSmall = makePNG(300, 500); // one side under the 400px minimum
    const key = hubIdempotencyKey();
    keys.push(key);
    const upload = await hub.uploadPicture(PicturePNG, tooSmall, {
      token,
      idempotencyKey: key,
    });
    expect(upload.status(), await upload.text()).toBe(400);
    expect((await upload.json()).type).toBe(ProfilePictureInvalidError.type);

    const profile = await readProfile(hub, user.handle, token);
    expect(profile.profile_picture_url).toBeUndefined();
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("a Silver-tier upload is served through a tenant-signed URL and removal clears it (PROF-PIC-005..008)", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Silver Picture Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    const upgradeKey = hubIdempotencyKey();
    keys.push(upgradeKey);
    const upgraded = await hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "month" },
      { token, idempotencyKey: upgradeKey },
    );
    expect(upgraded.status(), await upgraded.text()).toBe(200);

    const uploadKey = hubIdempotencyKey();
    keys.push(uploadKey);
    const upload = await hub.uploadPicture(PicturePNG, makePNG(500, 500), {
      token,
      idempotencyKey: uploadKey,
    });
    expect(upload.status(), await upload.text()).toBe(204);

    const profile = await readProfile(hub, user.handle, token);
    expect(profile.profile_picture_url).toBeDefined();
    const pictureURL = new URL(profile.profile_picture_url as string);
    // PROF-PIC-006..008: served from the owning tenant's media origin with a
    // short-lived SigV4 query signature, never a bare object identifier.
    expect(pictureURL.host).toBe("media.sgp.localhost");
    expect(pictureURL.searchParams.has("X-Amz-Signature")).toBe(true);

    const removeKey = hubIdempotencyKey();
    keys.push(removeKey);
    const removed = await hub.removePicture({
      token,
      idempotencyKey: removeKey,
    });
    expect(removed.status(), await removed.text()).toBe(204);

    const afterRemoval = await readProfile(hub, user.handle, token);
    expect(afterRemoval.profile_picture_url).toBeUndefined();
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("picture upload and removal require authentication, and a replayed upload key with different image bytes is a conflict", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Picture Mutation Guard",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    // PROF-GEN-002: both operations require an authenticated session.
    const unauthenticatedUpload = await request.post(
      `${hub.origin}/api/hub/profile/picture/upload`,
      {
        data: makePNG(500, 500),
        headers: {
          "Content-Type": PicturePNG,
          "Idempotency-Key": hubIdempotencyKey(),
        },
      },
    );
    expect(unauthenticatedUpload.status()).toBe(401);
    expect((await unauthenticatedUpload.json()).type).toBe(
      AuthenticationRequiredError.type,
    );
    expect(unauthenticatedUpload.headers()["www-authenticate"]).toContain(
      "Bearer",
    );

    const unauthenticatedRemove = await hub.post(
      "/profile/picture/remove",
      {},
      { idempotencyKey: hubIdempotencyKey() },
    );
    expect(unauthenticatedRemove.status()).toBe(401);
    expect((await unauthenticatedRemove.json()).type).toBe(
      AuthenticationRequiredError.type,
    );

    const upgradeKey = hubIdempotencyKey();
    keys.push(upgradeKey);
    const upgraded = await hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "month" },
      { token, idempotencyKey: upgradeKey },
    );
    expect(upgraded.status(), await upgraded.text()).toBe(200);

    // 409 idempotency-key-conflict: the upload digest covers the image
    // bytes, so replaying the same key with a different image conflicts
    // instead of silently applying the second image.
    const reusedKey = hubIdempotencyKey();
    keys.push(reusedKey);
    const firstUpload = await hub.uploadPicture(PicturePNG, makePNG(500, 500), {
      token,
      idempotencyKey: reusedKey,
    });
    expect(firstUpload.status(), await firstUpload.text()).toBe(204);

    const replayWithDifferentImage = await hub.uploadPicture(
      PicturePNG,
      makePNG(600, 600),
      { token, idempotencyKey: reusedKey },
    );
    expect(replayWithDifferentImage.status()).toBe(409);
    expect((await replayWithDifferentImage.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );

    const removeKey = hubIdempotencyKey();
    keys.push(removeKey);
    const removed = await hub.removePicture({
      token,
      idempotencyKey: removeKey,
    });
    expect(removed.status(), await removed.text()).toBe(204);
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("two concurrent uploads race to activate, and the one that loses the race reports a profile conflict", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  let lock: HeldRowLock | undefined;
  let uploadA: ReturnType<HubAPI["uploadPicture"]> | undefined;
  let uploadB: ReturnType<HubAPI["uploadPicture"]> | undefined;
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Racing Picture Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    const upgradeKey = hubIdempotencyKey();
    keys.push(upgradeKey);
    const upgraded = await hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "month" },
      { token, idempotencyKey: upgradeKey },
    );
    expect(upgraded.status(), await upgraded.text()).toBe(200);

    // Prepare, supersede, and activate all take the same hub_users row
    // lock (object-storage.md). Holding it first forces both uploads to
    // queue behind it, so whichever request's staged row commits first is
    // guaranteed to be superseded by the other's supersede step before it
    // reaches activation — deterministically producing one conflict,
    // regardless of which request's bytes finish uploading first.
    lock = await holdHubUserRowLock(user.hubUserDID, "sgp");

    const keyA = hubIdempotencyKey();
    const keyB = hubIdempotencyKey();
    keys.push(keyA, keyB);
    uploadA = hub.uploadPicture(PicturePNG, makePNG(500, 500), {
      token,
      idempotencyKey: keyA,
    });
    uploadB = hub.uploadPicture(PicturePNG, makePNG(500, 500), {
      token,
      idempotencyKey: keyB,
    });
    await waitForBlockedBy("sgp", lock.holderPID, 2);
    await lock.release();
    lock = undefined;

    const [responseA, responseB] = await Promise.all([uploadA, uploadB]);
    uploadA = undefined;
    uploadB = undefined;
    const statuses = [responseA.status(), responseB.status()].sort(
      (a, b) => a - b,
    );
    expect(statuses).toEqual([204, 409]);
    const conflicted = responseA.status() === 409 ? responseA : responseB;
    expect((await conflicted.json()).type).toBe(ProfileConflictError.type);

    const profile = await readProfile(hub, user.handle, token);
    expect(profile.profile_picture_url).toBeDefined();
  } finally {
    if (lock !== undefined) await lock.release();
    await Promise.allSettled([uploadA, uploadB]);
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});
