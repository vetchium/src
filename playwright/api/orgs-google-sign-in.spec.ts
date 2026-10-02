import type { Page } from "@playwright/test";
import type { MyInfoResponse } from "typespec/orgs/account/account";
import type { LoginResponse } from "typespec/orgs/auth/login";
import type {
  ConfirmTOTPEnrollmentResponse,
  StartTOTPEnrollmentResponse,
} from "typespec/orgs/auth/totp";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import { currentTOTP } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { boundaryPairEndingAt } from "../lib/billing-periods.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  googleAuthorize,
  googleSignIn,
  inviteeAddress,
  loginOrg,
  OrgsAPI,
  orgInfo,
  orgSQL,
  orgsIdempotencyKey,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";

const ssoFailed = "vetchium-problem-details/org-sso-sign-in-failed";
const planRequired = "vetchium-problem-details/org-plan-required";
const permissionRequired = "vetchium-problem-details/org-permission-required";
const recentRequired =
  "vetchium-problem-details/org-recent-authentication-required";
const limitExceeds = "vetchium-problem-details/org-user-limit-exceeds-target";
const userDisabled = "vetchium-problem-details/org-user-disabled";
const userDisabledNonpayment =
  "vetchium-problem-details/org-user-disabled-nonpayment";
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

async function onGold(api: OrgsAPI, owner: string): Promise<void> {
  expect(
    (
      await api.setPaymentMethod(owner, { kind: "simulated-succeeds" })
    ).status(),
  ).toBe(200);
  const upgraded = await api.setSubscriptionPlan(owner, {
    plan_oid: "org-gold-tier",
    billing_interval: "month",
  });
  expect(upgraded.status(), await upgraded.text()).toBe(200);
}

async function withGoogle(api: OrgsAPI, owner: string): Promise<void> {
  await onGold(api, owner);
  const response = await api.setGoogleSignIn(owner, true);
  expect(response.status(), await response.text()).toBe(204);
}

function identityRows(org: SignedUpOrg): number {
  return Number(
    orgSQL(
      `SELECT count(*) FROM vetchium.org_user_sso_identities i
       JOIN vetchium.org_users u ON u.org_user_id = i.org_user_id
       WHERE u.email_address LIKE '%@${org.domain}'`,
    ),
  );
}

function ageSessions(emailAddress: string): void {
  orgSQL(
    `UPDATE vetchium.org_sessions
     SET created_at = now() - interval '10 minutes',
         authenticated_at = now() - interval '10 minutes'
     WHERE org_user_id IN (
       SELECT org_user_id FROM vetchium.org_users
       WHERE email_address = '${emailAddress}'
     )`,
  );
}

test.describe("start", () => {
  test("answers alike for any domain and carries PKCE, a nonce and the hint", async ({
    request,
  }) => {
    await withOrg(request, async (api, org) => {
      for (const domain of [org.domain, "no-such-org.example"]) {
        const response = await api.startGoogleSignIn(domain);
        expect(response.status(), await response.text()).toBe(200);
        expect(response.headers()["cache-control"]).toBe("no-store");
        const { authorization_url } = (await response.json()) as {
          authorization_url: string;
        };
        const query = new URL(authorization_url).searchParams;
        expect(query.get("response_type")).toBe("code");
        expect(query.get("code_challenge_method")).toBe("S256");
        expect(query.get("code_challenge")).toBeTruthy();
        expect(query.get("nonce")).toBeTruthy();
        expect(query.get("state")).toBeTruthy();
        expect(query.get("hd")).toBe(domain);
        expect(query.get("scope")).toBe("openid email");
      }
    });
  });

  test("rejects a malformed domain", async ({ request }) => {
    const api = new OrgsAPI(request);
    await expectProblem(
      await api.startGoogleSignIn("not a domain"),
      400,
      validationFailed,
      ["domain"],
    );
  });
});

test.describe("completion", () => {
  test("links the Google account on first use, then matches by subject", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await withGoogle(api, owner);
      expect(identityRows(org)).toBe(0);

      const first = await googleSignIn(api, org.domain, {
        email: org.emailAddress,
        sub: "subject-owner",
      });
      expect(first.status(), await first.text()).toBe(200);
      expect(first.headers()["cache-control"]).toBe("no-store");
      const session = (await first.json()) as {
        session_token: string;
        preferred_language: string;
      };
      expect(session.session_token).toBeTruthy();
      expect(identityRows(org)).toBe(1);
      const info = await orgInfo(api, session.session_token);
      expect(info.email_address).toBe(org.emailAddress);
      expect(info.google_sign_in_enabled).toBe(true);
      expect(info.permissions).toContain("org:superadmin");

      const again = await googleSignIn(api, org.domain, {
        email: org.emailAddress,
        sub: "subject-owner",
      });
      expect(again.status(), await again.text()).toBe(200);
      expect(identityRows(org)).toBe(1);
    });
  });

  test("is case-insensitive about the address the provider reports", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await withGoogle(api, owner);
      const response = await googleSignIn(api, org.domain, {
        email: org.emailAddress.toUpperCase(),
      });
      expect(response.status(), await response.text()).toBe(200);
    });
  });

  test("skips Vetchium TOTP, which password sign-in still requires", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await withGoogle(api, owner);
      const start = await api.post("/start-totp-enrollment", undefined, {
        token: owner,
        idempotencyKey: orgsIdempotencyKey(),
      });
      const enrollment = await responseJSON<StartTOTPEnrollmentResponse>(start);
      const confirm = await api.post(
        "/confirm-totp-enrollment",
        {
          totp_enrollment_token: enrollment.totp_enrollment_token,
          totp_code: currentTOTP(
            enrollment.manual_entry_key,
            Date.now() - 30_000,
          ),
        },
        { token: owner, idempotencyKey: orgsIdempotencyKey() },
      );
      expect(confirm.status(), await confirm.text()).toBe(200);
      await responseJSON<ConfirmTOTPEnrollmentResponse>(confirm);

      const password = await api.post("/login", {
        domain: org.domain,
        email_address: org.emailAddress,
        password: org.password,
      });
      expect(
        ((await password.json()) as LoginResponse).authentication_state,
      ).toBe("totp_required");

      const google = await googleSignIn(api, org.domain, {
        email: org.emailAddress,
      });
      expect(google.status(), await google.text()).toBe(200);
      const body = (await google.json()) as { session_token: string };
      expect((await api.myInfo(body.session_token)).status()).toBe(200);
    });
  });

  test("works for a member the superadmin invited", async ({ request }) => {
    await withOrg(request, async (api, org, owner) => {
      await withGoogle(api, owner);
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        ["org:manage_users"],
      );
      const response = await googleSignIn(api, org.domain, {
        email: member.emailAddress,
      });
      expect(response.status(), await response.text()).toBe(200);
      const info = await orgInfo(
        api,
        ((await response.json()) as { session_token: string }).session_token,
      );
      expect(info.email_address).toBe(member.emailAddress);
      expect(info.permissions).toEqual(["org:manage_users"]);
    });
  });
});

test.describe("refusals", () => {
  test("a wrong hosted domain, an unverified email, an outside address and an unknown user all fail alike", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await withGoogle(api, owner);
      for (const account of [
        { email: org.emailAddress, hd: "other.example" },
        { email: org.emailAddress, hd: "" },
        { email: org.emailAddress, emailVerified: false },
        { email: `admin@elsewhere.example` },
        { email: `ghost@${org.domain}` },
      ]) {
        const response = await googleSignIn(api, org.domain, account);
        await expectProblem(response, 401, ssoFailed);
        expect(response.headers()["www-authenticate"]).toContain(
          "VetchiumLogin",
        );
      }
      expect(identityRows(org)).toBe(0);
    });
  });

  test("an Org that never enabled Google sign-in refuses, on Gold or not", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await expectProblem(
        await googleSignIn(api, org.domain, { email: org.emailAddress }),
        401,
        ssoFailed,
      );
      await onGold(api, owner);
      await expectProblem(
        await googleSignIn(api, org.domain, { email: org.emailAddress }),
        401,
        ssoFailed,
      );
      expect(identityRows(org)).toBe(0);
    });
  });

  test("an Org outside Gold refuses even if the flag could be set", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await withGoogle(api, owner);
      // The CHECK keeps the column honest, so move the plan and the flag
      // together the way a lapsed Org would end up.
      orgSQL(
        `UPDATE vetchium.orgs
         SET google_sign_in_enabled = false, org_plan_oid = 'org-silver-tier'
         WHERE org_did = (SELECT org_did FROM vetchium.org_domains
                          WHERE domain = '${org.domain}')`,
      );
      await expectProblem(
        await googleSignIn(api, org.domain, { email: org.emailAddress }),
        401,
        ssoFailed,
      );
    });
  });

  test("a subject cannot move between users, and a user cannot change subject", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await withGoogle(api, owner);
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
      );
      expect(
        (
          await googleSignIn(api, org.domain, {
            email: org.emailAddress,
            sub: "subject-a",
          })
        ).status(),
      ).toBe(200);
      // Another user presenting a subject that is already linked.
      await expectProblem(
        await googleSignIn(api, org.domain, {
          email: member.emailAddress,
          sub: "subject-a",
        }),
        401,
        ssoFailed,
      );
      // The same user presenting a different subject.
      await expectProblem(
        await googleSignIn(api, org.domain, {
          email: org.emailAddress,
          sub: "subject-b",
        }),
        401,
        ssoFailed,
      );
      expect(identityRows(org)).toBe(1);
      // The member can still link a subject of their own.
      expect(
        (
          await googleSignIn(api, org.domain, {
            email: member.emailAddress,
            sub: "subject-c",
          })
        ).status(),
      ).toBe(200);
      expect(identityRows(org)).toBe(2);
    });
  });

  test("a state redeems once, and a bad state or code fails alike", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await withGoogle(api, owner);
      const started = await api.startGoogleSignIn(org.domain);
      const { authorization_url } = (await started.json()) as {
        authorization_url: string;
      };
      const { code, state } = await googleAuthorize(
        api.request,
        authorization_url,
        { email: org.emailAddress },
      );
      expect((await api.completeGoogleSignIn(state, code)).status()).toBe(200);
      await expectProblem(
        await api.completeGoogleSignIn(state, code),
        401,
        ssoFailed,
      );

      const second = await api.startGoogleSignIn(org.domain);
      const next = (await second.json()) as { authorization_url: string };
      const fresh = await googleAuthorize(api.request, next.authorization_url, {
        email: org.emailAddress,
      });
      await expectProblem(
        await api.completeGoogleSignIn(fresh.state, "not-the-code"),
        401,
        ssoFailed,
      );
      // The failed attempt used the state up.
      await expectProblem(
        await api.completeGoogleSignIn(fresh.state, fresh.code),
        401,
        ssoFailed,
      );
      await expectProblem(
        await api.completeGoogleSignIn("x".repeat(43), "code"),
        401,
        ssoFailed,
      );
      await expectProblem(
        await api.completeGoogleSignIn("short", "code"),
        400,
        validationFailed,
        ["state"],
      );
    });
  });

  test("an expired state fails", async ({ request }) => {
    await withOrg(request, async (api, org, owner) => {
      await withGoogle(api, owner);
      const started = await api.startGoogleSignIn(org.domain);
      const { authorization_url } = (await started.json()) as {
        authorization_url: string;
      };
      const { code, state } = await googleAuthorize(
        api.request,
        authorization_url,
        { email: org.emailAddress },
      );
      orgSQL(
        `UPDATE vetchium.org_sso_login_states
         SET created_at = now() - interval '20 minutes',
             expires_at = now() - interval '10 minutes'
         WHERE domain = '${org.domain}'`,
      );
      await expectProblem(
        await api.completeGoogleSignIn(state, code),
        401,
        ssoFailed,
      );
    });
  });

  test("disabled users are named as for the password sign-in", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await withGoogle(api, owner);
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
      );
      expect(
        (
          await api.disableUser(owner, { email_address: member.emailAddress })
        ).status(),
      ).toBe(204);
      await expectProblem(
        await googleSignIn(api, org.domain, { email: member.emailAddress }),
        403,
        userDisabled,
      );
      orgSQL(
        `UPDATE vetchium.org_users
         SET disabled_reason = 'nonpayment', disabled_by = NULL
         WHERE email_address = '${member.emailAddress}'`,
      );
      await expectProblem(
        await googleSignIn(api, org.domain, { email: member.emailAddress }),
        403,
        userDisabledNonpayment,
      );
      // A refused disabled user is not linked.
      expect(identityRows(org)).toBe(0);
    });
  });
});

test.describe("settings", () => {
  test("turning it on needs Gold, a superadmin and a recent sign-in", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      const refused = await api.setGoogleSignIn(owner, true);
      await expectProblem(refused, 403, planRequired);
      expect((await refused.json()).plan_oid).toBe("org-gold-tier");
      expect((await orgInfo(api, owner)).google_sign_in_enabled).toBe(false);

      await onGold(api, owner);
      const member = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain),
        ["org:manage_users", "org:manage_billing"],
      );
      await expectProblem(
        await api.setGoogleSignIn(member.token, true),
        403,
        permissionRequired,
      );
      await expectProblem(
        await new OrgsAPI(request).post("/set-google-sign-in", {
          enabled: true,
        }),
        401,
        "vetchium-problem-details/org-authentication-required",
      );
      ageSessions(org.emailAddress);
      await expectProblem(
        await api.setGoogleSignIn(owner, true),
        401,
        recentRequired,
      );
      expect((await orgInfo(api, owner)).google_sign_in_enabled).toBe(false);

      const fresh = await loginOrg(api, org);
      expect((await api.setGoogleSignIn(fresh, true)).status()).toBe(204);
      expect((await orgInfo(api, fresh)).google_sign_in_enabled).toBe(true);
      // Setting the current value is a success, not a conflict.
      expect((await api.setGoogleSignIn(fresh, true)).status()).toBe(204);
      expect((await api.setGoogleSignIn(fresh, false)).status()).toBe(204);
      expect((await orgInfo(api, fresh)).google_sign_in_enabled).toBe(false);
      expect(
        orgSQL(
          `SELECT string_agg(action, ',' ORDER BY created_at) FROM vetchium.audit_events
           WHERE action LIKE 'org.google_sign_in.%'
             AND entity_id = (SELECT org_did::text FROM vetchium.org_domains
                              WHERE domain = '${org.domain}')`,
        ),
      ).toBe("org.google_sign_in.enabled,org.google_sign_in.disabled");

      await expectProblem(
        await api.post(
          "/set-google-sign-in",
          { enabled: "yes" },
          { token: fresh },
        ),
        400,
        "vetchium-problem-details/invalid-json",
      );
    });
  });

  test("turning it off ends sign-in with Google but not existing sessions", async ({
    request,
  }) => {
    await withOrg(request, async (api, org, owner) => {
      await withGoogle(api, owner);
      const signedIn = await googleSignIn(api, org.domain, {
        email: org.emailAddress,
      });
      const session = ((await signedIn.json()) as { session_token: string })
        .session_token;
      expect((await api.setGoogleSignIn(owner, false)).status()).toBe(204);
      await expectProblem(
        await googleSignIn(api, org.domain, { email: org.emailAddress }),
        401,
        ssoFailed,
      );
      expect((await api.myInfo(session)).status()).toBe(200);
      const info = (await (await api.myInfo(owner)).json()) as MyInfoResponse;
      expect(info.google_sign_in_enabled).toBe(false);
    });
  });

  test("leaving Gold turns it off in the transition", async ({ request }) => {
    await withOrg(request, async (api, org, owner) => {
      await withGoogle(api, owner);
      expect(
        (
          await api.setSubscriptionPlan(owner, { plan_oid: "org-free-tier" })
        ).status(),
      ).toBe(200);
      // Scheduled: still on until the period ends.
      expect((await orgInfo(api, owner)).google_sign_in_enabled).toBe(true);
      const pair = boundaryPairEndingAt(new Date(Date.now() - 1000), "month");
      orgSQL(
        `UPDATE vetchium.orgs
         SET subscription_anchor_at = '${pair.anchor.toISOString()}',
             subscription_period_start = '${pair.start.toISOString()}',
             subscription_period_end = '${pair.end.toISOString()}'
         WHERE org_did = (SELECT org_did FROM vetchium.org_domains
                          WHERE domain = '${org.domain}')`,
      );
      // Whoever applies the cancellation, a request or the worker, writes the
      // plan and the flag in one statement; a read before that computes the
      // transition in memory and agrees.
      expect((await orgInfo(api, owner)).google_sign_in_enabled).toBe(false);
      const stored = `SELECT org_plan_oid || ',' || google_sign_in_enabled
           FROM vetchium.orgs
           WHERE org_did = (SELECT org_did FROM vetchium.org_domains
                            WHERE domain = '${org.domain}')`;
      await expect
        .poll(() => orgSQL(stored), { timeout: 20_000 })
        .toBe("org-free-tier,false");
      await expectProblem(
        await googleSignIn(api, org.domain, { email: org.emailAddress }),
        401,
        ssoFailed,
      );
    });
  });
});

test.describe("seat cap", () => {
  test("Google sign-in lifts the Gold cap, and turning it off is refused above it", async ({
    request,
  }) => {
    // Eleven requests of 100 invitations, each queuing mail.
    test.setTimeout(180_000);
    await withOrg(request, async (api, org, owner) => {
      await onGold(api, owner);
      const batch = (from: number) =>
        Array.from(
          { length: 100 },
          (_, index) => `bulk-${from + index}@${org.domain}`,
        );

      // Without Google sign-in the cap is 1000 seats, one of them the owner.
      const capped = await api.inviteUsers(owner, {
        email_addresses: batch(0),
        permissions: [],
      });
      expect(capped.status(), await capped.text()).toBe(200);

      expect((await api.setGoogleSignIn(owner, true)).status()).toBe(204);
      for (let from = 100; from < 1000; from += 100) {
        const response = await api.inviteUsers(owner, {
          email_addresses: batch(from),
          permissions: [],
        });
        expect(response.status(), await response.text()).toBe(200);
      }
      // 1000 invitations and the owner make 1001 seats, past the plain cap.
      const last = await api.inviteUsers(owner, {
        email_addresses: batch(1000).slice(0, 50),
        permissions: [],
      });
      expect(last.status(), await last.text()).toBe(200);

      const refused = await api.setGoogleSignIn(owner, false);
      await expectProblem(refused, 409, limitExceeds);
      const body = (await refused.json()) as {
        limit: number;
        seats_in_use: number;
      };
      expect(body.limit).toBe(1000);
      expect(body.seats_in_use).toBe(1051);
      expect((await orgInfo(api, owner)).google_sign_in_enabled).toBe(true);
      const subscription = (await (await api.mySubscription(owner)).json()) as {
        seat_limit?: number;
        seats_in_use: number;
      };
      expect(subscription.seat_limit).toBeUndefined();
      expect(subscription.seats_in_use).toBe(1051);

      // Cancelling enough invitations makes turning it off possible again.
      orgSQL(
        `UPDATE vetchium.org_user_invitations SET active = false
         WHERE org_invitation_id IN (
           SELECT org_invitation_id FROM vetchium.org_user_invitations
           WHERE email_address LIKE 'bulk-%@${org.domain}'
           ORDER BY email_address LIMIT 100)`,
      );
      expect((await api.setGoogleSignIn(owner, false)).status()).toBe(204);
      const after = (await (await api.mySubscription(owner)).json()) as {
        seat_limit?: number;
      };
      expect(after.seat_limit).toBe(1000);
    });
  });
});
