import type {
  LoginResponse,
  LoginTOTPRequiredResponse,
} from "typespec/orgs/auth/login";
import type {
  ConfirmTOTPEnrollmentResponse,
  StartTOTPEnrollmentResponse,
} from "typespec/orgs/auth/totp";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import { currentTOTP } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgEmailText,
  orgPassword,
  orgsIdempotencyKey,
  signupOrg,
} from "../lib/orgs-api.ts";

// Request-signup's and complete-signup's 403 signup-unavailable need a tenant
// with Org signup switched off, which the shared CI stack does not have.
// Complete-signup's 202 is produced in orgs-audit.spec.ts by failing the
// final activation audit event.

const invalidJSON = "vetchium-problem-details/invalid-json";
const validationFailed = "vetchium-problem-details/validation-failed";
const idempotencyConflict = "vetchium-problem-details/idempotency-key-conflict";
const authenticationRequired =
  "vetchium-problem-details/org-authentication-required";
const invalidChallenge = "vetchium-problem-details/org-invalid-login-challenge";

test("unauthenticated credential routes answer with the Org challenge", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  for (const [path, body] of [
    ["/change-password", { new_password: orgPassword() }],
    ["/disable-totp", undefined],
    ["/start-totp-enrollment", undefined],
    ["/regenerate-totp-recovery-codes", undefined],
    [
      "/confirm-totp-enrollment",
      { totp_enrollment_token: "e".repeat(64), totp_code: "123456" },
    ],
  ] as const) {
    const response = await api.post(path, body, {
      idempotencyKey: orgsIdempotencyKey(),
    });
    await expectProblem(response, 401, authenticationRequired);
    expect(response.headers()["www-authenticate"]).toBe('Bearer realm="orgs"');
  }
});

test("malformed bodies are refused on every Org JSON route", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const token = await loginOrg(api, org);
    for (const path of [
      "/get-signup-details",
      "/request-password-reset",
      "/complete-password-reset",
      "/login/tfa",
      "/login/recovery-code",
    ]) {
      await expectProblem(
        await api.postRaw(path, "{", { idempotencyKey: orgsIdempotencyKey() }),
        400,
        invalidJSON,
      );
    }
    for (const path of [
      "/change-password",
      "/reauthenticate",
      "/confirm-totp-enrollment",
    ]) {
      const response = await request.post(`${api.origin}/api/orgs${path}`, {
        data: "{",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": orgsIdempotencyKey(),
        },
      });
      await expectProblem(response, 400, invalidJSON);
    }
    await expectProblem(
      await api.post("/reauthenticate", { password: "" }, { token }),
      400,
      validationFailed,
      ["password"],
    );
    await expectProblem(
      await api.post(
        "/confirm-totp-enrollment",
        { totp_enrollment_token: "short", totp_code: "12" },
        { token, idempotencyKey: orgsIdempotencyKey() },
      ),
      400,
      validationFailed,
      ["totp_enrollment_token", "totp_code"],
    );
    await expectProblem(
      await api.post(
        "/complete-password-reset",
        { reset_token: "short", new_password: "short" },
        { idempotencyKey: orgsIdempotencyKey() },
      ),
      400,
      validationFailed,
      ["reset_token", "new_password"],
    );
    for (const path of ["/login/tfa", "/login/recovery-code"]) {
      await expectProblem(
        await api.post(
          path,
          { login_challenge_token: "short" },
          { idempotencyKey: orgsIdempotencyKey() },
        ),
        400,
        validationFailed,
      );
    }
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("a reused idempotency key with another body is a conflict", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    await api.post(
      "/request-password-reset",
      { domain: org.domain, email_address: org.emailAddress },
      { idempotencyKey: orgsIdempotencyKey() },
    );
    const email = await orgEmailText(request, org.emailAddress, "Reset");
    const resetToken = email.match(/reset-password\?token=([0-9a-f]{64})/)?.[1];
    const reset = orgsIdempotencyKey();
    org.password = orgPassword();
    const completed = await api.post(
      "/complete-password-reset",
      { reset_token: resetToken, new_password: org.password },
      { idempotencyKey: reset },
    );
    expect(completed.status()).toBe(204);
    await expectProblem(
      await api.post(
        "/complete-password-reset",
        { reset_token: resetToken, new_password: orgPassword() },
        { idempotencyKey: reset },
      ),
      409,
      idempotencyConflict,
    );

    const token = await loginOrg(api, org);
    const start = await api.post("/start-totp-enrollment", undefined, {
      token,
      idempotencyKey: orgsIdempotencyKey(),
    });
    const enrollment = await responseJSON<StartTOTPEnrollmentResponse>(start);
    const confirmKey = orgsIdempotencyKey();
    const confirm = await api.post(
      "/confirm-totp-enrollment",
      {
        totp_enrollment_token: enrollment.totp_enrollment_token,
        totp_code: currentTOTP(
          enrollment.manual_entry_key,
          Date.now() - 30_000,
        ),
      },
      { token, idempotencyKey: confirmKey },
    );
    expect(confirm.status(), await confirm.text()).toBe(200);
    const codes = await responseJSON<ConfirmTOTPEnrollmentResponse>(confirm);
    await expectProblem(
      await api.post(
        "/confirm-totp-enrollment",
        {
          totp_enrollment_token: enrollment.totp_enrollment_token,
          totp_code: "000000",
        },
        { token, idempotencyKey: confirmKey },
      ),
      409,
      idempotencyConflict,
    );

    const login = await api.post("/login", {
      domain: org.domain,
      email_address: org.emailAddress,
      password: org.password,
    });
    const challenge = (
      (await responseJSON<LoginResponse>(login)) as LoginTOTPRequiredResponse
    ).login_challenge_token;
    await expectProblem(
      await api.post(
        "/login/tfa",
        { login_challenge_token: challenge, totp_code: "000000" },
        { idempotencyKey: orgsIdempotencyKey() },
      ),
      422,
      "vetchium-problem-details/org-incorrect-totp-code",
    );
    const freshChallenge = async () => {
      const response = await api.post("/login", {
        domain: org.domain,
        email_address: org.emailAddress,
        password: org.password,
      });
      return (
        (await responseJSON<LoginResponse>(
          response,
        )) as LoginTOTPRequiredResponse
      ).login_challenge_token;
    };
    for (const [path, secondFactor, changed] of [
      [
        "/login/tfa",
        { totp_code: currentTOTP(enrollment.manual_entry_key) },
        { totp_code: "000000" },
      ],
      [
        "/login/recovery-code",
        { recovery_code: codes.recovery_codes[1] },
        { recovery_code: codes.recovery_codes[3] },
      ],
    ] as const) {
      // A new challenge replaces the previous one, so each is made just
      // before it is used.
      const body = {
        login_challenge_token: await freshChallenge(),
        ...secondFactor,
      };
      const key = orgsIdempotencyKey();
      const first = await api.post(path, body, { idempotencyKey: key });
      expect(first.status(), await first.text()).toBe(200);
      await expectProblem(
        await api.post(path, { ...body, ...changed }, { idempotencyKey: key }),
        409,
        idempotencyConflict,
      );
    }
    const expired = await api.post(
      "/login/recovery-code",
      {
        login_challenge_token: "h".repeat(64),
        recovery_code: codes.recovery_codes[2],
      },
      { idempotencyKey: orgsIdempotencyKey() },
    );
    await expectProblem(expired, 401, invalidChallenge);
    expect(expired.headers()["www-authenticate"]).toBe(
      'VetchiumLoginChallenge realm="orgs"',
    );
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});
