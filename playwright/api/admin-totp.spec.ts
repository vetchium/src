import { randomBytes } from "node:crypto";
import {
  AuthenticationStateAuthenticated,
  AuthenticationStateTOTPRequired,
  type LoginTOTPRequiredResponse,
} from "vetchium-specs/admin/auth/login";
import type {
  ConfirmTOTPEnrollmentResponse,
  RegenerateTOTPRecoveryCodesResponse,
  StartTOTPEnrollmentResponse,
  VerifyRecoveryCodeResponse,
} from "vetchium-specs/admin/auth/totp";
import type { AuthenticatedSessionResponse } from "vetchium-specs/admin/auth/types";
import {
  expectProblem,
  idempotencyKey,
  responseJSON,
} from "../lib/admin-api.ts";
import {
  adminIdempotencyCiphertextLength,
  adminLastLoginAt,
  ageAdminLastLogin,
  ageSession,
  currentTOTP,
  expireAdminIdempotency,
  sessionAndReplayExpiry,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";

test.describe("Admin TOTP", () => {
  test("housekeeping deletes expired replay ciphertext containing enrollment secrets", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    const key = idempotencyKey();
    expect(
      (
        await adminAPI.post("/start-totp-enrollment", undefined, {
          token: admin.sessionToken,
          idempotencyKey: key,
        })
      ).status(),
    ).toBe(200);
    const operation = "admin:start-totp-enrollment";
    expect(adminIdempotencyCiphertextLength(operation, key)).toBeGreaterThan(0);
    expireAdminIdempotency(operation, key);

    await expect
      .poll(() => adminIdempotencyCiphertextLength(operation, key), {
        message: "expired encrypted TOTP replay response was not pruned",
        timeout: 20_000,
        intervals: [250, 500, 1000],
      })
      .toBeUndefined();
  });

  test("enrollment is replayable, confirms exactly ten recovery codes, and updates my-info", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    const startKey = idempotencyKey();
    const first = await adminAPI.post("/start-totp-enrollment", undefined, {
      token: admin.sessionToken,
      idempotencyKey: startKey,
    });
    expect(first.status()).toBe(200);
    const enrollment = await responseJSON<StartTOTPEnrollmentResponse>(first);
    expect(enrollment.configuration).toEqual({
      algorithm: "SHA1",
      digits: 6,
      period_seconds: 30,
      allowed_clock_skew_steps: 1,
    });
    expect(enrollment.manual_entry_key).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrollment.provisioning_uri).toContain("otpauth://totp/");
    const replay = await adminAPI.post("/start-totp-enrollment", undefined, {
      token: admin.sessionToken,
      idempotencyKey: startKey,
    });
    expect(await responseJSON<StartTOTPEnrollmentResponse>(replay)).toEqual(
      enrollment,
    );

    const confirmationKey = idempotencyKey();
    const confirmation = await adminAPI.post(
      "/confirm-totp-enrollment",
      {
        totp_enrollment_token: enrollment.totp_enrollment_token,
        totp_code: currentTOTP(enrollment.manual_entry_key),
      },
      { token: admin.sessionToken, idempotencyKey: confirmationKey },
    );
    expect(confirmation.status()).toBe(200);
    const body =
      await responseJSON<ConfirmTOTPEnrollmentResponse>(confirmation);
    expect(body.recovery_codes).toHaveLength(10);
    expect(new Set(body.recovery_codes).size).toBe(10);
    for (const code of body.recovery_codes)
      expect(code).toMatch(/^[0-9A-F]{5}(?:-[0-9A-F]{5}){3}$/);

    const replayedConfirmation = await adminAPI.post(
      "/confirm-totp-enrollment",
      {
        totp_enrollment_token: enrollment.totp_enrollment_token,
        totp_code: currentTOTP(enrollment.manual_entry_key),
      },
      { token: admin.sessionToken, idempotencyKey: confirmationKey },
    );
    expect(
      await responseJSON<ConfirmTOTPEnrollmentResponse>(replayedConfirmation),
    ).toEqual(body);
    await expectProblem(
      await adminAPI.post(
        "/confirm-totp-enrollment",
        {
          totp_enrollment_token: enrollment.totp_enrollment_token,
          totp_code: currentTOTP(enrollment.manual_entry_key),
        },
        { token: admin.sessionToken, idempotencyKey: idempotencyKey() },
      ),
      409,
      "vetchium-problem-details/invalid-totp-enrollment",
    );

    const info = await responseJSON<{
      totp_enabled: boolean;
      recovery_codes_remaining: number;
    }>(await adminAPI.get("/my-info", admin.sessionToken));
    expect(info).toMatchObject({
      totp_enabled: true,
      recovery_codes_remaining: 10,
    });
    await expectProblem(
      await adminAPI.post("/start-totp-enrollment", undefined, {
        token: admin.sessionToken,
        idempotencyKey: idempotencyKey(),
      }),
      409,
      "vetchium-problem-details/totp-already-enabled",
    );
  });

  test("concurrent enrollment starts leave exactly one confirmable enrollment", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    const responses = await Promise.all([
      adminAPI.post("/start-totp-enrollment", undefined, {
        token: admin.sessionToken,
        idempotencyKey: idempotencyKey(),
      }),
      adminAPI.post("/start-totp-enrollment", undefined, {
        token: admin.sessionToken,
        idempotencyKey: idempotencyKey(),
      }),
    ]);
    expect(responses.map((response) => response.status())).toEqual([200, 200]);
    const enrollments = await Promise.all(
      responses.map((response) =>
        responseJSON<StartTOTPEnrollmentResponse>(response),
      ),
    );
    const confirmations = await Promise.all(
      enrollments.map((enrollment) =>
        adminAPI.post(
          "/confirm-totp-enrollment",
          {
            totp_enrollment_token: enrollment.totp_enrollment_token,
            totp_code: currentTOTP(enrollment.manual_entry_key),
          },
          { token: admin.sessionToken, idempotencyKey: idempotencyKey() },
        ),
      ),
    );
    expect(confirmations.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ]);
  });

  test("TOTP login consumes a challenge, supports exact replay, and rejects timestep replay", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    const start = await responseJSON<StartTOTPEnrollmentResponse>(
      await adminAPI.post("/start-totp-enrollment", undefined, {
        token: admin.sessionToken,
        idempotencyKey: idempotencyKey(),
      }),
    );
    expect(
      (
        await adminAPI.post(
          "/confirm-totp-enrollment",
          {
            totp_enrollment_token: start.totp_enrollment_token,
            totp_code: currentTOTP(start.manual_entry_key),
          },
          { token: admin.sessionToken, idempotencyKey: idempotencyKey() },
        )
      ).status(),
    ).toBe(200);
    const login = (await adminAPI.login(
      admin.emailAddress,
      admin.password,
    )) as LoginTOTPRequiredResponse;
    expect(login.authentication_state).toBe(AuthenticationStateTOTPRequired);
    const nextStepCode = currentTOTP(
      start.manual_entry_key,
      Date.now() + 30_000,
    );
    const key = idempotencyKey();
    const verified = await adminAPI.post(
      "/login/tfa",
      {
        login_challenge_token: login.login_challenge_token,
        totp_code: nextStepCode,
      },
      { idempotencyKey: key },
    );
    expect(verified.status()).toBe(200);
    const session = await responseJSON<AuthenticatedSessionResponse>(verified);
    expect(session.session_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const replay = await adminAPI.post(
      "/login/tfa",
      {
        login_challenge_token: login.login_challenge_token,
        totp_code: nextStepCode,
      },
      { idempotencyKey: key },
    );
    expect(await responseJSON<AuthenticatedSessionResponse>(replay)).toEqual(
      session,
    );

    const secondLogin = (await adminAPI.login(
      admin.emailAddress,
      admin.password,
    )) as LoginTOTPRequiredResponse;
    await expectProblem(
      await adminAPI.post(
        "/login/tfa",
        {
          login_challenge_token: secondLogin.login_challenge_token,
          totp_code: nextStepCode,
        },
        { idempotencyKey: idempotencyKey() },
      ),
      422,
      "vetchium-problem-details/incorrect-totp-code",
    );
  });

  test("concurrent password logins serialize challenge replacement without server errors", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    const enrollment = await responseJSON<StartTOTPEnrollmentResponse>(
      await adminAPI.post("/start-totp-enrollment", undefined, {
        token: admin.sessionToken,
        idempotencyKey: idempotencyKey(),
      }),
    );
    expect(
      (
        await adminAPI.post(
          "/confirm-totp-enrollment",
          {
            totp_enrollment_token: enrollment.totp_enrollment_token,
            totp_code: currentTOTP(enrollment.manual_entry_key),
          },
          { token: admin.sessionToken, idempotencyKey: idempotencyKey() },
        )
      ).status(),
    ).toBe(200);

    const logins = await Promise.all([
      adminAPI.post("/login", {
        email_address: admin.emailAddress,
        password: admin.password,
      }),
      adminAPI.post("/login", {
        email_address: admin.emailAddress,
        password: admin.password,
      }),
    ]);
    expect(logins.map((response) => response.status())).toEqual([200, 200]);
    const challenges = await Promise.all(
      logins.map((response) =>
        responseJSON<LoginTOTPRequiredResponse>(response),
      ),
    );
    const verifications = await Promise.all(
      challenges.map((challenge) =>
        adminAPI.post(
          "/login/tfa",
          {
            login_challenge_token: challenge.login_challenge_token,
            totp_code: currentTOTP(
              enrollment.manual_entry_key,
              Date.now() + 30_000,
            ),
          },
          { idempotencyKey: idempotencyKey() },
        ),
      ),
    );
    expect(verifications.map((response) => response.status()).sort()).toEqual([
      200, 401,
    ]);
  });

  test("a recovery code authenticates once and reports the remaining inventory", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    const start = await responseJSON<StartTOTPEnrollmentResponse>(
      await adminAPI.post("/start-totp-enrollment", undefined, {
        token: admin.sessionToken,
        idempotencyKey: idempotencyKey(),
      }),
    );
    const confirmed = await responseJSON<ConfirmTOTPEnrollmentResponse>(
      await adminAPI.post(
        "/confirm-totp-enrollment",
        {
          totp_enrollment_token: start.totp_enrollment_token,
          totp_code: currentTOTP(start.manual_entry_key),
        },
        { token: admin.sessionToken, idempotencyKey: idempotencyKey() },
      ),
    );
    ageAdminLastLogin(admin.emailAddress);
    const login = (await adminAPI.login(
      admin.emailAddress,
      admin.password,
    )) as LoginTOTPRequiredResponse;
    const recoveryKey = idempotencyKey();
    const recovery = await adminAPI.post(
      "/login/recovery-code",
      {
        login_challenge_token: login.login_challenge_token,
        recovery_code: confirmed.recovery_codes[0],
      },
      { idempotencyKey: recoveryKey },
    );
    expect(recovery.status()).toBe(200);
    const recovered = await responseJSON<VerifyRecoveryCodeResponse>(recovery);
    expect(recovered.remaining_recovery_codes).toBe(9);
    expect(adminLastLoginAt(admin.emailAddress)).toBeGreaterThan(
      Date.UTC(2025, 0, 1),
    );
    const expiries = sessionAndReplayExpiry(
      recovered.session_token,
      "admin:login-recovery-code",
      recoveryKey,
    );
    expect(Math.abs(expiries.replay - expiries.session)).toBeLessThan(1000);

    const replay = await adminAPI.post(
      "/login/recovery-code",
      {
        login_challenge_token: login.login_challenge_token,
        recovery_code: confirmed.recovery_codes[0],
      },
      { idempotencyKey: recoveryKey },
    );
    expect(await responseJSON<VerifyRecoveryCodeResponse>(replay)).toEqual(
      recovered,
    );
    await expectProblem(
      await adminAPI.post(
        "/login/recovery-code",
        {
          login_challenge_token: login.login_challenge_token,
          recovery_code: confirmed.recovery_codes[1],
        },
        { idempotencyKey: recoveryKey },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );

    const secondLogin = (await adminAPI.login(
      admin.emailAddress,
      admin.password,
    )) as LoginTOTPRequiredResponse;
    await expectProblem(
      await adminAPI.post(
        "/login/recovery-code",
        {
          login_challenge_token: secondLogin.login_challenge_token,
          recovery_code: confirmed.recovery_codes[0],
        },
        { idempotencyKey: idempotencyKey() },
      ),
      422,
      "vetchium-problem-details/incorrect-recovery-code",
    );
  });

  test("recovery-code regeneration requires enabled TOTP and returns a replacement set", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    await expectProblem(
      await adminAPI.post("/regenerate-totp-recovery-codes", undefined, {
        token: admin.sessionToken,
        idempotencyKey: idempotencyKey(),
      }),
      409,
      "vetchium-problem-details/totp-not-enabled",
    );
    const start = await responseJSON<StartTOTPEnrollmentResponse>(
      await adminAPI.post("/start-totp-enrollment", undefined, {
        token: admin.sessionToken,
        idempotencyKey: idempotencyKey(),
      }),
    );
    const original = await responseJSON<ConfirmTOTPEnrollmentResponse>(
      await adminAPI.post(
        "/confirm-totp-enrollment",
        {
          totp_enrollment_token: start.totp_enrollment_token,
          totp_code: currentTOTP(start.manual_entry_key),
        },
        { token: admin.sessionToken, idempotencyKey: idempotencyKey() },
      ),
    );
    const regenerated = await adminAPI.post(
      "/regenerate-totp-recovery-codes",
      undefined,
      {
        token: admin.sessionToken,
        idempotencyKey: idempotencyKey(),
      },
    );
    expect(regenerated.status()).toBe(200);
    const replacement =
      await responseJSON<RegenerateTOTPRecoveryCodesResponse>(regenerated);
    expect(replacement.recovery_codes).toHaveLength(10);
    expect(replacement.recovery_codes).not.toEqual(original.recovery_codes);
  });

  test("disable TOTP requires recent authentication and returns password-only login afterward", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    const start = await responseJSON<StartTOTPEnrollmentResponse>(
      await adminAPI.post("/start-totp-enrollment", undefined, {
        token: admin.sessionToken,
        idempotencyKey: idempotencyKey(),
      }),
    );
    expect(
      (
        await adminAPI.post(
          "/confirm-totp-enrollment",
          {
            totp_enrollment_token: start.totp_enrollment_token,
            totp_code: currentTOTP(start.manual_entry_key),
          },
          { token: admin.sessionToken, idempotencyKey: idempotencyKey() },
        )
      ).status(),
    ).toBe(200);
    ageSession(admin.sessionToken);
    await expectProblem(
      await adminAPI.post("/disable-totp", undefined, {
        token: admin.sessionToken,
      }),
      401,
      "vetchium-problem-details/recent-authentication-required",
    );
    const challenge = (await adminAPI.login(
      admin.emailAddress,
      admin.password,
    )) as LoginTOTPRequiredResponse;
    const verified = await responseJSON<AuthenticatedSessionResponse>(
      await adminAPI.post(
        "/login/tfa",
        {
          login_challenge_token: challenge.login_challenge_token,
          totp_code: currentTOTP(start.manual_entry_key, Date.now() + 30_000),
        },
        { idempotencyKey: idempotencyKey() },
      ),
    );
    expect(
      (
        await adminAPI.post("/disable-totp", undefined, {
          token: verified.session_token,
        })
      ).status(),
    ).toBe(204);
    const passwordOnly = await adminAPI.login(
      admin.emailAddress,
      admin.password,
    );
    expect(passwordOnly.authentication_state).toBe(
      AuthenticationStateAuthenticated,
    );
  });

  test("TOTP endpoints validate credential shapes before consuming state", async ({
    adminAPI,
    createAdmin,
  }) => {
    const admin = await createAdmin();
    await expectProblem(
      await adminAPI.post(
        "/confirm-totp-enrollment",
        { totp_enrollment_token: "bad", totp_code: "123" },
        { token: admin.sessionToken, idempotencyKey: idempotencyKey() },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["totp_enrollment_token", "totp_code"],
    );
    await expectProblem(
      await adminAPI.post(
        "/login/tfa",
        {
          login_challenge_token: randomBytes(32).toString("base64url"),
          totp_code: "000000",
        },
        { idempotencyKey: idempotencyKey() },
      ),
      401,
      "vetchium-problem-details/invalid-login-challenge",
    );
    await expectProblem(
      await adminAPI.post(
        "/login/recovery-code",
        { login_challenge_token: "bad", recovery_code: "bad" },
        { idempotencyKey: idempotencyKey() },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["login_challenge_token", "recovery_code"],
    );
  });
});
