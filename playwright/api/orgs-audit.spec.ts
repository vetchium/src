import type { MyInfoResponse } from "typespec/orgs/account/account";
import type {
  LoginResponse,
  LoginTOTPRequiredResponse,
} from "typespec/orgs/auth/login";
import type {
  ConfirmTOTPEnrollmentResponse,
  StartTOTPEnrollmentResponse,
} from "typespec/orgs/auth/totp";
import { responseJSON } from "../lib/admin-api.ts";
import type { AuditEvent } from "../lib/admin-db.ts";
import { currentTOTP } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import {
  deleteOrgVerificationRecord,
  setOrgVerificationRecord,
  uniqueOrgDomain,
} from "../lib/dev-dns.ts";
import {
  cleanupOrg,
  installOrgAuditInsertFailure,
  loginOrg,
  OrgsAPI,
  orgAuditEvents,
  orgAuditEventsByKey,
  orgDID,
  orgEmailCount,
  orgEmailText,
  orgInfo,
  orgPassword,
  orgSQL,
  orgsIdempotencyKey,
  orgUserID,
  recordValue,
  requestOrgSignup,
  type SignedUpOrg,
  signupOrg,
  signupToken,
} from "../lib/orgs-api.ts";
import { emailedLinkToken } from "../lib/portals.ts";

test.describe.configure({ timeout: 90_000 });

const internalError = "vetchium-problem-details/internal-server-error";

function actions(events: AuditEvent[]): string[] {
  return events.map((event) => event.action);
}

function only(events: AuditEvent[], action: string): AuditEvent {
  const matching = events.filter((event) => event.action === action);
  expect(matching, `${action} in ${actions(events).join(", ")}`).toHaveLength(
    1,
  );
  return matching[0] as AuditEvent;
}

async function expectInternalError(response: {
  status(): number;
  json(): Promise<unknown>;
}): Promise<void> {
  expect(response.status()).toBe(500);
  expect(await response.json()).toMatchObject({ type: internalError });
}

/** No audit payload may carry a credential, token, or the user's email. */
function expectNoSecrets(events: AuditEvent[], secrets: string[]): void {
  const serialized = JSON.stringify(events.map((event) => event.payload));
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
  }
}

test("signup writes commit exactly one audit event each and roll back with it", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const domain = uniqueOrgDomain();
  const emailAddress = `it@${domain}`;
  const secrets: string[] = [];
  try {
    // A failed audit insert rolls back the request, its emails and the key.
    const removeRequestFault = installOrgAuditInsertFailure({
      action: "org.signup.requested",
      domain,
    });
    try {
      await expectInternalError(
        await api.post(
          "/request-signup",
          { email_address: emailAddress, preferred_language: "en-US" },
          { idempotencyKey: orgsIdempotencyKey() },
        ),
      );
    } finally {
      removeRequestFault();
    }
    expect(
      orgSQL(
        `SELECT count(*) FROM vetchium.org_signup_requests WHERE domain = '${domain}'`,
      ),
    ).toBe("0");
    expect(await orgEmailCount(emailAddress)).toBe(0);

    const requestKey = orgsIdempotencyKey();
    const body = { email_address: emailAddress, preferred_language: "en-US" };
    expect(
      (
        await api.post("/request-signup", body, { idempotencyKey: requestKey })
      ).status(),
    ).toBe(202);
    expect(
      (
        await api.post("/request-signup", body, { idempotencyKey: requestKey })
      ).status(),
    ).toBe(202);
    const requested = only(
      orgAuditEventsByKey(requestKey),
      "org.signup.requested",
    );
    expect(requested).toMatchObject({
      tenant_id: "sgp",
      entity_type: "org_signup_request",
      actor_type: "anonymous",
      actor_id: null,
      source: "orgs-api",
      idempotency_key: requestKey,
    });
    expect(requested.payload).toEqual({
      domain,
      preferred_language: "en-US",
      emails_queued: 2,
    });

    const dns = await orgEmailText(request, emailAddress, "DNS record");
    const token = signupToken(
      await orgEmailText(request, emailAddress, "Complete"),
      api.tenant,
    );
    secrets.push(token);
    await setOrgVerificationRecord(domain, [recordValue(dns)]);
    const password = orgPassword();
    secrets.push(password);
    const completion = {
      signup_token: token,
      org_display_name: "Audited Org",
      password,
    };

    const preparedKey = orgsIdempotencyKey();
    const removePrepareFault = installOrgAuditInsertFailure({
      action: "org.signup.completion_prepared",
      idempotencyKey: preparedKey,
    });
    try {
      await expectInternalError(
        await api.post("/complete-signup", completion, {
          idempotencyKey: preparedKey,
        }),
      );
    } finally {
      removePrepareFault();
    }
    expect(
      orgSQL(
        `SELECT count(*) FROM vetchium.org_signup_completions WHERE domain = '${domain}'`,
      ),
    ).toBe("0");

    // Failing the final activation audit leaves the Org provisioning and
    // non-loginable; the saga reports pending and finishes once the audit
    // insert succeeds again.
    const key = orgsIdempotencyKey();
    const removeCreateFault = installOrgAuditInsertFailure({
      action: "org.created",
      domain,
    });
    try {
      const pending = await api.post("/complete-signup", completion, {
        idempotencyKey: key,
      });
      expect(pending.status(), await pending.text()).toBe(202);
      expect(
        orgSQL(
          `SELECT o.org_state || '|' || u.org_user_state FROM vetchium.orgs o
           JOIN vetchium.org_users u USING (org_did)
           WHERE o.org_did IN (SELECT org_did FROM vetchium.org_signup_completions
                               WHERE domain = '${domain}')`,
        ),
      ).toBe("provisioning|provisioning");
    } finally {
      removeCreateFault();
    }
    await expect
      .poll(
        async () =>
          (
            await api.post("/complete-signup", completion, {
              idempotencyKey: key,
            })
          ).status(),
        { timeout: 20_000 },
      )
      .toBe(201);

    const saga = orgAuditEventsByKey(key);
    for (const action of [
      "org.signup.completion_prepared",
      "org.signup.completion_reserved",
      "org.provisioning",
      "org.created",
      "org_user.created",
    ]) {
      only(saga, action);
    }
    expect(actions(saga)).toContain("org.signup.completion_retry_scheduled");
    const did = orgDID(domain);
    expect(only(saga, "org.created")).toMatchObject({
      entity_type: "org",
      entity_id: did,
      source: expect.stringMatching(/^(orgs-api|workers)$/),
    });
    expect(only(saga, "org.created").payload).toEqual({
      domain,
      org_plan_oid: "org-free-tier",
    });
    expect(only(saga, "org_user.created").payload).toEqual({
      org_did: did,
      permissions: ["org:superadmin"],
    });
    expectNoSecrets([...saga, requested], [...secrets, emailAddress]);
  } finally {
    await deleteOrgVerificationRecord(domain);
    cleanupOrg(domain);
  }
});

test("sign-in and password writes are audited and roll back with their event", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const userID = orgUserID(org.emailAddress);
    const sessions = () =>
      orgSQL(
        `SELECT count(*) FROM vetchium.org_sessions WHERE org_user_id = '${userID}'`,
      );

    const removeLoginFault = installOrgAuditInsertFailure({
      action: "org.session.created",
      actorID: userID,
    });
    try {
      await expectInternalError(
        await api.post("/login", {
          domain: org.domain,
          email_address: org.emailAddress,
          password: org.password,
        }),
      );
    } finally {
      removeLoginFault();
    }
    expect(sessions()).toBe("0");

    const token = await loginOrg(api, org);
    const created = only(orgAuditEvents([userID]), "org.session.created");
    expect(created).toMatchObject({
      entity_type: "org_session",
      actor_type: "org_user",
      actor_id: userID,
      source: "orgs-api",
    });

    const authenticatedAt = () =>
      orgSQL(
        `SELECT authenticated_at FROM vetchium.org_sessions WHERE org_user_id = '${userID}'`,
      );
    orgSQL(
      `UPDATE vetchium.org_sessions
       SET created_at = now() - interval '2 minutes',
           authenticated_at = now() - interval '2 minutes'
       WHERE org_user_id = '${userID}'`,
    );
    const before = authenticatedAt();
    const removeReauthFault = installOrgAuditInsertFailure({
      action: "org.session.reauthenticated",
      actorID: userID,
    });
    try {
      await expectInternalError(
        await api.post(
          "/reauthenticate",
          { password: org.password },
          { token },
        ),
      );
    } finally {
      removeReauthFault();
    }
    expect(authenticatedAt()).toBe(before);
    expect(
      (
        await api.post("/reauthenticate", { password: org.password }, { token })
      ).status(),
    ).toBe(200);
    only(orgAuditEvents([userID]), "org.session.reauthenticated");

    const changed = orgPassword();
    const removeChangeFault = installOrgAuditInsertFailure({
      action: "org.password.changed",
      actorID: userID,
    });
    try {
      await expectInternalError(
        await api.post(
          "/change-password",
          { new_password: changed },
          { token },
        ),
      );
    } finally {
      removeChangeFault();
    }
    await loginOrg(api, org);
    expect(
      (
        await api.post("/change-password", { new_password: changed }, { token })
      ).status(),
    ).toBe(204);
    expect(
      only(orgAuditEvents([userID]), "org.password.changed").payload,
    ).toEqual({
      password_changed: true,
      other_sessions_revoked: true,
    });
    org.password = changed;

    const resetKey = orgsIdempotencyKey();
    const removeResetRequestFault = installOrgAuditInsertFailure({
      action: "org.password-reset.requested",
      idempotencyKey: resetKey,
    });
    try {
      await expectInternalError(
        await api.post(
          "/request-password-reset",
          { domain: org.domain, email_address: org.emailAddress },
          { idempotencyKey: resetKey },
        ),
      );
    } finally {
      removeResetRequestFault();
    }
    expect(
      orgSQL(
        `SELECT count(*) FROM vetchium.org_password_reset_tokens WHERE org_user_id = '${userID}'`,
      ),
    ).toBe("0");
    const emailsBefore = await orgEmailCount(org.emailAddress);

    const requestKey = orgsIdempotencyKey();
    const resetRequest = {
      domain: org.domain,
      email_address: org.emailAddress,
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(
        (
          await api.post("/request-password-reset", resetRequest, {
            idempotencyKey: requestKey,
          })
        ).status(),
      ).toBe(202);
    }
    expect(
      only(orgAuditEventsByKey(requestKey), "org.password-reset.requested")
        .payload,
    ).toEqual({ email_queued: true });
    const email = await orgEmailText(request, org.emailAddress, "Reset");
    expect(await orgEmailCount(org.emailAddress)).toBe(emailsBefore + 1);
    const resetToken =
      emailedLinkToken(email, "/reset-password", api.tenant) ?? "";

    const reset = orgPassword();
    const removeResetFault = installOrgAuditInsertFailure({
      action: "org.password.reset",
      entityID: userID,
    });
    try {
      await expectInternalError(
        await api.post(
          "/complete-password-reset",
          { reset_token: resetToken, new_password: reset },
          { idempotencyKey: orgsIdempotencyKey() },
        ),
      );
    } finally {
      removeResetFault();
    }
    await loginOrg(api, org);
    expect(
      (
        await api.post(
          "/complete-password-reset",
          { reset_token: resetToken, new_password: reset },
          { idempotencyKey: orgsIdempotencyKey() },
        )
      ).status(),
    ).toBe(204);
    expect(
      only(orgAuditEvents([userID]), "org.password.reset").payload,
    ).toEqual({
      password_changed: true,
      all_sessions_revoked: true,
    });

    const fresh = await loginOrg(api, { ...org, password: reset });
    expect(
      (await api.post("/logout", undefined, { token: fresh })).status(),
    ).toBe(204);
    expect(
      orgAuditEvents([userID]).filter(
        (event) => event.action === "org.session.revoked",
      ),
    ).toHaveLength(1);
    expectNoSecrets(orgAuditEvents([userID]), [
      org.password,
      reset,
      changed,
      resetToken,
      token,
      fresh,
      org.emailAddress,
    ]);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("two-factor writes are audited and roll back with their event", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const userID = orgUserID(org.emailAddress);
    const token = await loginOrg(api, org);
    const startKey = orgsIdempotencyKey();
    const start = await api.post("/start-totp-enrollment", undefined, {
      token,
      idempotencyKey: startKey,
    });
    const enrollment = await responseJSON<StartTOTPEnrollmentResponse>(start);
    only(orgAuditEventsByKey(startKey), "org.totp-enrollment.started");

    const confirmBody = {
      totp_enrollment_token: enrollment.totp_enrollment_token,
      totp_code: currentTOTP(enrollment.manual_entry_key, Date.now() - 30_000),
    };
    const removeConfirmFault = installOrgAuditInsertFailure({
      action: "org.totp.enabled",
      actorID: userID,
    });
    try {
      await expectInternalError(
        await api.post("/confirm-totp-enrollment", confirmBody, {
          token,
          idempotencyKey: orgsIdempotencyKey(),
        }),
      );
    } finally {
      removeConfirmFault();
    }
    expect((await orgInfo(api, token)).totp_enabled).toBe(false);

    const confirmKey = orgsIdempotencyKey();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const confirm = await api.post("/confirm-totp-enrollment", confirmBody, {
        token,
        idempotencyKey: confirmKey,
      });
      expect(confirm.status(), await confirm.text()).toBe(200);
    }
    const codes = await responseJSON<ConfirmTOTPEnrollmentResponse>(
      await api.post("/confirm-totp-enrollment", confirmBody, {
        token,
        idempotencyKey: confirmKey,
      }),
    );
    expect(
      only(orgAuditEventsByKey(confirmKey), "org.totp.enabled").payload,
    ).toEqual({
      recovery_codes_created: 10,
    });

    const challenge = async () => {
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
    const tfaBody = {
      login_challenge_token: await challenge(),
      totp_code: currentTOTP(enrollment.manual_entry_key),
    };
    const removeTFAFault = installOrgAuditInsertFailure({
      action: "org.session.created-with-totp",
      actorID: userID,
    });
    try {
      await expectInternalError(
        await api.post("/login/tfa", tfaBody, {
          idempotencyKey: orgsIdempotencyKey(),
        }),
      );
    } finally {
      removeTFAFault();
    }
    // The rolled-back attempt consumed neither the challenge nor the code.
    const tfaKey = orgsIdempotencyKey();
    expect(
      (
        await api.post("/login/tfa", tfaBody, { idempotencyKey: tfaKey })
      ).status(),
    ).toBe(200);
    only(orgAuditEventsByKey(tfaKey), "org.session.created-with-totp");

    const recoveryKey = orgsIdempotencyKey();
    const recovery = await api.post(
      "/login/recovery-code",
      {
        login_challenge_token: await challenge(),
        recovery_code: codes.recovery_codes[0],
      },
      { idempotencyKey: recoveryKey },
    );
    expect(recovery.status()).toBe(200);
    only(
      orgAuditEventsByKey(recoveryKey),
      "org.session.created-with-recovery-code",
    );
    expect(
      orgAuditEvents([userID]).filter(
        (event) => event.action === "org.login-challenge.created",
      ).length,
    ).toBe(2);

    const regenerateKey = orgsIdempotencyKey();
    expect(
      (
        await api.post("/regenerate-totp-recovery-codes", undefined, {
          token,
          idempotencyKey: regenerateKey,
        })
      ).status(),
    ).toBe(200);
    only(
      orgAuditEventsByKey(regenerateKey),
      "org.totp.recovery-codes-regenerated",
    );

    const removeDisableFault = installOrgAuditInsertFailure({
      action: "org.totp.disabled",
      actorID: userID,
    });
    try {
      await expectInternalError(
        await api.post("/disable-totp", undefined, { token }),
      );
    } finally {
      removeDisableFault();
    }
    expect((await orgInfo(api, token)).totp_enabled).toBe(true);
    expect(
      (await api.post("/disable-totp", undefined, { token })).status(),
    ).toBe(204);
    // Disabling again changes nothing, so it records nothing.
    expect(
      (await api.post("/disable-totp", undefined, { token })).status(),
    ).toBe(204);
    only(orgAuditEvents([userID]), "org.totp.disabled");
    expectNoSecrets(orgAuditEvents([userID]), [
      enrollment.manual_entry_key,
      enrollment.totp_enrollment_token,
      ...codes.recovery_codes,
    ]);
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

async function waitForFailing(api: OrgsAPI, token: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const info: MyInfoResponse = await orgInfo(api, token);
        return info.org.domain.state;
      },
      { timeout: 30_000 },
    )
    .toBe("failing");
}

test("domain checks and the lifecycle are audited by whoever caused them", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const org: SignedUpOrg = await signupOrg(api);
  try {
    const userID = orgUserID(org.emailAddress);
    const did = orgDID(org.domain);
    const token = await loginOrg(api, org);
    await deleteOrgVerificationRecord(org.domain);
    await waitForFailing(api, token);

    await setOrgVerificationRecord(org.domain, [org.value]);
    const removeCheckFault = installOrgAuditInsertFailure({
      action: "org.domain.checked",
      actorID: userID,
    });
    try {
      await expectInternalError(
        await api.post("/check-domain", undefined, { token }),
      );
    } finally {
      removeCheckFault();
    }
    expect((await orgInfo(api, token)).org.domain.state).toBe("failing");
    expect(
      (await api.post("/check-domain", undefined, { token })).status(),
    ).toBe(200);
    const manual = orgAuditEvents([did]).filter(
      (event) =>
        event.action === "org.domain.checked" && event.actor_id === userID,
    );
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({
      entity_type: "org_domain",
      actor_type: "org_user",
      source: "orgs-api",
    });
    expect(manual[0]?.payload).toEqual({
      domain: org.domain,
      result: "present",
      previous_state: "failing",
      state: "verified",
    });

    // Let the worker suspend and release, then restore by check-now.
    await deleteOrgVerificationRecord(org.domain);
    await expect
      .poll(
        () =>
          (orgInfo(api, token) as Promise<MyInfoResponse>).then(
            (info) => `${info.org.org_state} ${info.org.domain.state}`,
          ),
        {
          timeout: 45_000,
        },
      )
      .toBe("suspended released");
    await setOrgVerificationRecord(org.domain, [org.value]);
    const restored = await api.post("/check-domain", undefined, {
      token: await loginOrg(api, org),
    });
    expect(restored.status()).toBe(200);

    const lifecycle = orgAuditEvents([did]);
    const worker = lifecycle.filter(
      (event) => event.actor_id === "verify-org-domains",
    );
    expect(worker.length).toBeGreaterThan(0);
    for (const event of worker) {
      expect(event).toMatchObject({ actor_type: "worker", source: "workers" });
    }
    for (const action of [
      "org.domain.release-started",
      "org.suspended",
      "org.domain.released",
      "org.domain.reclaim-started",
      "org.domain.reclaimed",
      "org.reactivated",
    ]) {
      only(lifecycle, action);
    }
    const failingChecks = lifecycle.filter(
      (event) =>
        event.action === "org.domain.checked" &&
        event.payload.state === "failing",
    );
    expect(failingChecks.length).toBeGreaterThan(0);
    expect(
      orgSQL(
        `SELECT count(*) FROM vetchium.audit_events
         WHERE action = 'org.email.sent'
           AND entity_id IN (
             SELECT org_email_outbox_id::text FROM vetchium.org_email_outbox
             WHERE recipient_email_address = '${org.emailAddress}'
               AND kind IN ('domain-failing', 'org-suspended')
           )`,
      ),
    ).not.toBe("0");
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
});

test("a rejected or refused signup records no state and no event", async ({
  request,
}) => {
  const api = new OrgsAPI(request);
  const pending = await requestOrgSignup(api);
  try {
    const key = orgsIdempotencyKey();
    const refused = await api.post(
      "/complete-signup",
      {
        signup_token: pending.token,
        org_display_name: "No Record",
        password: orgPassword(),
      },
      { idempotencyKey: key },
    );
    expect(refused.status()).toBe(422);
    expect(orgAuditEventsByKey(key)).toEqual([]);
  } finally {
    cleanupOrg(pending.domain);
  }
});
