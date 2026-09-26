import { randomUUID } from "node:crypto";
import type { PublicProfile, Website } from "typespec/hub/profile/public";
import { MaxWebsites } from "typespec/hub/profile/public";
import { IdempotencyKeyConflictError } from "typespec/problem/common";
import {
  InvalidJSONError,
  ValidationFailedError,
} from "typespec/problem/details";
import { AuthenticationRequiredError } from "typespec/problem/hub/authentication";
import { ProfileConflictError } from "typespec/problem/hub/profile";
import {
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  seedHubSignupDomain,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { HubAPI, hubIdempotencyKey } from "../lib/hub-api.ts";
import { login, signup } from "../lib/hub-signup.ts";

async function readWebsites(
  hub: HubAPI,
  address: string,
  token: string,
): Promise<Website[]> {
  const response = await hub.readProfile({ address }, token);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as PublicProfile).websites;
}

test("websites round-trip, list oldest-added first, and are stored normalized", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const label = randomUUID().replaceAll("-", "");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Website Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    // A new profile has an empty list, not a missing one.
    expect(await readWebsites(hub, user.handle, token)).toEqual([]);

    async function create(url: string) {
      const key = hubIdempotencyKey();
      keys.push(key);
      return hub.saveWebsite({ url }, { token, idempotencyKey: key });
    }

    const first = `https://github.com/first-${label}`;
    const second = `https://www.linkedin.com/in/second-${label}`;
    // PROF-WEB-003: scheme and host lowercased, one trailing slash dropped,
    // path case kept.
    const messy = `  HTTPS://Site-${label}.Example.Test/Path/  `;
    const third = `https://site-${label}.example.test/Path`;
    for (const url of [first, second, messy]) {
      const created = await create(url);
      expect(created.status(), await created.text()).toBe(204);
      expect(created.headers()["cache-control"]).toBe("no-store");
    }

    let websites = await readWebsites(hub, user.handle, token);
    // PROF-WEB-005: oldest-created first.
    expect(websites.map((w) => w.url)).toEqual([first, second, third]);
    for (const website of websites) {
      expect(website.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(Object.keys(website).sort()).toEqual(["id", "url"]);
    }

    // Updating keeps the entry's place in the list.
    const middle = websites[1] as Website;
    const changed = `https://www.linkedin.com/in/renamed-${label}`;
    const updateKey = hubIdempotencyKey();
    keys.push(updateKey);
    const updated = await hub.saveWebsite(
      { id: middle.id, url: changed },
      { token, idempotencyKey: updateKey },
    );
    expect(updated.status(), await updated.text()).toBe(204);
    websites = await readWebsites(hub, user.handle, token);
    expect(websites.map((w) => w.url)).toEqual([first, changed, third]);
    expect(websites[1]?.id).toBe(middle.id);

    const deleteKey = hubIdempotencyKey();
    keys.push(deleteKey);
    const deleted = await hub.deleteWebsite(
      { id: middle.id },
      { token, idempotencyKey: deleteKey },
    );
    expect(deleted.status(), await deleted.text()).toBe(204);
    expect(deleted.headers()["cache-control"]).toBe("no-store");
    websites = await readWebsites(hub, user.handle, token);
    expect(websites.map((w) => w.url)).toEqual([first, third]);
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("another Hub user sees a profile's websites but cannot change them", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const ownerEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const viewerEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const label = randomUUID().replaceAll("-", "");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const owner = await signup(request, "sgp", ownerEmail, keys, {
      displayName: "Website Owner",
    });
    const viewer = await signup(request, "sgp", viewerEmail, keys, {
      displayName: "Website Viewer",
    });
    const ownerToken = await login(request, "sgp", ownerEmail, owner.password);
    const viewerToken = await login(
      request,
      "sgp",
      viewerEmail,
      viewer.password,
    );

    const url = `https://owner-${label}.example.test/about`;
    const createKey = hubIdempotencyKey();
    keys.push(createKey);
    const created = await hub.saveWebsite(
      { url },
      { token: ownerToken, idempotencyKey: createKey },
    );
    expect(created.status(), await created.text()).toBe(204);

    // PROF-WEB-001: websites are public profile fields.
    const seen = await readWebsites(hub, owner.handle, viewerToken);
    expect(seen.map((w) => w.url)).toEqual([url]);
    const entry = seen[0] as Website;

    // PROF-GEN-003: only the owner may change them. The viewer's write names
    // an entry that is not theirs, which is a conflict, and nothing changes.
    const foreignSaveKey = hubIdempotencyKey();
    keys.push(foreignSaveKey);
    const foreignSave = await hub.saveWebsite(
      { id: entry.id, url: `https://stolen-${label}.example.test` },
      { token: viewerToken, idempotencyKey: foreignSaveKey },
    );
    expect(foreignSave.status()).toBe(409);
    expect((await foreignSave.json()).type).toBe(ProfileConflictError.type);
    const foreignDeleteKey = hubIdempotencyKey();
    keys.push(foreignDeleteKey);
    const foreignDelete = await hub.deleteWebsite(
      { id: entry.id },
      { token: viewerToken, idempotencyKey: foreignDeleteKey },
    );
    expect(foreignDelete.status()).toBe(409);
    expect((await foreignDelete.json()).type).toBe(ProfileConflictError.type);
    expect(
      (await readWebsites(hub, owner.handle, ownerToken)).map((w) => w.url),
    ).toEqual([url]);
    expect(await readWebsites(hub, viewer.handle, viewerToken)).toEqual([]);
  } finally {
    cleanupHubUser(ownerEmail, "sgp");
    cleanupHubUser(viewerEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("invalid website URLs and ids are rejected, naming the field, and change nothing", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const label = randomUUID().replaceAll("-", "");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Website Validation Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    async function save(body: unknown) {
      const key = hubIdempotencyKey();
      keys.push(key);
      return hub.post("/profile/save-website", body, {
        token,
        idempotencyKey: key,
      });
    }

    // PROF-WEB-002: HTTPS only, a real host name, no credentials, no
    // fragment, ASCII only, and at most 2,048 characters.
    for (const url of [
      "",
      "   ",
      "not a url",
      `github.com/${label}`,
      `http://example-${label}.test/plain`,
      `ftp://example-${label}.test/file`,
      `javascript:alert("${label}")`,
      "https://",
      "https://localhost",
      "https://127.0.0.1/admin",
      "https://10.0.0.1:8443",
      `https://user:pass@example-${label}.test/`,
      `https://user@example-${label}.test/`,
      `https://example-${label}.test/page#section`,
      `https://example-${label}.test?tracking=${label}`,
      `https://-bad-${label}.test/`,
      `https://example..${label}.test/`,
      `https://exa mple-${label}.test/`,
      `https://example-${label}.test/ü`,
      "https://münchen.example.test/",
      `https://example-${label}.test:123456/`,
      `https://example-${label}.test/${"a".repeat(2048)}`,
    ]) {
      const response = await save({ url });
      expect(response.status(), url).toBe(400);
      expect((await response.json()).type, url).toBe(
        ValidationFailedError.type,
      );
      expect((await response.json()).fields, url).toContain("url");
    }

    // A missing url is a validation failure too, not a server error.
    const missing = await save({});
    expect(missing.status()).toBe(400);
    expect((await missing.json()).fields).toContain("url");

    // A malformed entry id fails validation before any lookup, alongside a
    // bad URL in the same request.
    const badID = await save({ id: "not-a-uuid", url: "http://insecure.test" });
    expect(badID.status()).toBe(400);
    expect((await badID.json()).fields).toEqual(["id", "url"]);
    const badDeleteKey = hubIdempotencyKey();
    keys.push(badDeleteKey);
    const badDelete = await hub.deleteWebsite(
      { id: "not-a-uuid" },
      { token, idempotencyKey: badDeleteKey },
    );
    expect(badDelete.status()).toBe(400);
    expect((await badDelete.json()).type).toBe(ValidationFailedError.type);
    expect((await badDelete.json()).fields).toEqual(["id"]);

    // The boundary is inclusive: exactly 2,048 characters is accepted.
    const prefix = `https://example-${label}.test/`;
    const longest = `${prefix}${"a".repeat(2048 - prefix.length)}`;
    expect(longest).toHaveLength(2048);
    const accepted = await save({ url: longest });
    expect(accepted.status(), await accepted.text()).toBe(204);

    expect(
      (await readWebsites(hub, user.handle, token)).map((w) => w.url),
    ).toEqual([longest]);
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("website writes require authentication, valid JSON, and a consistent idempotency key", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const label = randomUUID().replaceAll("-", "");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Website Guard Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    // 401: every website write needs a session.
    for (const [path, body] of [
      ["/profile/save-website", { url: `https://guard-${label}.example.test` }],
      ["/profile/delete-website", { id: randomUUID() }],
    ] as const) {
      const unauthenticated = await hub.post(path, body, {
        idempotencyKey: hubIdempotencyKey(),
      });
      expect(unauthenticated.status(), path).toBe(401);
      expect((await unauthenticated.json()).type).toBe(
        AuthenticationRequiredError.type,
      );
      expect(unauthenticated.headers()["www-authenticate"]).toContain("Bearer");
    }

    // 400 invalid-json: rejected before validation runs.
    for (const path of [
      "/profile/save-website",
      "/profile/delete-website",
    ] as const) {
      const key = hubIdempotencyKey();
      keys.push(key);
      const malformed = await hub.postRaw(path, "{not json", {
        token,
        idempotencyKey: key,
      });
      expect(malformed.status(), path).toBe(400);
      expect((await malformed.json()).type, path).toBe(InvalidJSONError.type);
    }

    // Replaying a save with the same key and body succeeds and adds nothing.
    const url = `https://replay-${label}.example.test`;
    const replayKey = hubIdempotencyKey();
    keys.push(replayKey);
    const options = { token, idempotencyKey: replayKey };
    const firstSave = await hub.saveWebsite({ url }, options);
    expect(firstSave.status(), await firstSave.text()).toBe(204);
    const replayedSave = await hub.saveWebsite({ url }, options);
    expect(replayedSave.status(), await replayedSave.text()).toBe(204);
    expect(
      (await readWebsites(hub, user.handle, token)).map((w) => w.url),
    ).toEqual([url]);

    // 409 idempotency-key-conflict: the same key with a different body.
    const conflictingSave = await hub.saveWebsite(
      { url: `https://changed-${label}.example.test` },
      options,
    );
    expect(conflictingSave.status()).toBe(409);
    expect((await conflictingSave.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );

    const entry = (await readWebsites(hub, user.handle, token))[0] as Website;
    const deleteKey = hubIdempotencyKey();
    keys.push(deleteKey);
    const firstDelete = await hub.deleteWebsite(
      { id: entry.id },
      { token, idempotencyKey: deleteKey },
    );
    expect(firstDelete.status(), await firstDelete.text()).toBe(204);
    const replayedDelete = await hub.deleteWebsite(
      { id: entry.id },
      { token, idempotencyKey: deleteKey },
    );
    expect(replayedDelete.status(), await replayedDelete.text()).toBe(204);
    const conflictingDelete = await hub.deleteWebsite(
      { id: randomUUID() },
      { token, idempotencyKey: deleteKey },
    );
    expect(conflictingDelete.status()).toBe(409);
    expect((await conflictingDelete.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("duplicate websites, unknown entries, and an eleventh website are profile conflicts", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const label = randomUUID().replaceAll("-", "");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Website Limit Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    async function save(body: { id?: string; url: string }) {
      const key = hubIdempotencyKey();
      keys.push(key);
      return hub.saveWebsite(body, { token, idempotencyKey: key });
    }
    async function expectConflict(
      response: Awaited<ReturnType<typeof save>>,
      why: string,
    ) {
      expect(response.status(), why).toBe(409);
      expect((await response.json()).type, why).toBe(ProfileConflictError.type);
    }
    const urls = async () =>
      (await readWebsites(hub, user.handle, token)).map((w) => w.url);

    const original = `https://dup-${label}.example.test/me`;
    expect((await save({ url: original })).status()).toBe(204);

    // PROF-WEB-004: the same normalized URL cannot be listed twice, however
    // it is spelled.
    await expectConflict(await save({ url: original }), "exact duplicate");
    await expectConflict(
      await save({ url: `HTTPS://DUP-${label}.Example.TEST/me/` }),
      "duplicate after normalization",
    );
    // The path is significant, so a different path is a different website.
    expect(
      (
        await save({ url: `https://dup-${label}.example.test/me/other` })
      ).status(),
    ).toBe(204);

    const before = await readWebsites(hub, user.handle, token);
    expect(before.map((w) => w.url)).toEqual([
      original,
      `https://dup-${label}.example.test/me/other`,
    ]);
    const [firstEntry, secondEntry] = before as [Website, Website];

    // An update cannot move an entry onto a URL the owner already lists, but
    // saving an entry with its own URL is fine.
    await expectConflict(
      await save({ id: secondEntry.id, url: original }),
      "update onto a listed URL",
    );
    expect(
      (await save({ id: firstEntry.id, url: original })).status(),
      "update to its own URL",
    ).toBe(204);
    expect(await urls()).toEqual(before.map((w) => w.url));

    // An id that names no entry of the owner is a conflict, for save and
    // delete, rather than a silent no-op.
    const unknownID = randomUUID();
    await expectConflict(
      await save({
        id: unknownID,
        url: `https://unknown-${label}.example.test`,
      }),
      "save of an unknown entry",
    );
    const unknownDeleteKey = hubIdempotencyKey();
    keys.push(unknownDeleteKey);
    await expectConflict(
      await hub.deleteWebsite(
        { id: unknownID },
        { token, idempotencyKey: unknownDeleteKey },
      ),
      "delete of an unknown entry",
    );

    // PROF-WEB-004: at most ten websites.
    for (let i = 2; i < MaxWebsites; i++) {
      const created = await save({
        url: `https://fill-${i}-${label}.example.test`,
      });
      expect(created.status(), `website ${i + 1}`).toBe(204);
    }
    expect(await urls()).toHaveLength(MaxWebsites);
    await expectConflict(
      await save({ url: `https://eleventh-${label}.example.test` }),
      "eleventh website",
    );
    expect(await urls()).toHaveLength(MaxWebsites);

    // Updating at the limit is allowed, and deleting frees a slot.
    expect(
      (
        await save({
          id: secondEntry.id,
          url: `https://moved-${label}.example.test`,
        })
      ).status(),
    ).toBe(204);
    const freeKey = hubIdempotencyKey();
    keys.push(freeKey);
    const freed = await hub.deleteWebsite(
      { id: firstEntry.id },
      { token, idempotencyKey: freeKey },
    );
    expect(freed.status(), await freed.text()).toBe(204);
    expect(
      (await save({ url: `https://eleventh-${label}.example.test` })).status(),
    ).toBe(204);
    expect(await urls()).toHaveLength(MaxWebsites);
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});
