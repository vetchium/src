import { randomUUID } from "node:crypto";
import type { LoginTOTPRequiredResponse } from "typespec/admin/auth/login";
import type {
  ConfirmTOTPEnrollmentResponse,
  StartTOTPEnrollmentResponse,
  VerifyRecoveryCodeResponse,
} from "typespec/admin/auth/totp";
import type { InviteUserResponse } from "typespec/admin/users/invitations";
import {
  expectProblem,
  idempotencyKey,
  responseJSON,
} from "../lib/admin-api.ts";
import {
  type AuditEvent,
  adminAuditEventsByIdempotencyKey,
  adminAuditEventsForActor,
  adminAuditEventsForEntity,
  adminInvitationArtifactCounts,
  adminPasswordHash,
  currentTOTP,
  installAdminAuditInsertFailure,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";

function expectOneAuditEvent(
  events: AuditEvent[],
  expected: Partial<AuditEvent>,
): AuditEvent {
  expect(events).toHaveLength(1);
  const event = events[0];
  if (event === undefined) throw new Error("expected one audit event");
  expect(event).toMatchObject(expected);
  expect(event.audit_event_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(Number.isNaN(Date.parse(event.created_at))).toBe(false);
  return event;
}

test("Admin invitation audit failures roll back state and replay once", async ({
  adminAPI,
  managerToken,
  ownedEmail,
}) => {
  const emailAddress = ownedEmail();
  const key = idempotencyKey();
  const request = {
    email_address: emailAddress,
    permissions: ["admin:view_users"],
  };
  let removeAuditFailure = installAdminAuditInsertFailure({
    action: "admin.invitation.created",
    idempotencyKey: key,
  });

  try {
    await expectProblem(
      await adminAPI.post("/invite-user", request, {
        token: managerToken,
        idempotencyKey: key,
      }),
      500,
      "vetchium-problem-details/internal-server-error",
    );
    expect(adminInvitationArtifactCounts(emailAddress, key)).toEqual({
      auditEvents: 0,
      idempotencyRows: 0,
      invitations: 0,
      outboxItems: 0,
    });

    removeAuditFailure();
    removeAuditFailure = () => {};
    const created = await adminAPI.post("/invite-user", request, {
      token: managerToken,
      idempotencyKey: key,
    });
    expect(created.status(), await created.text()).toBe(201);
    const invitation = await responseJSON<InviteUserResponse>(created);
    expect(
      (
        await adminAPI.post("/invite-user", request, {
          token: managerToken,
          idempotencyKey: key,
        })
      ).status(),
    ).toBe(201);

    const event = expectOneAuditEvent(adminAuditEventsByIdempotencyKey(key), {
      tenant_id: "sgp",
      action: "admin.invitation.created",
      entity_type: "admin_invitation",
      entity_id: invitation.admin_invitation_id,
      actor_type: "admin",
      source: "admin-api",
      idempotency_key: key,
      payload: {
        permissions: ["admin:view_users"],
        email_queued: true,
      },
    });
    expect(event.actor_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(event)).not.toContain(emailAddress);
  } finally {
    removeAuditFailure();
  }
});

test("Admin password audit failures roll back the credential change", async ({
  adminAPI,
  createAdmin,
}) => {
  const admin = await createAdmin();
  const oldHash = adminPasswordHash(admin.emailAddress);
  const newPassword = `Changed!${randomUUID()}-password`;
  let removeAuditFailure = installAdminAuditInsertFailure({
    action: "admin.password.changed",
    actorID: admin.adminUserID,
  });

  try {
    await expectProblem(
      await adminAPI.post(
        "/change-password",
        { new_password: newPassword },
        { token: admin.sessionToken },
      ),
      500,
      "vetchium-problem-details/internal-server-error",
    );
    expect(adminPasswordHash(admin.emailAddress)).toBe(oldHash);
    expect(
      adminAuditEventsForActor(admin.adminUserID, "admin.password.changed"),
    ).toEqual([]);
    expect((await adminAPI.get("/my-info", admin.sessionToken)).status()).toBe(
      200,
    );

    removeAuditFailure();
    removeAuditFailure = () => {};
    expect(
      (
        await adminAPI.post(
          "/change-password",
          { new_password: newPassword },
          { token: admin.sessionToken },
        )
      ).status(),
    ).toBe(204);
    const event = expectOneAuditEvent(
      adminAuditEventsForActor(admin.adminUserID, "admin.password.changed"),
      {
        tenant_id: "sgp",
        entity_type: "admin_user",
        entity_id: admin.adminUserID,
        actor_type: "admin",
        actor_id: admin.adminUserID,
        source: "admin-api",
        idempotency_key: null,
        payload: {
          password_changed: true,
          other_sessions_revoked: true,
        },
      },
    );
    const auditText = JSON.stringify(event);
    for (const sensitive of [
      admin.password,
      newPassword,
      admin.sessionToken,
      oldHash,
    ]) {
      expect(auditText).not.toContain(sensitive);
    }
  } finally {
    removeAuditFailure();
  }
});

test("Admin authorization and TOTP writes record safe actor context", async ({
  adminAPI,
  createAdmin,
  managerToken,
}) => {
  const admin = await createAdmin();
  expect(
    (
      await adminAPI.post(
        "/set-user-permissions",
        {
          admin_user_id: admin.adminUserID,
          permissions: ["admin:view_users"],
        },
        { token: managerToken },
      )
    ).status(),
  ).toBe(204);
  expectOneAuditEvent(
    adminAuditEventsForEntity(admin.adminUserID, "admin.permissions.set"),
    {
      tenant_id: "sgp",
      entity_type: "admin_user",
      entity_id: admin.adminUserID,
      actor_type: "admin",
      source: "admin-api",
      payload: { permissions: ["admin:view_users"] },
    },
  );

  const startKey = idempotencyKey();
  const startedResponse = await adminAPI.post(
    "/start-totp-enrollment",
    undefined,
    { token: admin.sessionToken, idempotencyKey: startKey },
  );
  expect(startedResponse.status()).toBe(200);
  const started =
    await responseJSON<StartTOTPEnrollmentResponse>(startedResponse);
  expectOneAuditEvent(adminAuditEventsByIdempotencyKey(startKey), {
    action: "admin.totp-enrollment.started",
    actor_id: admin.adminUserID,
    source: "admin-api",
  });

  const confirmKey = idempotencyKey();
  const confirmedResponse = await adminAPI.post(
    "/confirm-totp-enrollment",
    {
      totp_enrollment_token: started.totp_enrollment_token,
      totp_code: currentTOTP(started.manual_entry_key),
    },
    { token: admin.sessionToken, idempotencyKey: confirmKey },
  );
  expect(confirmedResponse.status()).toBe(200);
  const confirmed =
    await responseJSON<ConfirmTOTPEnrollmentResponse>(confirmedResponse);
  expectOneAuditEvent(adminAuditEventsByIdempotencyKey(confirmKey), {
    action: "admin.totp.enabled",
    entity_id: admin.adminUserID,
    actor_id: admin.adminUserID,
    payload: { recovery_codes_created: 10 },
  });

  const challenge = await responseJSON<LoginTOTPRequiredResponse>(
    await adminAPI.post("/login", {
      email_address: admin.emailAddress,
      password: admin.password,
    }),
  );
  const recoveryKey = idempotencyKey();
  const recoveredResponse = await adminAPI.post(
    "/login/recovery-code",
    {
      login_challenge_token: challenge.login_challenge_token,
      recovery_code: confirmed.recovery_codes[0],
    },
    { idempotencyKey: recoveryKey },
  );
  expect(recoveredResponse.status()).toBe(200);
  const recovered =
    await responseJSON<VerifyRecoveryCodeResponse>(recoveredResponse);
  const recoveryEvent = expectOneAuditEvent(
    adminAuditEventsByIdempotencyKey(recoveryKey),
    {
      action: "admin.session.created-with-recovery-code",
      actor_id: admin.adminUserID,
      payload: { authentication_method: "recovery-code" },
    },
  );
  const auditText = JSON.stringify([
    ...adminAuditEventsByIdempotencyKey(startKey),
    ...adminAuditEventsByIdempotencyKey(confirmKey),
    recoveryEvent,
  ]);
  for (const sensitive of [
    started.manual_entry_key,
    started.totp_enrollment_token,
    confirmed.recovery_codes[0],
    recovered.session_token,
  ]) {
    expect(auditText).not.toContain(sensitive);
  }
});
