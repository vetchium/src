import type { Page } from "@playwright/test";
import { expectProblem } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import { makeJPEG128, makePNG, withTextChunk } from "../lib/logo-fixtures.ts";
import {
  addOrgMember,
  cleanupOrg,
  inviteeAddress,
  loginOrg,
  OrgsAPI,
  orgInfo,
  orgSQL,
  orgsIdempotencyKey,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";

const authenticationRequired =
  "vetchium-problem-details/org-authentication-required";
const permissionRequired = "vetchium-problem-details/org-permission-required";
const orgSuspended = "vetchium-problem-details/org-suspended";
const planRequired = "vetchium-problem-details/org-plan-required";
const logoInvalid = "vetchium-problem-details/org-logo-invalid";
const logoTooLarge = "vetchium-problem-details/org-logo-too-large";
const keyConflict = "vetchium-problem-details/idempotency-key-conflict";
const validationFailed = "vetchium-problem-details/validation-failed";

async function withOrg(
  request: Page["request"],
  body: (api: OrgsAPI, org: SignedUpOrg, owner: string) => Promise<void>,
): Promise<void> {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    await body(api, org, await loginOrg(api, org));
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
}

async function onSilver(api: OrgsAPI, owner: string): Promise<void> {
  expect(
    (
      await api.setSubscriptionPlan(owner, {
        plan_oid: "org-silver-tier",
        billing_interval: "month",
      })
    ).status(),
  ).toBe(200);
}

function logoRows(org: SignedUpOrg, state: string): number {
  return Number(
    orgSQL(
      `SELECT count(*) FROM vetchium.org_logo_objects
       WHERE state = '${state}'
         AND org_did = (SELECT org_did FROM vetchium.org_domains
                        WHERE domain = '${org.domain}')`,
    ),
  );
}

async function logoURL(api: OrgsAPI, owner: string) {
  return (await orgInfo(api, owner)).logo_url;
}

test.describe("logo upload", () => {
  test("is refused on the Free plan and nothing is stored", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      const response = await api.uploadLogo(
        owner,
        "image/png",
        makePNG(200, 200),
      );
      await expectProblem(response, 403, planRequired);
      expect((await response.json()).plan_oid).toBe("org-silver-tier");
      expect(logoRows(org, "uploading") + logoRows(org, "active")).toBe(0);
      expect(await logoURL(api, owner)).toBeUndefined();
    });
  });

  test("stores a PNG on Silver and serves it from a signed URL", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await onSilver(api, owner);
      const key = orgsIdempotencyKey();
      const response = await api.uploadLogo(
        owner,
        "image/png",
        makePNG(200, 200),
        key,
      );
      expect(response.status(), await response.text()).toBe(204);
      expect(response.headers()["cache-control"]).toBe("no-store");

      const url = await logoURL(api, owner);
      expect(url).toBeDefined();
      const image = await fetch(url ?? "");
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toBe("image/png");
      const bytes = Buffer.from(await image.arrayBuffer());
      expect(bytes.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(logoRows(org, "active")).toBe(1);

      // The same key and body replays without storing a second object.
      const replay = await api.uploadLogo(
        owner,
        "image/png",
        makePNG(200, 200),
        key,
      );
      expect(replay.status()).toBe(204);
      expect(logoRows(org, "active")).toBe(1);
      await expectProblem(
        await api.uploadLogo(owner, "image/png", makePNG(201, 200), key),
        409,
        keyConflict,
      );
    });
  });

  test("stores a JPEG and replaces it, retiring the old object", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await onSilver(api, owner);
      expect(
        (await api.uploadLogo(owner, "image/jpeg", makeJPEG128())).status(),
      ).toBe(204);
      const first = await logoURL(api, owner);
      expect(first).toBeDefined();
      expect(
        (await api.uploadLogo(owner, "image/png", makePNG(300, 300))).status(),
      ).toBe(204);
      const second = await logoURL(api, owner);
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
      expect(logoRows(org, "active")).toBe(1);
      expect(logoRows(org, "pending_delete")).toBe(1);
      const current = await fetch(second ?? "");
      expect(current.headers.get("content-type")).toBe("image/png");
    });
  });

  test("rejects images outside the limits", async ({ request }) => {
    await withOrg(request, async (api, org, owner) => {
      await onSilver(api, owner);
      for (const [contentType, body] of [
        ["image/png", makePNG(127, 200)],
        ["image/png", makePNG(200, 127)],
        ["image/png", makePNG(4097, 128)],
        ["image/png", Buffer.from("not an image")],
        ["image/jpeg", makePNG(200, 200)],
        ["image/gif", makePNG(200, 200)],
        ["text/plain", makePNG(200, 200)],
      ] as const) {
        await expectProblem(
          await api.uploadLogo(owner, contentType, body),
          400,
          logoInvalid,
        );
      }
      await expectProblem(
        await api.uploadLogo(
          owner,
          "image/png",
          Buffer.alloc(2 * 1024 * 1024 + 1, 1),
        ),
        413,
        logoTooLarge,
      );
      expect(logoRows(org, "uploading") + logoRows(org, "active")).toBe(0);
    });
  });

  test("strips the source's metadata", async ({ request }) => {
    await withOrg(request, async (api, _org, owner) => {
      await onSilver(api, owner);
      const marked = withTextChunk(
        makePNG(200, 200),
        "Comment",
        "secret-marker",
      );
      expect(marked.includes("secret-marker")).toBe(true);
      expect((await api.uploadLogo(owner, "image/png", marked)).status()).toBe(
        204,
      );
      const image = await fetch((await logoURL(api, owner)) ?? "");
      expect(image.status).toBe(200);
      expect(
        Buffer.from(await image.arrayBuffer()).includes("secret-marker"),
      ).toBe(false);
    });
  });

  test("requires authentication, the superadmin permission, and an active Org", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await onSilver(api, owner);
      const unauthenticated = await request.post(
        `${api.origin}/api/orgs/logo/upload`,
        {
          data: makePNG(200, 200),
          headers: {
            "Content-Type": "image/png",
            "Idempotency-Key": orgsIdempotencyKey(),
          },
        },
      );
      await expectProblem(unauthenticated, 401, authenticationRequired);
      const manager = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        ["org:manage_users"],
      );
      await expectProblem(
        await api.uploadLogo(manager.token, "image/png", makePNG(200, 200)),
        403,
        permissionRequired,
      );
      await expectProblem(
        await api.removeLogo(manager.token),
        403,
        permissionRequired,
      );
      await expectProblem(
        await request.post(`${api.origin}/api/orgs/logo/upload`, {
          data: makePNG(200, 200),
          headers: {
            Authorization: `Bearer ${owner}`,
            "Content-Type": "image/png",
          },
        }),
        400,
        validationFailed,
        ["Idempotency-Key"],
      );
      orgSQL(
        `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
         WHERE org_did = (SELECT org_did FROM vetchium.org_domains
                          WHERE domain = '${org.domain}')`,
      );
      await expectProblem(
        await api.uploadLogo(owner, "image/png", makePNG(200, 200)),
        403,
        orgSuspended,
      );
      await expectProblem(await api.removeLogo(owner), 403, orgSuspended);
    });
  });
});

test.describe("logo removal and plan changes", () => {
  test("removes the logo on any plan and queues the object for deletion", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await onSilver(api, owner);
      await api.uploadLogo(owner, "image/png", makePNG(200, 200));
      const key = orgsIdempotencyKey();
      const removed = await api.removeLogo(owner, key);
      expect(removed.status()).toBe(204);
      expect(removed.headers()["cache-control"]).toBe("no-store");
      expect(await logoURL(api, owner)).toBeUndefined();
      expect(logoRows(org, "active")).toBe(0);
      // Removing again is harmless.
      expect((await api.removeLogo(owner)).status()).toBe(204);
      expect((await api.removeLogo(owner, key)).status()).toBe(204);
      await expectProblem(
        await api.post("/logo/remove", undefined, { token: owner }),
        400,
        validationFailed,
        ["Idempotency-Key"],
      );
      await expectProblem(
        await api.post("/logo/remove", undefined, {
          idempotencyKey: orgsIdempotencyKey(),
        }),
        401,
        authenticationRequired,
      );
    });
  });

  test("the worker deletes the bytes of a removed logo", async ({
    request,
  }) => {
    // Byte deletion waits a minute, longer than any upload still in flight.
    test.setTimeout(150_000);
    await withOrg(request, async (api, org, owner) => {
      await onSilver(api, owner);
      await api.uploadLogo(owner, "image/png", makePNG(200, 200));
      const url = (await logoURL(api, owner)) ?? "";
      expect((await fetch(url)).status).toBe(200);
      await api.removeLogo(owner);
      // The reference is gone at once; the bytes follow when the worker's
      // retried task confirms (after its one-minute grace, in CI too).
      await expect
        .poll(() => logoRows(org, "pending_delete"), { timeout: 120_000 })
        .toBe(0);
      expect((await fetch(url)).status).not.toBe(200);
    });
  });

  test("a downgrade below Silver takes the logo away in its transaction", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await onSilver(api, owner);
      await api.uploadLogo(owner, "image/png", makePNG(200, 200));
      expect(await logoURL(api, owner)).toBeDefined();
      expect(
        (
          await api.setSubscriptionPlan(owner, { plan_oid: "org-free-tier" })
        ).status(),
      ).toBe(200);
      await expect
        .poll(() => logoURL(api, owner), { timeout: 20_000 })
        .toBeUndefined();
      expect((await orgInfo(api, owner)).plan_oid).toBe("org-free-tier");
      expect(logoRows(org, "active")).toBe(0);
      // A later upgrade does not bring it back.
      await onSilver(api, owner);
      expect(await logoURL(api, owner)).toBeUndefined();
    });
  });
});
