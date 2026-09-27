import { createHash, randomBytes } from "node:crypto";
import type {
  CompleteSignupResponse,
  SignupDetailsResponse,
} from "typespec/orgs/auth/signup";
import type { ListOrgSignupRegionsResponse } from "typespec/regions/regions";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import {
  deleteOrgVerificationRecord,
  setOrgVerificationRecord,
  uniqueOrgDomain,
} from "../lib/dev-dns.ts";
import {
  cleanupOrg,
  OrgsAPI,
  orgEmailCount,
  orgEmailText,
  orgPassword,
  orgSQL,
  orgsIdempotencyKey,
  requestOrgSignup,
  signupOrg,
} from "../lib/orgs-api.ts";

const invalidJSON = "vetchium-problem-details/invalid-json";
const validationFailed = "vetchium-problem-details/validation-failed";
const idempotencyConflict = "vetchium-problem-details/idempotency-key-conflict";
const domainOwned = "vetchium-problem-details/org-domain-already-owned";
const domainBlocked = "vetchium-problem-details/org-signup-domain-blocked";
const invalidToken = "vetchium-problem-details/org-invalid-signup-token";
const recordNotFound = "vetchium-problem-details/org-dns-record-not-found";

test.describe("Org signup regions", () => {
  test("lists Org-enabled regions with the recommendation", async ({
    request,
  }) => {
    const api = new OrgsAPI(request);
    const response = await api.post("/list-signup-regions", { country: "DE" });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body = await responseJSON<ListOrgSignupRegionsResponse>(response);
    expect(body.regions.map((region) => region.tenant_id)).toEqual([
      "deu",
      "ind1",
      "sgp",
      "usa1",
    ]);
    const recommended = body.regions.filter((region) => region.recommended);
    expect(recommended.map((region) => region.tenant_id)).toEqual(["deu"]);
    expect(recommended[0]?.orgs_url).toBe("http://orgs-ui.deu.localhost");
    expect(body.next_pagination_key).toBeNull();
  });

  test("rejects malformed requests", async ({ request }) => {
    const api = new OrgsAPI(request);
    await expectProblem(
      await api.post("/list-signup-regions", { country: "de" }),
      400,
      validationFailed,
      ["country"],
    );
    await expectProblem(
      await api.post("/list-signup-regions", {
        country: "DE",
        pagination_key: "bm90LWEtY3Vyc29y",
      }),
      400,
      "vetchium-problem-details/invalid-pagination-key",
    );
    await expectProblem(
      await api.postRaw("/list-signup-regions", "{"),
      400,
      invalidJSON,
    );
  });
});

test.describe("Org signup request", () => {
  test("queues forwardable DNS instructions and a private link", async ({
    request,
  }) => {
    const api = new OrgsAPI(request);
    const domain = uniqueOrgDomain();
    try {
      const pending = await requestOrgSignup(api, domain);
      const dns = await orgEmailText(
        request,
        pending.emailAddress,
        "DNS record",
      );
      expect(dns).toContain(`_vetchium.${domain}`);
      expect(dns).not.toContain("complete-signup");
      const link = await orgEmailText(
        request,
        pending.emailAddress,
        "Complete",
      );
      expect(link).not.toContain(pending.value);

      const details = await api.post("/get-signup-details", {
        signup_token: pending.token,
      });
      expect(details.status()).toBe(200);
      const body = await responseJSON<SignupDetailsResponse>(details);
      expect(body).toMatchObject({
        domain,
        dns_record_name: `_vetchium.${domain}`,
        dns_record_value: pending.value,
      });
    } finally {
      cleanupOrg(domain);
    }
  });

  test("replays a repeated key without sending more email", async ({
    request,
  }) => {
    const api = new OrgsAPI(request);
    const domain = uniqueOrgDomain();
    const emailAddress = `it@${domain}`;
    const key = orgsIdempotencyKey();
    const body = { email_address: emailAddress, preferred_language: "ta" };
    try {
      expect(
        (
          await api.post("/request-signup", body, { idempotencyKey: key })
        ).status(),
      ).toBe(202);
      // The request is in Tamil, so wait on the count, not a subject.
      await expect
        .poll(() => orgEmailCount(emailAddress), { timeout: 15_000 })
        .toBe(2);
      expect(
        (
          await api.post("/request-signup", body, { idempotencyKey: key })
        ).status(),
      ).toBe(202);
      expect(await orgEmailCount(emailAddress)).toBe(2);
      await expectProblem(
        await api.post(
          "/request-signup",
          { ...body, preferred_language: "de-DE" },
          { idempotencyKey: key },
        ),
        409,
        idempotencyConflict,
      );
    } finally {
      cleanupOrg(domain);
    }
  });

  test("refuses public mailbox domains and invalid input", async ({
    request,
  }) => {
    const api = new OrgsAPI(request);
    for (const emailAddress of ["it@gmail.com", "it@team.outlook.com"]) {
      await expectProblem(
        await api.post(
          "/request-signup",
          { email_address: emailAddress, preferred_language: "en-US" },
          { idempotencyKey: orgsIdempotencyKey() },
        ),
        403,
        domainBlocked,
      );
    }
    await expectProblem(
      await api.post(
        "/request-signup",
        { email_address: "it@localhost", preferred_language: "fr-FR" },
        { idempotencyKey: orgsIdempotencyKey() },
      ),
      400,
      validationFailed,
      ["email_address", "preferred_language"],
    );
    await expectProblem(
      await api.post("/request-signup", {
        email_address: `it@${uniqueOrgDomain()}`,
        preferred_language: "en-US",
      }),
      400,
      validationFailed,
      ["Idempotency-Key"],
    );
    await expectProblem(
      await api.postRaw("/request-signup", "[]", {
        idempotencyKey: orgsIdempotencyKey(),
      }),
      400,
      invalidJSON,
    );
  });

  test("details reject an unknown token", async ({ request }) => {
    const api = new OrgsAPI(request);
    const response = await api.post("/get-signup-details", {
      signup_token: "a".repeat(64),
    });
    await expectProblem(response, 401, invalidToken);
    expect(response.headers()["www-authenticate"]).toBe(
      'VetchiumSignup realm="orgs"',
    );
    await expectProblem(
      await api.post("/get-signup-details", { signup_token: "short" }),
      400,
      validationFailed,
      ["signup_token"],
    );
  });
});

test.describe("Org signup completion", () => {
  test("requires the live record and then creates the Org", async ({
    request,
  }) => {
    const api = new OrgsAPI(request);
    const domain = uniqueOrgDomain();
    try {
      const pending = await requestOrgSignup(api, domain);
      const password = orgPassword();
      const completion = {
        signup_token: pending.token,
        org_display_name: "  Acme Test  ",
        password,
      };
      await expectProblem(
        await api.post("/complete-signup", completion, {
          idempotencyKey: orgsIdempotencyKey(),
        }),
        422,
        recordNotFound,
      );
      // A record with another token proves nothing.
      await setOrgVerificationRecord(domain, [
        "vetchium-verify=aaaaaaaaaaaaaaaaaaaaaaaaaa",
      ]);
      await expectProblem(
        await api.post("/complete-signup", completion, {
          idempotencyKey: orgsIdempotencyKey(),
        }),
        422,
        recordNotFound,
      );

      await setOrgVerificationRecord(domain, ["unrelated", pending.value]);
      const key = orgsIdempotencyKey();
      const created = await api.post("/complete-signup", completion, {
        idempotencyKey: key,
      });
      expect(created.status(), await created.text()).toBe(201);
      expect(await responseJSON<CompleteSignupResponse>(created)).toEqual({
        domain,
      });
      const replay = await api.post("/complete-signup", completion, {
        idempotencyKey: key,
      });
      expect(replay.status()).toBe(201);
      await expectProblem(
        await api.post(
          "/complete-signup",
          { ...completion, org_display_name: "Other" },
          { idempotencyKey: key },
        ),
        409,
        idempotencyConflict,
      );
      expect(
        orgSQL(
          `SELECT o.display_name || '|' || o.org_state || '|' || u.org_user_state
           FROM vetchium.orgs o
           JOIN vetchium.org_domains d USING (org_did)
           JOIN vetchium.org_users u USING (org_did)
           WHERE d.domain = '${domain}'`,
        ),
      ).toBe("Acme Test|active|active");

      // The link is spent: details no longer resolve it.
      await expectProblem(
        await api.post("/get-signup-details", {
          signup_token: pending.token,
        }),
        401,
        invalidToken,
      );
    } finally {
      await deleteOrgVerificationRecord(domain);
      cleanupOrg(domain);
    }
  });

  test("the first proof wins and every other claim is refused", async ({
    request,
  }) => {
    const sgp = new OrgsAPI(request, "sgp");
    const deu = new OrgsAPI(request, "deu");
    const domain = uniqueOrgDomain();
    try {
      const rival = await requestOrgSignup(sgp, domain, "rival");
      await signupOrg(sgp, domain);
      await expectProblem(
        await sgp.post(
          "/complete-signup",
          {
            signup_token: rival.token,
            org_display_name: "Rival",
            password: orgPassword(),
          },
          { idempotencyKey: orgsIdempotencyKey() },
        ),
        409,
        domainOwned,
      );
      for (const api of [sgp, deu]) {
        await expectProblem(
          await api.post(
            "/request-signup",
            {
              email_address: `late@${domain}`,
              preferred_language: "en-US",
            },
            { idempotencyKey: orgsIdempotencyKey() },
          ),
          409,
          domainOwned,
        );
      }
    } finally {
      await deleteOrgVerificationRecord(domain);
      cleanupOrg(domain, "sgp");
      cleanupOrg(domain, "deu");
    }
  });

  test("a rival signup in another tenant loses the global claim", async ({
    request,
  }) => {
    const sgp = new OrgsAPI(request, "sgp");
    const deu = new OrgsAPI(request, "deu");
    const domain = uniqueOrgDomain();
    try {
      const rival = await requestOrgSignup(deu, domain, "rival");
      await signupOrg(sgp, domain);
      await setOrgVerificationRecord(domain, [rival.value]);
      await expectProblem(
        await deu.post(
          "/complete-signup",
          {
            signup_token: rival.token,
            org_display_name: "Rival",
            password: orgPassword(),
          },
          { idempotencyKey: orgsIdempotencyKey() },
        ),
        409,
        domainOwned,
      );
    } finally {
      await deleteOrgVerificationRecord(domain);
      cleanupOrg(domain, "sgp");
      cleanupOrg(domain, "deu");
    }
  });

  test("rejects bad tokens and invalid input", async ({ request }) => {
    const api = new OrgsAPI(request);
    const response = await api.post(
      "/complete-signup",
      {
        signup_token: "b".repeat(64),
        org_display_name: "Acme",
        password: orgPassword(),
      },
      { idempotencyKey: orgsIdempotencyKey() },
    );
    await expectProblem(response, 401, invalidToken);
    await expectProblem(
      await api.post(
        "/complete-signup",
        { signup_token: "short", org_display_name: " ", password: "short" },
        { idempotencyKey: orgsIdempotencyKey() },
      ),
      400,
      validationFailed,
      ["signup_token", "org_display_name", "password"],
    );
    await expectProblem(
      await api.postRaw("/complete-signup", "{", {
        idempotencyKey: orgsIdempotencyKey(),
      }),
      400,
      invalidJSON,
    );
  });
});

// ind1 deliberately cannot reach the global coordinator in the CI
// configuration, so every decision that needs domain ownership fails closed.
test("fails closed when the global directory is unreachable", async ({
  request,
}) => {
  const api = new OrgsAPI(request, "ind1");
  const domain = uniqueOrgDomain();
  const directoryUnavailable =
    "vetchium-problem-details/org-directory-unavailable";
  try {
    await expectProblem(
      await api.post(
        "/request-signup",
        { email_address: `it@${domain}`, preferred_language: "en-US" },
        { idempotencyKey: orgsIdempotencyKey() },
      ),
      503,
      directoryUnavailable,
    );
    await expectProblem(
      await api.post("/login", {
        domain,
        email_address: `it@${domain}`,
        password: orgPassword(),
      }),
      503,
      directoryUnavailable,
    );

    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    orgSQL(
      `INSERT INTO vetchium.org_signup_requests (org_signup_request_id,
         email_address, domain, preferred_language, verification_token,
         token_hash, expires_at)
       VALUES (gen_random_uuid(), 'it@${domain}', '${domain}', 'en-US',
         'aaaaaaaaaaaaaaaaaaaaaaaaaa', decode('${tokenHash}', 'hex'),
         now() + interval '1 hour')`,
      "ind1",
    );
    await expectProblem(
      await api.post(
        "/complete-signup",
        {
          signup_token: token,
          org_display_name: "Offline",
          password: orgPassword(),
        },
        { idempotencyKey: orgsIdempotencyKey() },
      ),
      503,
      directoryUnavailable,
    );
  } finally {
    cleanupOrg(domain, "ind1");
  }
});
