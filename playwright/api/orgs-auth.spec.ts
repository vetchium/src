import type { MyInfoResponse } from "typespec/orgs/account/account";
import type {
  LoginResponse,
  LoginTOTPRequiredResponse,
  ReauthenticateResponse,
} from "typespec/orgs/auth/login";
import type {
  ConfirmTOTPEnrollmentResponse,
  RegenerateTOTPRecoveryCodesResponse,
  StartTOTPEnrollmentResponse,
  VerifyRecoveryCodeResponse,
} from "typespec/orgs/auth/totp";
import type { AuthenticatedSessionResponse } from "typespec/orgs/auth/types";
import type { HomedElsewhereDetails } from "typespec/problem/orgs/authentication";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import { currentTOTP } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgEmailText,
  orgInfo,
  orgPassword,
  orgSQL,
  orgsIdempotencyKey,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";

const invalidCredentials = "vetchium-problem-details/org-invalid-credentials";
const authenticationRequired =
  "vetchium-problem-details/org-authentication-required";
const recentRequired =
  "vetchium-problem-details/org-recent-authentication-required";

function ageSessions(org: SignedUpOrg): void {
  orgSQL(
    `UPDATE vetchium.org_sessions
     SET created_at = now() - interval '10 minutes',
         authenticated_at = now() - interval '10 minutes'
     WHERE org_user_id IN (
       SELECT org_user_id FROM vetchium.org_users
       WHERE email_address = '${org.emailAddress}'
     )`,
  );
}

test.describe("Org sign-in", () => {
  test("signs in, reports my-info, and signs out", async ({ request }) => {
    const api = new OrgsAPI(request);
    const org = await signupOrg(api);
    try {
      const response = await api.post("/login", {
        domain: org.domain.toUpperCase(),
        email_address: org.emailAddress.toUpperCase(),
        password: org.password,
      });
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      const login = await responseJSON<LoginResponse>(response);
      if (login.authentication_state !== "authenticated") {
        throw new Error("unexpected second factor");
      }
      expect(login.preferred_language).toBe("en-US");

      const info = await orgInfo(api, login.session_token);
      expect(info).toMatchObject({
        email_address: org.emailAddress,
        permissions: ["org:superadmin"],
        totp_enabled: false,
        recovery_codes_remaining: 0,
        org: {
          display_name: "Playwright Org",
          org_state: "active",
          domain: {
            domain: org.domain,
            state: "verified",
            dns_record_name: `_vetchium.${org.domain}`,
            dns_record_value: org.value,
            failing_since: null,
            release_after: null,
          },
        },
      });

      const logout = await api.post("/logout", undefined, {
        token: login.session_token,
      });
      expect(logout.status()).toBe(204);
      const after = await api.myInfo(login.session_token);
      await expectProblem(after, 401, authenticationRequired);
      expect(after.headers()["www-authenticate"]).toBe('Bearer realm="orgs"');
      expect((await api.post("/logout")).status()).toBe(204);
    } finally {
      await deleteOrgVerificationRecord(org.domain);
      cleanupOrg(org.domain);
    }
  });

  test("answers wrong passwords, unknown users and domains alike", async ({
    request,
  }) => {
    const api = new OrgsAPI(request);
    const org = await signupOrg(api);
    try {
      for (const attempt of [
        { ...org, password: orgPassword() },
        { ...org, emailAddress: `nobody@${org.domain}` },
        { ...org, domain: "unknown-org.vetchium.test" },
      ]) {
        const response = await api.post("/login", {
          domain: attempt.domain,
          email_address: attempt.emailAddress,
          password: attempt.password,
        });
        await expectProblem(response, 401, invalidCredentials);
        expect(response.headers()["www-authenticate"]).toBe(
          'VetchiumLogin realm="orgs"',
        );
      }
      await expectProblem(
        await api.post("/login", { domain: "x", email_address: "y" }),
        400,
        "vetchium-problem-details/validation-failed",
        ["domain", "email_address", "password"],
      );
      await expectProblem(
        await api.postRaw("/login", "{"),
        400,
        "vetchium-problem-details/invalid-json",
      );
    } finally {
      await deleteOrgVerificationRecord(org.domain);
      cleanupOrg(org.domain);
    }
  });

  test("sends an Org homed elsewhere to its own region", async ({
    request,
  }) => {
    const sgp = new OrgsAPI(request, "sgp");
    const org = await signupOrg(sgp);
    try {
      const response = await new OrgsAPI(request, "usa1").post("/login", {
        domain: org.domain,
        email_address: org.emailAddress,
        password: "not-checked-here",
      });
      await expectProblem(
        response,
        409,
        "vetchium-problem-details/org-homed-elsewhere",
      );
      const body = await responseJSON<HomedElsewhereDetails>(response);
      expect(body.tenant_id).toBe("sgp");
      expect(body.orgs_url).toBe("http://orgs-ui.sgp.localhost");
    } finally {
      await deleteOrgVerificationRecord(org.domain);
      cleanupOrg(org.domain);
    }
  });

  test("refuses a disabled Org user after the password", async ({
    request,
  }) => {
    const api = new OrgsAPI(request);
    const org = await signupOrg(api);
    try {
      orgSQL(
        `UPDATE vetchium.org_users SET org_user_state = 'disabled'
         WHERE email_address = '${org.emailAddress}'`,
      );
      await expectProblem(
        await api.post("/login", {
          domain: org.domain,
          email_address: org.emailAddress,
          password: org.password,
        }),
        403,
        "vetchium-problem-details/org-user-disabled",
      );
    } finally {
      await deleteOrgVerificationRecord(org.domain);
      cleanupOrg(org.domain);
    }
  });
});

test.describe("Org credentials", () => {
  test("reauthenticates and changes the password with step-up", async ({
    request,
  }) => {
    const api = new OrgsAPI(request);
    const org = await signupOrg(api);
    try {
      const token = await loginOrg(api, org);
      const other = await loginOrg(api, org);
      await expectProblem(
        await api.post(
          "/reauthenticate",
          { password: orgPassword() },
          { token },
        ),
        422,
        "vetchium-problem-details/org-incorrect-password",
      );
      await expectProblem(
        await api.post("/reauthenticate", { password: org.password }),
        401,
        authenticationRequired,
      );

      ageSessions(org);
      const newPassword = orgPassword();
      const stale = await api.post(
        "/change-password",
        { new_password: newPassword },
        { token },
      );
      await expectProblem(stale, 401, recentRequired);

      const refreshed = await api.post(
        "/reauthenticate",
        { password: org.password },
        { token },
      );
      expect(refreshed.status()).toBe(200);
      const body = await responseJSON<ReauthenticateResponse>(refreshed);
      expect(Date.parse(body.session_authenticated_at)).toBeGreaterThan(
        Date.now() - 60_000,
      );
      expect(
        (
          await api.post(
            "/change-password",
            { new_password: newPassword },
            { token },
          )
        ).status(),
      ).toBe(204);
      // Other sessions are revoked; this one survives.
      await expectProblem(await api.myInfo(other), 401, authenticationRequired);
      expect((await api.myInfo(token)).status()).toBe(200);
      await loginOrg(api, { ...org, password: newPassword });
      await expectProblem(
        await api.post(
          "/change-password",
          { new_password: "short" },
          { token },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["new_password"],
      );
    } finally {
      await deleteOrgVerificationRecord(org.domain);
      cleanupOrg(org.domain);
    }
  });

  test("resets a forgotten password by emailed link", async ({ request }) => {
    const api = new OrgsAPI(request);
    const org = await signupOrg(api);
    try {
      const token = await loginOrg(api, org);
      for (const emailAddress of [org.emailAddress, `nobody@${org.domain}`]) {
        const response = await api.post(
          "/request-password-reset",
          { domain: org.domain, email_address: emailAddress },
          { idempotencyKey: orgsIdempotencyKey() },
        );
        expect(response.status()).toBe(202);
      }
      const email = await orgEmailText(request, org.emailAddress, "Reset");
      const resetToken = email.match(
        /reset-password\?token=([0-9a-f]{64})/,
      )?.[1];
      expect(resetToken).toBeDefined();
      const newPassword = orgPassword();
      const completed = await api.post(
        "/complete-password-reset",
        { reset_token: resetToken, new_password: newPassword },
        { idempotencyKey: orgsIdempotencyKey() },
      );
      expect(completed.status()).toBe(204);
      await expectProblem(await api.myInfo(token), 401, authenticationRequired);
      await loginOrg(api, { ...org, password: newPassword });
      const reused = await api.post(
        "/complete-password-reset",
        { reset_token: resetToken, new_password: orgPassword() },
        { idempotencyKey: orgsIdempotencyKey() },
      );
      await expectProblem(
        reused,
        401,
        "vetchium-problem-details/org-invalid-password-reset-token",
      );
      expect(reused.headers()["www-authenticate"]).toBe(
        'VetchiumPasswordReset realm="orgs"',
      );
      await expectProblem(
        await api.post(
          "/request-password-reset",
          { domain: "x", email_address: "y" },
          { idempotencyKey: orgsIdempotencyKey() },
        ),
        400,
        "vetchium-problem-details/validation-failed",
        ["domain", "email_address"],
      );
    } finally {
      await deleteOrgVerificationRecord(org.domain);
      cleanupOrg(org.domain);
    }
  });
});

test.describe("Org two-factor authentication", () => {
  test("enrolls, signs in with TOTP and recovery codes, and disables", async ({
    request,
  }) => {
    const api = new OrgsAPI(request);
    const org = await signupOrg(api);
    try {
      const token = await loginOrg(api, org);
      const start = await api.post("/start-totp-enrollment", undefined, {
        token,
        idempotencyKey: orgsIdempotencyKey(),
      });
      expect(start.status()).toBe(200);
      const enrollment = await responseJSON<StartTOTPEnrollmentResponse>(start);
      await expectProblem(
        await api.post(
          "/confirm-totp-enrollment",
          {
            totp_enrollment_token: enrollment.totp_enrollment_token,
            totp_code: "000000",
          },
          { token, idempotencyKey: orgsIdempotencyKey() },
        ),
        422,
        "vetchium-problem-details/org-incorrect-totp-code",
      );
      // Confirm with the previous step so the current code is still unused
      // for the sign-in below.
      const confirm = await api.post(
        "/confirm-totp-enrollment",
        {
          totp_enrollment_token: enrollment.totp_enrollment_token,
          totp_code: currentTOTP(
            enrollment.manual_entry_key,
            Date.now() - 30_000,
          ),
        },
        { token, idempotencyKey: orgsIdempotencyKey() },
      );
      expect(confirm.status(), await confirm.text()).toBe(200);
      const codes = await responseJSON<ConfirmTOTPEnrollmentResponse>(confirm);
      expect(codes.recovery_codes).toHaveLength(10);
      await expectProblem(
        await api.post("/start-totp-enrollment", undefined, {
          token,
          idempotencyKey: orgsIdempotencyKey(),
        }),
        409,
        "vetchium-problem-details/org-totp-already-enabled",
      );

      const challenge = async () => {
        const response = await api.post("/login", {
          domain: org.domain,
          email_address: org.emailAddress,
          password: org.password,
        });
        const body = await responseJSON<LoginResponse>(response);
        expect(body.authentication_state).toBe("totp_required");
        return (body as LoginTOTPRequiredResponse).login_challenge_token;
      };
      const tfa = await api.post(
        "/login/tfa",
        {
          login_challenge_token: await challenge(),
          totp_code: currentTOTP(enrollment.manual_entry_key),
        },
        { idempotencyKey: orgsIdempotencyKey() },
      );
      expect(tfa.status(), await tfa.text()).toBe(200);
      const session = await responseJSON<AuthenticatedSessionResponse>(tfa);
      expect((await api.myInfo(session.session_token)).status()).toBe(200);
      const expired = await api.post(
        "/login/tfa",
        {
          login_challenge_token: "c".repeat(64),
          totp_code: "123456",
        },
        { idempotencyKey: orgsIdempotencyKey() },
      );
      await expectProblem(
        expired,
        401,
        "vetchium-problem-details/org-invalid-login-challenge",
      );

      const recovery = await api.post(
        "/login/recovery-code",
        {
          login_challenge_token: await challenge(),
          recovery_code: codes.recovery_codes[0],
        },
        { idempotencyKey: orgsIdempotencyKey() },
      );
      expect(recovery.status(), await recovery.text()).toBe(200);
      const recovered =
        await responseJSON<VerifyRecoveryCodeResponse>(recovery);
      expect(recovered.remaining_recovery_codes).toBe(9);
      await expectProblem(
        await api.post(
          "/login/recovery-code",
          {
            login_challenge_token: await challenge(),
            recovery_code: codes.recovery_codes[0],
          },
          { idempotencyKey: orgsIdempotencyKey() },
        ),
        422,
        "vetchium-problem-details/org-incorrect-recovery-code",
      );

      const fresh = recovered.session_token;
      const info = await responseJSON<MyInfoResponse>(await api.myInfo(fresh));
      expect(info.totp_enabled).toBe(true);
      expect(info.recovery_codes_remaining).toBe(9);
      const regenerated = await api.post(
        "/regenerate-totp-recovery-codes",
        undefined,
        { token: fresh, idempotencyKey: orgsIdempotencyKey() },
      );
      expect(regenerated.status()).toBe(200);
      expect(
        (await responseJSON<RegenerateTOTPRecoveryCodesResponse>(regenerated))
          .recovery_codes,
      ).toHaveLength(10);

      expect(
        (await api.post("/disable-totp", undefined, { token: fresh })).status(),
      ).toBe(204);
      await expectProblem(
        await api.post("/regenerate-totp-recovery-codes", undefined, {
          token: fresh,
          idempotencyKey: orgsIdempotencyKey(),
        }),
        409,
        "vetchium-problem-details/org-totp-not-enabled",
      );
      await loginOrg(api, org);
    } finally {
      await deleteOrgVerificationRecord(org.domain);
      cleanupOrg(org.domain);
    }
  });

  test("an invalid enrollment token is refused", async ({ request }) => {
    const api = new OrgsAPI(request);
    const org = await signupOrg(api);
    try {
      const token = await loginOrg(api, org);
      await expectProblem(
        await api.post(
          "/confirm-totp-enrollment",
          { totp_enrollment_token: "d".repeat(64), totp_code: "123456" },
          { token, idempotencyKey: orgsIdempotencyKey() },
        ),
        409,
        "vetchium-problem-details/org-invalid-totp-enrollment",
      );
      ageSessions(org);
      await expectProblem(
        await api.post("/disable-totp", undefined, { token }),
        401,
        recentRequired,
      );
    } finally {
      await deleteOrgVerificationRecord(org.domain);
      cleanupOrg(org.domain);
    }
  });
});
