import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type {
  LoginResponse,
  LoginTOTPRequiredResponse,
} from "typespec/hub/auth/login";
import type { CompleteSignupResponse } from "typespec/hub/auth/signup";
import type {
  ConfirmTOTPEnrollmentResponse,
  StartTOTPEnrollmentResponse,
  VerifyRecoveryCodeResponse,
} from "typespec/hub/auth/totp";
import type { AuthenticatedSessionResponse } from "typespec/hub/auth/types";
import type { MyInfoResponse } from "typespec/hub/users/profile";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import {
  ageHubSession,
  cleanupHubIdempotency,
  cleanupHubUser,
  currentTOTP,
  hubAuditEventsByIdempotencyKey,
  hubAuditEventsForActor,
  setHubUserState,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { HubAPI, hubIdempotencyKey, MAILPIT_ORIGIN } from "../lib/hub-api.ts";

const initialPassword = `Initial!${randomUUID()}-password`;

async function latestEmailText(
  request: APIRequestContext,
  emailAddress: string,
  expectedText: string,
): Promise<string> {
  const url = `${MAILPIT_ORIGIN}/view/latest.txt?query=${encodeURIComponent(
    `to:${emailAddress}`,
  )}`;
  await expect
    .poll(
      async () => {
        const response = await request.get(url);
        return response.ok() ? response.text() : "";
      },
      { timeout: 10_000 },
    )
    .toContain(expectedText);
  return (await request.get(url)).text();
}

function actionToken(body: string, path: string): string {
  const match = body.match(new RegExp(`${path}\\?token=([0-9a-f]{64})`));
  if (!match?.[1]) throw new Error(`email did not contain ${path} token`);
  return match[1];
}

test("Hub signup, sessions, profile, passwords, and TFA work together", async ({
  adminAPI,
  managerToken,
  ownedDomain,
  request,
}) => {
  const domain = ownedDomain("hub-auth");
  const emailAddress = `e2e+${randomUUID()}@${domain}`;
  const hub = new HubAPI(request);
  try {
    const domainResponse = await adminAPI.post(
      "/create-hub-signup-domain",
      { domain },
      { token: managerToken },
    );
    expect(domainResponse.status(), await domainResponse.text()).toBe(201);

    const signupKey = hubIdempotencyKey();
    const signupRequest = {
      email_address: emailAddress,
      display_name: "Ada Lovelace",
      preferred_language: "de-DE" as const,
      resident_country: "DEU",
    };
    const requested = await hub.post("/request-signup", signupRequest, {
      idempotencyKey: signupKey,
    });
    expect(requested.status(), await requested.text()).toBe(202);
    expect(requested.headers()["cache-control"]).toBe("no-store");
    expect(
      (
        await hub.post("/request-signup", signupRequest, {
          idempotencyKey: signupKey,
        })
      ).status(),
    ).toBe(202);
    await expectProblem(
      await hub.post(
        "/request-signup",
        { ...signupRequest, display_name: "Changed request" },
        { idempotencyKey: signupKey },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );

    const signupEmail = await latestEmailText(
      request,
      emailAddress,
      "Vetchium-Registrierung",
    );
    expect(signupEmail).toContain("Vetchium-Registrierung");
    const signupToken = actionToken(signupEmail, "/complete-signup");
    await expectProblem(
      await hub.post(
        "/complete-signup",
        { signup_token: "x".repeat(43), password: initialPassword },
        { idempotencyKey: hubIdempotencyKey() },
      ),
      401,
      "vetchium-problem-details/hub-invalid-signup-token",
    );
    const completeSignupKey = hubIdempotencyKey();
    const completedResponse = await hub.post(
      "/complete-signup",
      { signup_token: signupToken, password: initialPassword },
      { idempotencyKey: completeSignupKey },
    );
    expect(completedResponse.status(), await completedResponse.text()).toBe(
      201,
    );
    const completed =
      await responseJSON<CompleteSignupResponse>(completedResponse);
    expect(completed.hub_user_did).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(completed.handle).toMatch(/^adalo-[0-9a-hjkmnp-tv-z]{11}$/);
    await expectProblem(
      await hub.post(
        "/complete-signup",
        {
          signup_token: signupToken,
          password: `Different!${randomUUID()}-password`,
        },
        { idempotencyKey: completeSignupKey },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );

    setHubUserState(emailAddress, "disabled");
    await expectProblem(
      await hub.post("/login", {
        email_address: emailAddress,
        password: initialPassword,
      }),
      403,
      "vetchium-problem-details/hub-user-disabled",
    );
    setHubUserState(emailAddress, "active");

    await expectProblem(
      await hub.post("/login", {
        email_address: emailAddress,
        password: "incorrect-password",
      }),
      401,
      "vetchium-problem-details/hub-invalid-credentials",
    );
    const firstLogin = await hub.post("/login", {
      email_address: emailAddress,
      password: initialPassword,
      remember_me: false,
    });
    expect(firstLogin.status(), await firstLogin.text()).toBe(200);
    const first = await responseJSON<LoginResponse>(firstLogin);
    expect(first.authentication_state).toBe("authenticated");
    if (first.authentication_state !== "authenticated")
      throw new Error("unexpected TFA");

    const malformedProtectedRequests = [
      ["/reauthenticate", false],
      ["/change-password", false],
      ["/set-preferred-language", false],
      ["/set-resident-country", false],
      ["/confirm-totp-enrollment", true],
    ] as const;
    for (const [path, idempotent] of malformedProtectedRequests) {
      await expectProblem(
        await hub.postRaw(path, "{", {
          token: first.session_token,
          ...(idempotent ? { idempotencyKey: hubIdempotencyKey() } : {}),
        }),
        400,
        "vetchium-problem-details/invalid-json",
      );
    }
    expect(Date.parse(first.session_expires_at) - Date.now()).toBeGreaterThan(
      23 * 60 * 60 * 1000,
    );

    const rememberedLogin = await hub.post("/login", {
      email_address: emailAddress,
      password: initialPassword,
      remember_me: true,
    });
    const remembered = await responseJSON<LoginResponse>(rememberedLogin);
    if (remembered.authentication_state !== "authenticated")
      throw new Error("unexpected TFA");
    const rememberedTTL =
      Date.parse(remembered.session_expires_at) - Date.now();
    expect(rememberedTTL).toBeGreaterThan(264 * 24 * 60 * 60 * 1000);
    expect(rememberedTTL).toBeLessThan(266 * 24 * 60 * 60 * 1000);

    await expectProblem(
      await hub.post("/reauthenticate", {}, { token: first.session_token }),
      400,
      "vetchium-problem-details/validation-failed",
      ["password"],
    );
    await expectProblem(
      await hub.post(
        "/change-password",
        { new_password: "short" },
        { token: first.session_token },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["new_password"],
    );

    const info = await responseJSON<MyInfoResponse>(
      await hub.get("/my-info", first.session_token),
    );
    expect(info).toMatchObject({
      hub_user_did: completed.hub_user_did,
      handle: completed.handle,
      email_address: emailAddress,
      preferred_language: "de-DE",
      resident_country: "DEU",
      totp_enabled: false,
    });
    await expectProblem(
      await hub.post(
        "/set-preferred-language",
        { preferred_language: "fr-FR" },
        { token: first.session_token },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["preferred_language"],
    );
    await expectProblem(
      await hub.post(
        "/set-resident-country",
        { resident_country: "ZZZ" },
        { token: first.session_token },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["resident_country"],
    );
    expect(
      (
        await hub.post(
          "/set-preferred-language",
          { preferred_language: "ta" },
          { token: first.session_token },
        )
      ).status(),
    ).toBe(204);
    expect(
      (
        await hub.post(
          "/set-resident-country",
          { resident_country: "USA" },
          { token: first.session_token },
        )
      ).status(),
    ).toBe(204);

    ageHubSession(first.session_token);
    for (const [path, idempotent] of [
      ["/start-totp-enrollment", true],
      ["/disable-totp", false],
      ["/regenerate-totp-recovery-codes", true],
    ] as const) {
      await expectProblem(
        await hub.post(path, undefined, {
          token: first.session_token,
          ...(idempotent ? { idempotencyKey: hubIdempotencyKey() } : {}),
        }),
        401,
        "vetchium-problem-details/hub-recent-authentication-required",
      );
    }
    await expectProblem(
      await hub.post(
        "/change-password",
        { new_password: `Changed!${randomUUID()}-password` },
        { token: first.session_token },
      ),
      401,
      "vetchium-problem-details/hub-recent-authentication-required",
    );
    await expectProblem(
      await hub.post(
        "/reauthenticate",
        { password: "incorrect-password" },
        { token: first.session_token },
      ),
      422,
      "vetchium-problem-details/hub-incorrect-password",
    );
    expect(
      (
        await hub.post(
          "/reauthenticate",
          { password: initialPassword },
          { token: first.session_token },
        )
      ).status(),
    ).toBe(200);
    const changedPassword = `Changed!${randomUUID()}-password`;
    expect(
      (
        await hub.post(
          "/change-password",
          { new_password: changedPassword },
          { token: first.session_token },
        )
      ).status(),
    ).toBe(204);
    expect((await hub.get("/my-info", first.session_token)).status()).toBe(200);
    await expectProblem(
      await hub.get("/my-info", remembered.session_token),
      401,
      "vetchium-problem-details/hub-authentication-required",
    );

    await expectProblem(
      await hub.post("/regenerate-totp-recovery-codes", undefined, {
        token: first.session_token,
        idempotencyKey: hubIdempotencyKey(),
      }),
      409,
      "vetchium-problem-details/hub-totp-not-enabled",
    );

    const enrollmentResponse = await hub.post(
      "/start-totp-enrollment",
      undefined,
      { token: first.session_token, idempotencyKey: hubIdempotencyKey() },
    );
    expect(enrollmentResponse.status(), await enrollmentResponse.text()).toBe(
      200,
    );
    const enrollment =
      await responseJSON<StartTOTPEnrollmentResponse>(enrollmentResponse);
    await expectProblem(
      await hub.post(
        "/confirm-totp-enrollment",
        {},
        { token: first.session_token, idempotencyKey: hubIdempotencyKey() },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["totp_enrollment_token", "totp_code"],
    );
    await expectProblem(
      await hub.post(
        "/confirm-totp-enrollment",
        {
          totp_enrollment_token: "x".repeat(43),
          totp_code: "000000",
        },
        { token: first.session_token, idempotencyKey: hubIdempotencyKey() },
      ),
      409,
      "vetchium-problem-details/hub-invalid-totp-enrollment",
    );
    await expectProblem(
      await hub.post(
        "/confirm-totp-enrollment",
        {
          totp_enrollment_token: enrollment.totp_enrollment_token,
          totp_code: "000000",
        },
        { token: first.session_token, idempotencyKey: hubIdempotencyKey() },
      ),
      422,
      "vetchium-problem-details/hub-incorrect-totp-code",
    );
    const confirmationKey = hubIdempotencyKey();
    const confirmationCode = currentTOTP(
      enrollment.manual_entry_key,
      Date.now() - 30_000,
    );
    const confirmationResponse = await hub.post(
      "/confirm-totp-enrollment",
      {
        totp_enrollment_token: enrollment.totp_enrollment_token,
        totp_code: confirmationCode,
      },
      { token: first.session_token, idempotencyKey: confirmationKey },
    );
    expect(
      confirmationResponse.status(),
      await confirmationResponse.text(),
    ).toBe(200);
    const confirmation =
      await responseJSON<ConfirmTOTPEnrollmentResponse>(confirmationResponse);
    expect(confirmation.recovery_codes.length).toBeGreaterThan(0);
    await expectProblem(
      await hub.post(
        "/confirm-totp-enrollment",
        {
          totp_enrollment_token: enrollment.totp_enrollment_token,
          totp_code: confirmationCode === "000000" ? "000001" : "000000",
        },
        { token: first.session_token, idempotencyKey: confirmationKey },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );
    await expectProblem(
      await hub.post("/start-totp-enrollment", undefined, {
        token: first.session_token,
        idempotencyKey: hubIdempotencyKey(),
      }),
      409,
      "vetchium-problem-details/hub-totp-already-enabled",
    );

    await hub.post("/logout", undefined, { token: first.session_token });
    const challengeResponse = await hub.post("/login", {
      email_address: emailAddress,
      password: changedPassword,
    });
    const challenge =
      await responseJSON<LoginTOTPRequiredResponse>(challengeResponse);
    expect(challenge.authentication_state).toBe("totp_required");
    const incorrectTFAKey = hubIdempotencyKey();
    await expectProblem(
      await hub.post(
        "/login/tfa",
        {
          login_challenge_token: challenge.login_challenge_token,
          totp_code: "000000",
        },
        { idempotencyKey: incorrectTFAKey },
      ),
      422,
      "vetchium-problem-details/hub-incorrect-totp-code",
    );
    expect(hubAuditEventsByIdempotencyKey(incorrectTFAKey)).toEqual([]);
    const tfaKey = hubIdempotencyKey();
    const tfaCode = currentTOTP(enrollment.manual_entry_key);
    const tfaSessionResponse = await hub.post(
      "/login/tfa",
      {
        login_challenge_token: challenge.login_challenge_token,
        totp_code: tfaCode,
      },
      { idempotencyKey: tfaKey },
    );
    expect(tfaSessionResponse.status(), await tfaSessionResponse.text()).toBe(
      200,
    );
    const tfaSession =
      await responseJSON<AuthenticatedSessionResponse>(tfaSessionResponse);
    const tfaAuditEvents = hubAuditEventsByIdempotencyKey(tfaKey);
    expect(tfaAuditEvents).toHaveLength(1);
    expect(tfaAuditEvents[0]).toMatchObject({
      tenant_id: "sgp",
      action: "hub.session.created-with-totp",
      entity_type: "hub_session",
      entity_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      actor_type: "hub_user",
      actor_id: completed.hub_user_did,
      source: "hub-api",
      idempotency_key: tfaKey,
      payload: { remembered: false },
    });
    expect(tfaAuditEvents[0]?.payload).toEqual({ remembered: false });
    expect(Number.isNaN(Date.parse(tfaAuditEvents[0]?.created_at ?? ""))).toBe(
      false,
    );
    await expectProblem(
      await hub.post(
        "/login/tfa",
        {
          login_challenge_token: challenge.login_challenge_token,
          totp_code: tfaCode === "000000" ? "000001" : "000000",
        },
        { idempotencyKey: tfaKey },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );
    expect(hubAuditEventsByIdempotencyKey(tfaKey)).toHaveLength(1);

    const recoveryChallenge = await responseJSON<LoginTOTPRequiredResponse>(
      await hub.post("/login", {
        email_address: emailAddress,
        password: changedPassword,
      }),
    );
    const incorrectRecoveryKey = hubIdempotencyKey();
    await expectProblem(
      await hub.post(
        "/login/recovery-code",
        {
          login_challenge_token: recoveryChallenge.login_challenge_token,
          recovery_code: "INVALID-CODE",
        },
        { idempotencyKey: incorrectRecoveryKey },
      ),
      422,
      "vetchium-problem-details/hub-incorrect-recovery-code",
    );
    expect(hubAuditEventsByIdempotencyKey(incorrectRecoveryKey)).toEqual([]);
    const recoveryKey = hubIdempotencyKey();
    const recoveryResponse = await hub.post(
      "/login/recovery-code",
      {
        login_challenge_token: recoveryChallenge.login_challenge_token,
        recovery_code: confirmation.recovery_codes[0],
      },
      { idempotencyKey: recoveryKey },
    );
    expect(recoveryResponse.status(), await recoveryResponse.text()).toBe(200);
    const recovery =
      await responseJSON<VerifyRecoveryCodeResponse>(recoveryResponse);
    expect(recovery.remaining_recovery_codes).toBe(
      confirmation.recovery_codes.length - 1,
    );
    const recoveryAuditEvents = hubAuditEventsByIdempotencyKey(recoveryKey);
    expect(recoveryAuditEvents).toHaveLength(1);
    expect(recoveryAuditEvents[0]).toMatchObject({
      tenant_id: "sgp",
      action: "hub.session.created-with-recovery-code",
      entity_type: "hub_session",
      entity_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      actor_type: "hub_user",
      actor_id: completed.hub_user_did,
      source: "hub-api",
      idempotency_key: recoveryKey,
      payload: { remembered: false },
    });
    expect(recoveryAuditEvents[0]?.payload).toEqual({ remembered: false });
    expect(
      Number.isNaN(Date.parse(recoveryAuditEvents[0]?.created_at ?? "")),
    ).toBe(false);
    const challengeAuditEvents = hubAuditEventsForActor(
      completed.hub_user_did,
      "hub.login-challenge.created",
    );
    expect(challengeAuditEvents).toHaveLength(2);
    for (const event of challengeAuditEvents) {
      expect(event).toMatchObject({
        tenant_id: "sgp",
        action: "hub.login-challenge.created",
        entity_type: "hub_login_challenge",
        entity_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        actor_type: "hub_user",
        actor_id: completed.hub_user_did,
        source: "hub-api",
        idempotency_key: null,
        payload: { remembered: false },
      });
      expect(event.payload).toEqual({ remembered: false });
      expect(Number.isNaN(Date.parse(event.created_at))).toBe(false);
    }
    const signInAuditText = JSON.stringify([
      ...challengeAuditEvents,
      ...tfaAuditEvents,
      ...recoveryAuditEvents,
    ]);
    for (const sensitiveValue of [
      changedPassword,
      challenge.login_challenge_token,
      recoveryChallenge.login_challenge_token,
      tfaCode,
      confirmation.recovery_codes[0],
    ]) {
      expect(signInAuditText).not.toContain(sensitiveValue);
    }
    await expectProblem(
      await hub.post(
        "/login/recovery-code",
        {
          login_challenge_token: recoveryChallenge.login_challenge_token,
          recovery_code: confirmation.recovery_codes[1],
        },
        { idempotencyKey: recoveryKey },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );
    expect(hubAuditEventsByIdempotencyKey(recoveryKey)).toHaveLength(1);

    const regeneratedResponse = await hub.post(
      "/regenerate-totp-recovery-codes",
      undefined,
      { token: recovery.session_token, idempotencyKey: hubIdempotencyKey() },
    );
    expect(regeneratedResponse.status(), await regeneratedResponse.text()).toBe(
      200,
    );
    expect(
      (await responseJSON<ConfirmTOTPEnrollmentResponse>(regeneratedResponse))
        .recovery_codes,
    ).not.toEqual(confirmation.recovery_codes);
    expect(
      (
        await hub.post("/disable-totp", undefined, {
          token: recovery.session_token,
        })
      ).status(),
    ).toBe(204);
    await expectProblem(
      await hub.get("/my-info", tfaSession.session_token),
      401,
      "vetchium-problem-details/hub-authentication-required",
    );

    const resetKey = hubIdempotencyKey();
    expect(
      (
        await hub.post(
          "/request-password-reset",
          { email_address: emailAddress },
          { idempotencyKey: resetKey },
        )
      ).status(),
    ).toBe(202);
    const resetEmail = await latestEmailText(
      request,
      emailAddress,
      "கடவுச்சொல்லை மீட்டமைப்பதற்கான",
    );
    expect(resetEmail).toContain("கடவுச்சொல்லை மீட்டமைப்பதற்கான");
    const resetToken = actionToken(resetEmail, "/reset-password");
    const resetPassword = `Reset!${randomUUID()}-password`;
    const completeResetKey = hubIdempotencyKey();
    expect(
      (
        await hub.post(
          "/complete-password-reset",
          {
            reset_token: resetToken,
            new_password: resetPassword,
          },
          { idempotencyKey: completeResetKey },
        )
      ).status(),
    ).toBe(204);
    await expectProblem(
      await hub.post(
        "/complete-password-reset",
        {
          reset_token: resetToken,
          new_password: `Different!${randomUUID()}-password`,
        },
        { idempotencyKey: completeResetKey },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );
    await expectProblem(
      await hub.get("/my-info", recovery.session_token),
      401,
      "vetchium-problem-details/hub-authentication-required",
    );
  } finally {
    cleanupHubUser(emailAddress);
    cleanupHubIdempotency(hub.idempotencyKeys);
  }
});

test("Hub authentication endpoints reject malformed and unauthenticated requests", async ({
  request,
}) => {
  const hub = new HubAPI(request);
  const validPassword = `Valid!${randomUUID()}-password`;
  try {
    for (const [path, idempotent] of [
      ["/request-signup", true],
      ["/login", false],
      ["/complete-signup", true],
      ["/request-password-reset", true],
      ["/complete-password-reset", true],
      ["/login/tfa", true],
      ["/login/recovery-code", true],
    ] as const) {
      await expectProblem(
        await hub.postRaw(path, "{", {
          ...(idempotent ? { idempotencyKey: hubIdempotencyKey() } : {}),
        }),
        400,
        "vetchium-problem-details/invalid-json",
      );
    }

    const malformedAnonymousRequests = [
      ["/login", false],
      ["/complete-signup", true],
      ["/request-password-reset", true],
      ["/complete-password-reset", true],
      ["/login/tfa", true],
      ["/login/recovery-code", true],
    ] as const;
    for (const [path, idempotent] of malformedAnonymousRequests) {
      await expectProblem(
        await hub.post(
          path,
          {},
          idempotent ? { idempotencyKey: hubIdempotencyKey() } : {},
        ),
        400,
        "vetchium-problem-details/validation-failed",
      );
    }

    await expectProblem(
      await hub.post(
        "/complete-password-reset",
        { reset_token: "x".repeat(43), new_password: validPassword },
        { idempotencyKey: hubIdempotencyKey() },
      ),
      401,
      "vetchium-problem-details/hub-invalid-password-reset-token",
    );
    await expectProblem(
      await hub.post(
        "/login/tfa",
        { login_challenge_token: "x".repeat(43), totp_code: "000000" },
        { idempotencyKey: hubIdempotencyKey() },
      ),
      401,
      "vetchium-problem-details/hub-invalid-login-challenge",
    );
    await expectProblem(
      await hub.post(
        "/login/recovery-code",
        {
          login_challenge_token: "x".repeat(43),
          recovery_code: "INVALID-CODE",
        },
        { idempotencyKey: hubIdempotencyKey() },
      ),
      401,
      "vetchium-problem-details/hub-invalid-login-challenge",
    );

    const protectedRequests = [
      ["/reauthenticate", { password: validPassword }, false],
      ["/change-password", { new_password: validPassword }, false],
      ["/set-preferred-language", { preferred_language: "en-US" }, false],
      ["/set-resident-country", { resident_country: "USA" }, false],
      ["/start-totp-enrollment", undefined, true],
      [
        "/confirm-totp-enrollment",
        { totp_enrollment_token: "x".repeat(43), totp_code: "000000" },
        true,
      ],
      ["/disable-totp", undefined, false],
      ["/regenerate-totp-recovery-codes", undefined, true],
    ] as const;
    for (const [path, body, idempotent] of protectedRequests) {
      await expectProblem(
        await hub.post(
          path,
          body,
          idempotent ? { idempotencyKey: hubIdempotencyKey() } : {},
        ),
        401,
        "vetchium-problem-details/hub-authentication-required",
      );
    }
  } finally {
    cleanupHubIdempotency(hub.idempotencyKeys);
  }
});

test("Hub signup enforces the tenant domain and validates locale and country", async ({
  request,
  ownedDomain,
}) => {
  const hub = new HubAPI(request);
  const domain = ownedDomain("not-allowed");
  const emailAddress = `e2e+${randomUUID()}@${domain}`;
  try {
    await expectProblem(
      await hub.post(
        "/request-signup",
        {
          email_address: emailAddress,
          display_name: "Not Allowed",
          preferred_language: "en-US",
          resident_country: "USA",
        },
        { idempotencyKey: hubIdempotencyKey() },
      ),
      403,
      "vetchium-problem-details/hub-signup-domain-not-allowed",
    );
    await expectProblem(
      await hub.post(
        "/request-signup",
        {
          email_address: emailAddress,
          display_name: " ",
          preferred_language: "fr-FR",
          resident_country: "ZZZ",
        },
        { idempotencyKey: hubIdempotencyKey() },
      ),
      400,
      "vetchium-problem-details/validation-failed",
      ["display_name", "preferred_language", "resident_country"],
    );
  } finally {
    cleanupHubUser(emailAddress);
    cleanupHubIdempotency(hub.idempotencyKeys);
  }
});
