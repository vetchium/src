import type {
  CompleteSignupRequest,
  RequestSignupRequest,
} from "typespec/orgs/auth/signup";
import { expectProblem } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import {
  deleteOrgVerificationRecord,
  uniqueOrgDomain,
} from "../lib/dev-dns.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgInfo,
  orgPassword,
  signupOrg,
} from "../lib/orgs-api.ts";

// A second sgp API process has fixed unavailable-service settings. It shares
// only test-owned records with the regular API; no running config is changed.
const unavailableOrigin = "http://127.0.0.1:18084";
const signupUnavailable = "vetchium-problem-details/org-signup-unavailable";
const ssoUnavailable = "vetchium-problem-details/org-sso-not-available";

test("disabled Org signup refuses both requesting and completing signup", async ({
  request,
}) => {
  const api = new OrgsAPI(request, "sgp", unavailableOrigin);
  const domain = uniqueOrgDomain();
  const body: RequestSignupRequest = {
    email_address: `it@${domain}`,
    preferred_language: "en-US",
  };
  const completion: CompleteSignupRequest = {
    signup_token: "a".repeat(64),
    org_display_name: "Unavailable",
    password: orgPassword(),
  };
  try {
    await expectProblem(await api.requestSignup(body), 403, signupUnavailable);
    await expectProblem(
      await api.completeSignup(completion),
      403,
      signupUnavailable,
    );
  } finally {
    cleanupOrg(domain);
  }
});

test("Google sign-in cannot start when its provider is not configured", async ({
  request,
}) => {
  const api = new OrgsAPI(request, "sgp", unavailableOrigin);
  await expectProblem(
    await api.startGoogleSignIn(uniqueOrgDomain()),
    404,
    ssoUnavailable,
  );
});

test("Google sign-in cannot be enabled without a provider and leaves the setting unchanged", async ({
  request,
}) => {
  const regular = new OrgsAPI(request);
  const api = new OrgsAPI(request, "sgp", unavailableOrigin);
  const org = await signupOrg(regular);
  try {
    const owner = await loginOrg(regular, org);
    expect(
      (
        await regular.setSubscriptionPlan(owner, {
          plan_oid: "org-gold-tier",
          billing_interval: "month",
        })
      ).status(),
    ).toBe(200);
    await expectProblem(
      await api.setGoogleSignIn(owner, true),
      404,
      ssoUnavailable,
    );
    expect((await orgInfo(regular, owner)).google_sign_in_enabled).toBe(false);
    expect((await api.setGoogleSignIn(owner, false)).status()).toBe(204);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
