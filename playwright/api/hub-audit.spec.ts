import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type { LoginResponse } from "typespec/hub/auth/login";
import type { CompleteSignupResponse } from "typespec/hub/auth/signup";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import {
  type AuditEvent,
  cleanupHubIdempotency,
  cleanupHubUser,
  hubAuditEventsByIdempotencyKey,
  hubAuditEventsForActor,
  hubPasswordHash,
  hubSessionCount,
  hubSignupArtifactCounts,
  hubSignupCompletionArtifactCounts,
  installHubAuditInsertFailure,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { HubAPI, hubIdempotencyKey, MAILPIT_ORIGIN } from "../lib/hub-api.ts";

type ExpectedAuditEvent = Omit<
  AuditEvent,
  "audit_event_id" | "created_at" | "entity_id"
> & {
  entityID?: string;
};

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

function expectOneAuditEvent(
  events: AuditEvent[],
  expected: ExpectedAuditEvent,
): AuditEvent {
  expect(events).toHaveLength(1);
  const event = events[0];
  if (event === undefined) throw new Error("expected one audit event");
  const { entityID, payload, ...expectedFields } = expected;
  expect(event).toMatchObject(expectedFields);
  expect(event.payload).toEqual(payload);
  expect(event.audit_event_id).toMatch(/^[0-9a-f-]{36}$/);
  if (entityID === undefined) {
    expect(event.entity_id).toMatch(/^[0-9a-f-]{36}$/);
  } else {
    expect(event.entity_id).toBe(entityID);
  }
  expect(Number.isNaN(Date.parse(event.created_at))).toBe(false);
  return event;
}

function expectActorEvent(
  event: AuditEvent,
  expected: {
    action: string;
    actorID: string;
    entityType: string;
  },
): void {
  expect(event).toMatchObject({
    tenant_id: "sgp",
    action: expected.action,
    entity_type: expected.entityType,
    actor_type: "hub_user",
    actor_id: expected.actorID,
    source: "hub-api",
    idempotency_key: null,
  });
  expect(event.entity_id).toMatch(/^[0-9a-f-]{36}$/);
}

test("Hub signup, sign-in, and password writes have atomic audit events", async ({
  adminAPI,
  managerToken,
  ownedDomain,
  request,
}) => {
  const domain = ownedDomain("hub-audit");
  const emailAddress = `e2e+${randomUUID()}@${domain}`;
  const missingEmailAddress = `e2e+${randomUUID()}@${domain}`;
  const initialPassword = `Initial!${randomUUID()}-password`;
  const changedPassword = `Changed!${randomUUID()}-password`;
  const resetPassword = `Reset!${randomUUID()}-password`;
  const hub = new HubAPI(request);
  let removeAuditFailure: (() => void) | undefined;

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
      display_name: "Audit Person",
      preferred_language: "en-US" as const,
      resident_country: "USA",
    };
    removeAuditFailure = installHubAuditInsertFailure({
      action: "hub.signup.requested",
      idempotencyKey: signupKey,
    });
    await expectProblem(
      await hub.post("/request-signup", signupRequest, {
        idempotencyKey: signupKey,
      }),
      500,
      "vetchium-problem-details/internal-server-error",
    );
    expect(hubSignupArtifactCounts(emailAddress, signupKey)).toEqual({
      auditEvents: 0,
      idempotencyRows: 0,
      outboxItems: 0,
      signupRequests: 0,
    });
    removeAuditFailure();
    removeAuditFailure = undefined;

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
        { ...signupRequest, display_name: "Conflicting Audit Person" },
        { idempotencyKey: signupKey },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );
    expect(
      (
        await hub.post("/request-signup", signupRequest, {
          idempotencyKey: signupKey,
        })
      ).status(),
    ).toBe(202);
    const signupRequested = expectOneAuditEvent(
      hubAuditEventsByIdempotencyKey(signupKey),
      {
        tenant_id: "sgp",
        action: "hub.signup.requested",
        entity_type: "hub_signup_request",
        actor_type: "anonymous",
        actor_id: null,
        source: "hub-api",
        idempotency_key: signupKey,
        payload: {
          preferred_language: "en-US",
          resident_country: "USA",
          email_queued: true,
        },
      },
    );

    const signupEmail = await latestEmailText(
      request,
      emailAddress,
      "complete your Vetchium signup",
    );
    const signupToken = actionToken(signupEmail, "/complete-signup");
    const invalidSignupKey = hubIdempotencyKey();
    await expectProblem(
      await hub.post(
        "/complete-signup",
        { signup_token: "x".repeat(43), password: initialPassword },
        { idempotencyKey: invalidSignupKey },
      ),
      401,
      "vetchium-problem-details/hub-invalid-signup-token",
    );
    expect(hubAuditEventsByIdempotencyKey(invalidSignupKey)).toEqual([]);

    const completeSignupKey = hubIdempotencyKey();
    const completeSignupRequest = {
      signup_token: signupToken,
      password: initialPassword,
    };
    removeAuditFailure = installHubAuditInsertFailure({
      action: "hub.user.created",
      idempotencyKey: completeSignupKey,
    });
    await expectProblem(
      await hub.post("/complete-signup", completeSignupRequest, {
        idempotencyKey: completeSignupKey,
      }),
      500,
      "vetchium-problem-details/internal-server-error",
    );
    expect(
      hubSignupCompletionArtifactCounts(emailAddress, completeSignupKey),
    ).toEqual({
      activeSignupRequests: 1,
      auditEvents: 0,
      hubUsers: 0,
      idempotencyRows: 0,
    });
    removeAuditFailure();
    removeAuditFailure = undefined;

    const completedResponse = await hub.post(
      "/complete-signup",
      completeSignupRequest,
      { idempotencyKey: completeSignupKey },
    );
    expect(completedResponse.status(), await completedResponse.text()).toBe(
      201,
    );
    const completed =
      await responseJSON<CompleteSignupResponse>(completedResponse);
    expect(
      (
        await hub.post("/complete-signup", completeSignupRequest, {
          idempotencyKey: completeSignupKey,
        })
      ).status(),
    ).toBe(201);
    await expectProblem(
      await hub.post(
        "/complete-signup",
        {
          ...completeSignupRequest,
          password: `Conflicting!${randomUUID()}-password`,
        },
        { idempotencyKey: completeSignupKey },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );
    const userCreated = expectOneAuditEvent(
      hubAuditEventsByIdempotencyKey(completeSignupKey),
      {
        tenant_id: "sgp",
        action: "hub.user.created",
        entity_type: "hub_user",
        entityID: completed.hub_user_did,
        actor_type: "anonymous",
        actor_id: null,
        source: "hub-api",
        idempotency_key: completeSignupKey,
        payload: { handle: completed.handle },
      },
    );

    await expectProblem(
      await hub.post("/login", {
        email_address: emailAddress,
        password: "incorrect-password",
      }),
      401,
      "vetchium-problem-details/hub-invalid-credentials",
    );
    expect(
      hubAuditEventsForActor(completed.hub_user_did, "hub.session.created"),
    ).toEqual([]);

    removeAuditFailure = installHubAuditInsertFailure({
      action: "hub.session.created",
      actorID: completed.hub_user_did,
    });
    await expectProblem(
      await hub.post("/login", {
        email_address: emailAddress,
        password: initialPassword,
      }),
      500,
      "vetchium-problem-details/internal-server-error",
    );
    expect(hubSessionCount(completed.hub_user_did)).toBe(0);
    expect(
      hubAuditEventsForActor(completed.hub_user_did, "hub.session.created"),
    ).toEqual([]);
    removeAuditFailure();
    removeAuditFailure = undefined;

    const firstLoginResponse = await hub.post("/login", {
      email_address: emailAddress,
      password: initialPassword,
      remember_me: false,
    });
    const firstLogin = await responseJSON<LoginResponse>(firstLoginResponse);
    expect(firstLogin.authentication_state).toBe("authenticated");
    if (firstLogin.authentication_state !== "authenticated") {
      throw new Error("unexpected TFA challenge");
    }
    const rememberedLoginResponse = await hub.post("/login", {
      email_address: emailAddress,
      password: initialPassword,
      remember_me: true,
    });
    const rememberedLogin = await responseJSON<LoginResponse>(
      rememberedLoginResponse,
    );
    expect(rememberedLogin.authentication_state).toBe("authenticated");
    if (rememberedLogin.authentication_state !== "authenticated") {
      throw new Error("unexpected TFA challenge");
    }
    const sessionEvents = hubAuditEventsForActor(
      completed.hub_user_did,
      "hub.session.created",
    );
    expect(sessionEvents).toHaveLength(2);
    for (const event of sessionEvents) {
      expectActorEvent(event, {
        action: "hub.session.created",
        actorID: completed.hub_user_did,
        entityType: "hub_session",
      });
    }
    expect(
      sessionEvents
        .map((event) => event.payload)
        .sort((left, right) =>
          String(left.remembered).localeCompare(String(right.remembered)),
        ),
    ).toEqual([{ remembered: false }, { remembered: true }]);
    expect(hubSessionCount(completed.hub_user_did)).toBe(2);

    expect(
      (
        await hub.post(
          "/reauthenticate",
          { password: initialPassword },
          { token: firstLogin.session_token },
        )
      ).status(),
    ).toBe(200);
    const reauthenticated = expectOneAuditEvent(
      hubAuditEventsForActor(
        completed.hub_user_did,
        "hub.session.reauthenticated",
      ),
      {
        tenant_id: "sgp",
        action: "hub.session.reauthenticated",
        entity_type: "hub_session",
        actor_type: "hub_user",
        actor_id: completed.hub_user_did,
        source: "hub-api",
        idempotency_key: null,
        payload: { authentication_refreshed: true },
      },
    );

    const initialHash = hubPasswordHash(emailAddress);
    removeAuditFailure = installHubAuditInsertFailure({
      action: "hub.password.changed",
      actorID: completed.hub_user_did,
    });
    await expectProblem(
      await hub.post(
        "/change-password",
        { new_password: changedPassword },
        { token: firstLogin.session_token },
      ),
      500,
      "vetchium-problem-details/internal-server-error",
    );
    expect(hubPasswordHash(emailAddress)).toBe(initialHash);
    expect(hubSessionCount(completed.hub_user_did)).toBe(2);
    expect(
      hubAuditEventsForActor(completed.hub_user_did, "hub.password.changed"),
    ).toEqual([]);
    removeAuditFailure();
    removeAuditFailure = undefined;

    expect(
      (
        await hub.post(
          "/change-password",
          { new_password: changedPassword },
          { token: firstLogin.session_token },
        )
      ).status(),
    ).toBe(204);
    expect(hubPasswordHash(emailAddress)).not.toBe(initialHash);
    expect(hubSessionCount(completed.hub_user_did)).toBe(1);
    const passwordChanged = expectOneAuditEvent(
      hubAuditEventsForActor(completed.hub_user_did, "hub.password.changed"),
      {
        tenant_id: "sgp",
        action: "hub.password.changed",
        entity_type: "hub_user",
        entityID: completed.hub_user_did,
        actor_type: "hub_user",
        actor_id: completed.hub_user_did,
        source: "hub-api",
        idempotency_key: null,
        payload: {
          password_changed: true,
          other_sessions_revoked: true,
        },
      },
    );

    const missingResetKey = hubIdempotencyKey();
    expect(
      (
        await hub.post(
          "/request-password-reset",
          { email_address: missingEmailAddress },
          { idempotencyKey: missingResetKey },
        )
      ).status(),
    ).toBe(202);
    expect(hubAuditEventsByIdempotencyKey(missingResetKey)).toEqual([]);

    const resetKey = hubIdempotencyKey();
    const resetRequest = { email_address: emailAddress };
    expect(
      (
        await hub.post("/request-password-reset", resetRequest, {
          idempotencyKey: resetKey,
        })
      ).status(),
    ).toBe(202);
    expect(
      (
        await hub.post("/request-password-reset", resetRequest, {
          idempotencyKey: resetKey,
        })
      ).status(),
    ).toBe(202);
    const resetRequested = expectOneAuditEvent(
      hubAuditEventsByIdempotencyKey(resetKey),
      {
        tenant_id: "sgp",
        action: "hub.password-reset.requested",
        entity_type: "hub_password_reset",
        actor_type: "anonymous",
        actor_id: null,
        source: "hub-api",
        idempotency_key: resetKey,
        payload: { email_queued: true },
      },
    );
    const resetEmail = await latestEmailText(
      request,
      emailAddress,
      "reset your Vetchium password",
    );
    const resetToken = actionToken(resetEmail, "/reset-password");
    const invalidResetKey = hubIdempotencyKey();
    await expectProblem(
      await hub.post(
        "/complete-password-reset",
        { reset_token: "x".repeat(43), new_password: resetPassword },
        { idempotencyKey: invalidResetKey },
      ),
      401,
      "vetchium-problem-details/hub-invalid-password-reset-token",
    );
    expect(hubAuditEventsByIdempotencyKey(invalidResetKey)).toEqual([]);
    const completeResetKey = hubIdempotencyKey();
    const completeResetRequest = {
      reset_token: resetToken,
      new_password: resetPassword,
    };
    const changedHash = hubPasswordHash(emailAddress);
    removeAuditFailure = installHubAuditInsertFailure({
      action: "hub.password.reset",
      idempotencyKey: completeResetKey,
    });
    await expectProblem(
      await hub.post("/complete-password-reset", completeResetRequest, {
        idempotencyKey: completeResetKey,
      }),
      500,
      "vetchium-problem-details/internal-server-error",
    );
    expect(hubPasswordHash(emailAddress)).toBe(changedHash);
    expect(hubSessionCount(completed.hub_user_did)).toBe(1);
    expect(hubAuditEventsByIdempotencyKey(completeResetKey)).toEqual([]);
    removeAuditFailure();
    removeAuditFailure = undefined;

    expect(
      (
        await hub.post("/complete-password-reset", completeResetRequest, {
          idempotencyKey: completeResetKey,
        })
      ).status(),
    ).toBe(204);
    await expectProblem(
      await hub.post(
        "/complete-password-reset",
        {
          ...completeResetRequest,
          new_password: `Conflicting!${randomUUID()}-password`,
        },
        { idempotencyKey: completeResetKey },
      ),
      409,
      "vetchium-problem-details/idempotency-key-conflict",
    );
    expect(hubPasswordHash(emailAddress)).not.toBe(changedHash);
    expect(hubSessionCount(completed.hub_user_did)).toBe(0);
    expect(
      (
        await hub.post("/complete-password-reset", completeResetRequest, {
          idempotencyKey: completeResetKey,
        })
      ).status(),
    ).toBe(204);
    const passwordReset = expectOneAuditEvent(
      hubAuditEventsByIdempotencyKey(completeResetKey),
      {
        tenant_id: "sgp",
        action: "hub.password.reset",
        entity_type: "hub_user",
        entityID: completed.hub_user_did,
        actor_type: "anonymous",
        actor_id: null,
        source: "hub-api",
        idempotency_key: completeResetKey,
        payload: { password_changed: true, all_sessions_revoked: true },
      },
    );

    const auditText = JSON.stringify([
      signupRequested,
      userCreated,
      ...sessionEvents,
      reauthenticated,
      passwordChanged,
      resetRequested,
      passwordReset,
    ]);
    for (const sensitiveValue of [
      emailAddress,
      initialPassword,
      changedPassword,
      resetPassword,
      signupToken,
      resetToken,
      firstLogin.session_token,
      rememberedLogin.session_token,
      initialHash,
      changedHash,
    ]) {
      expect(auditText).not.toContain(sensitiveValue);
    }
  } finally {
    try {
      removeAuditFailure?.();
    } finally {
      try {
        cleanupHubUser(emailAddress);
      } finally {
        cleanupHubIdempotency(hub.idempotencyKeys);
      }
    }
  }
});
