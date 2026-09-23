import { randomUUID } from "node:crypto";
import { InvalidJSONError } from "typespec/problem/details";
import {
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  seedHubSignupDomain,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { HubAPI, hubIdempotencyKey } from "../lib/hub-api.ts";
import { login, signup } from "../lib/hub-signup.ts";

test("public introduction edits are authenticated, validated, and idempotent", async ({
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const email = `e2e+${randomUUID()}@${domain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    seedHubSignupDomain(domain, "sgp");
    const user = await signup(request, "sgp", email, keys, {
      displayName: "Before Edit",
    });
    const token = await login(request, "sgp", email, user.password);
    const key = hubIdempotencyKey();
    keys.push(key);
    const body = {
      display_name: "After Edit",
      biography: "A short introduction.",
    };
    const saved = await hub.setPublicFields(body, {
      token,
      idempotencyKey: key,
    });
    expect(saved.status(), await saved.text()).toBe(204);
    expect(saved.headers()["cache-control"]).toBe("no-store");

    const replay = await hub.setPublicFields(body, {
      token,
      idempotencyKey: key,
    });
    expect(replay.status()).toBe(204);
    const read = await hub.readProfile({ address: user.handle }, token);
    expect(read.status()).toBe(200);
    expect(await read.json()).toMatchObject(body);

    const invalidKey = hubIdempotencyKey();
    keys.push(invalidKey);
    const invalid = await hub.setPublicFields(
      { display_name: " ", biography: "Should not persist" },
      { token, idempotencyKey: invalidKey },
    );
    expect(invalid.status()).toBe(400);
    const afterInvalid = await hub.readProfile({ address: user.handle }, token);
    expect(await afterInvalid.json()).toMatchObject(body);

    const noSession = await hub.post(
      "/profile/set-public-fields",
      { display_name: "No Session" },
      { idempotencyKey: hubIdempotencyKey() },
    );
    expect(noSession.status()).toBe(401);
    const conflict = await hub.setPublicFields(
      { display_name: "Different Name", biography: null },
      { token, idempotencyKey: key },
    );
    expect(conflict.status()).toBe(409);
  } finally {
    cleanupHubUser(email, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(domain, "sgp");
  }
});

test("public introduction edits reject a malformed body before validation runs", async ({
  request,
}) => {
  const domain = `e2e-${randomUUID()}.example.test`;
  const email = `e2e+${randomUUID()}@${domain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    seedHubSignupDomain(domain, "sgp");
    const user = await signup(request, "sgp", email, keys, {
      displayName: "Malformed Body Owner",
    });
    const token = await login(request, "sgp", email, user.password);
    const key = hubIdempotencyKey();
    keys.push(key);
    const malformed = await hub.postRaw(
      "/profile/set-public-fields",
      "{not json",
      { token, idempotencyKey: key },
    );
    expect(malformed.status()).toBe(400);
    expect((await malformed.json()).type).toBe(InvalidJSONError.type);
  } finally {
    cleanupHubUser(email, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(domain, "sgp");
  }
});
