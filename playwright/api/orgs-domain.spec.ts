import type {
  CheckDomainResponse,
  MyInfoResponse,
} from "typespec/orgs/account/account";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import { globalSQLScalar } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import {
  deleteOrgVerificationRecord,
  setOrgVerificationRecord,
} from "../lib/dev-dns.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgEmailText,
  orgInfo,
  orgSQL,
  requestOrgSignup,
  signupOrg,
} from "../lib/orgs-api.ts";

// The CI configuration checks every 2s, fails after two absent results, and
// releases after an 8s grace period, so the lifecycle fits in one test.
test.describe.configure({ timeout: 90_000 });

async function waitForDomain(
  api: OrgsAPI,
  token: string,
  predicate: (info: MyInfoResponse) => boolean,
): Promise<MyInfoResponse> {
  let info: MyInfoResponse | undefined;
  await expect
    .poll(
      async () => {
        info = await orgInfo(api, token);
        return predicate(info);
      },
      { timeout: 45_000, intervals: [500] },
    )
    .toBe(true);
  if (!info) throw new Error("my-info was never read");
  return info;
}

async function checkDomain(
  api: OrgsAPI,
  token: string,
): Promise<CheckDomainResponse> {
  const response = await api.post("/check-domain", undefined, { token });
  expect(response.status(), await response.text()).toBe(200);
  return responseJSON<CheckDomainResponse>(response);
}

function globallyOwned(domain: string): boolean {
  return (
    globalSQLScalar(
      `SELECT count(*) FROM vetchium.org_domains WHERE domain = '${domain}'`,
    ) === "1"
  );
}

test("a missing record makes the domain failing until it returns", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const token = await loginOrg(api, org);
    await deleteOrgVerificationRecord(org.domain);
    const failing = await waitForDomain(
      api,
      token,
      (info) => info.org.domain.state === "failing",
    );
    const since = Date.parse(failing.org.domain.failing_since ?? "");
    expect(Date.parse(failing.org.domain.release_after ?? "")).toBe(
      since + 8_000,
    );
    expect(failing.org.org_state).toBe("active");
    const notice = await orgEmailText(
      request,
      org.emailAddress,
      "no longer verify",
    );
    expect(notice).toContain(org.value);

    expect((await checkDomain(api, token)).check_result).toBe("absent");
    await setOrgVerificationRecord(org.domain, [org.value]);
    const restored = await checkDomain(api, token);
    expect(restored.check_result).toBe("present");
    expect(restored.org.domain.state).toBe("verified");
    expect(restored.org.domain.failing_since).toBeNull();
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("after the grace period the domain is released and the Org restored by proof", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const token = await loginOrg(api, org);
    await deleteOrgVerificationRecord(org.domain);
    const suspended = await waitForDomain(
      api,
      token,
      (info) => info.org.org_state === "suspended",
    );
    expect(suspended.org.domain.state).toBe("released");
    expect(globallyOwned(org.domain)).toBe(false);
    await orgEmailText(request, org.emailAddress, "suspended");

    // Users of a suspended Org can still sign in to restore it.
    const again = await loginOrg(api, org);
    await setOrgVerificationRecord(org.domain, [org.value]);
    const restored = await checkDomain(api, again);
    expect(restored.check_result).toBe("present");
    expect(restored.org.org_state).toBe("active");
    expect(restored.org.domain.state).toBe("verified");
    expect(globallyOwned(org.domain)).toBe(true);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("a released domain claimed by another Org cannot be restored", async ({
  request,
}) => {
  const sgp = new OrgsAPI(request, "sgp");
  const deu = new OrgsAPI(request, "deu");
  const first = await signupOrg(sgp);
  try {
    const token = await loginOrg(sgp, first);
    await deleteOrgVerificationRecord(first.domain);
    await waitForDomain(
      sgp,
      token,
      (info) => info.org.org_state === "suspended",
    );
    const rival = await requestOrgSignup(deu, first.domain, "newowner");
    // Both TXT values are published: the first Org's proof is still valid,
    // but the domain now belongs to the second Org.
    await setOrgVerificationRecord(first.domain, [rival.value]);
    const created = await deu.post(
      "/complete-signup",
      {
        signup_token: rival.token,
        org_display_name: "New Owner",
        password: first.password,
      },
      { idempotencyKey: `e2e-${crypto.randomUUID()}` },
    );
    expect(created.status(), await created.text()).toBe(201);
    await setOrgVerificationRecord(first.domain, [first.value, rival.value]);

    const refused = await checkDomain(sgp, await loginOrg(sgp, first));
    expect(refused.check_result).toBe("present");
    expect(refused.org.org_state).toBe("suspended");
    expect(refused.org.domain.state).toBe("released");
  } finally {
    await deleteOrgVerificationRecord(first.domain);
    cleanupOrg(first.domain, "sgp");
    cleanupOrg(first.domain, "deu");
  }
});

test("only a superadmin may check the domain", async ({ request }) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const token = await loginOrg(api, org);
    const unauthenticated = await api.post("/check-domain");
    await expectProblem(
      unauthenticated,
      401,
      "vetchium-problem-details/org-authentication-required",
    );
    orgSQL(
      `DELETE FROM vetchium.org_user_permissions
       WHERE org_user_id IN (
         SELECT org_user_id FROM vetchium.org_users
         WHERE email_address = '${org.emailAddress}'
       )`,
    );
    await expectProblem(
      await api.post("/check-domain", undefined, { token }),
      403,
      "vetchium-problem-details/org-permission-required",
    );
    expect((await orgInfo(api, token)).permissions).toEqual([]);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
