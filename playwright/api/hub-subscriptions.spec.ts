import { randomUUID } from "node:crypto";
import type { APIResponse } from "@playwright/test";
import type { HubPlan } from "typespec/hub/subscriptions/plans";
import type {
  HubSubscription,
  SetSubscriptionPlanRequest,
} from "typespec/hub/subscriptions/subscriptions";
import {
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubSubscriptionAudit,
  cleanupHubUser,
  cleanupHubUserAuditEvents,
  databaseNow,
  expectHubUserSubscriptionRejected,
  type HeldRowLock,
  holdHubUserRowLock,
  hubSignupCompletionArtifactCounts,
  hubSubscriptionAuditEvents,
  installHubAuditInsertFailure,
  seedHubSignupDomain,
  setHubSubscriptionPeriod,
  setHubSubscriptionPeriods,
  setHubUserState,
  type TestTenant,
  waitForBlockedBy,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { boundary, boundaryPairEndingAt } from "../lib/billing-periods.ts";
import { HubAPI, hubIdempotencyKey, MAILPIT_ORIGIN } from "../lib/hub-api.ts";
import { login, signup } from "../lib/hub-signup.ts";

interface SetupUser {
  hubUserDID: string;
  email: string;
  token: string;
  keys: string[];
}

async function setupUser(
  hub: HubAPI,
  tenant: TestTenant,
  domain: string,
): Promise<SetupUser> {
  const email = `e2e+${randomUUID()}@${domain}`;
  const keys: string[] = [];
  const signedUp = await signup(hub.request, tenant, email, keys);
  const token = await login(hub.request, tenant, email, signedUp.password);
  return { hubUserDID: signedUp.hubUserDID, email, token, keys };
}

async function cleanupUser(user: SetupUser, tenant: TestTenant): Promise<void> {
  cleanupHubUserAuditEvents(user.hubUserDID, tenant);
  cleanupHubUser(user.email, tenant);
  cleanupHubIdempotency(user.keys, tenant);
}

async function upgradeToSilverMonthly(
  hub: HubAPI,
  user: SetupUser,
): Promise<HubSubscription> {
  const key = hubIdempotencyKey();
  user.keys.push(key);
  const response = await hub.setSubscriptionPlan(
    { plan_oid: "hub-silver-tier", billing_interval: "month" },
    { token: user.token, idempotencyKey: key },
  );
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as HubSubscription;
}

test.describe("billing period oracle", () => {
  test("boundary and boundaryPairEndingAt agree for every day of 2027 and 2028", () => {
    for (const interval of ["month", "year"] as const) {
      for (
        let day = new Date(Date.UTC(2027, 0, 1));
        day < new Date(Date.UTC(2029, 0, 1));
        day.setUTCDate(day.getUTCDate() + 1)
      ) {
        const end = new Date(
          Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            13,
            17,
            0,
          ),
        );
        const pair = boundaryPairEndingAt(end, interval);
        expect(pair.anchor.getTime()).toBeLessThanOrEqual(pair.start.getTime());
        expect(pair.start.getTime()).toBeLessThan(pair.end.getTime());
        expect(pair.end.getTime()).toBe(end.getTime());
      }
    }
  });

  test("Jan 31 and Feb 29 anchor examples", () => {
    const monthlyAnchor = new Date(Date.UTC(2027, 0, 31));
    expect(boundary(monthlyAnchor, "month", 1).toISOString()).toBe(
      new Date(Date.UTC(2027, 1, 28)).toISOString(),
    );
    expect(boundary(monthlyAnchor, "month", 2).toISOString()).toBe(
      new Date(Date.UTC(2027, 2, 31)).toISOString(),
    );
    expect(boundary(monthlyAnchor, "month", 3).toISOString()).toBe(
      new Date(Date.UTC(2027, 3, 30)).toISOString(),
    );
    const annualAnchor = new Date(Date.UTC(2028, 1, 29));
    expect(boundary(annualAnchor, "year", 1).toISOString()).toBe(
      new Date(Date.UTC(2029, 1, 28)).toISOString(),
    );
  });

  test("the maximum annual search bound", () => {
    const pair = boundaryPairEndingAt(new Date(Date.UTC(2104, 1, 29)), "year");
    expect(pair.anchor.toISOString()).toBe(
      new Date(Date.UTC(2096, 1, 29)).toISOString(),
    );
  });

  test("the maximum monthly search bound", () => {
    const pair = boundaryPairEndingAt(new Date(Date.UTC(2027, 2, 31)), "month");
    expect(pair.anchor.toISOString()).toBe(
      new Date(Date.UTC(2027, 0, 31)).toISOString(),
    );
  });
});

test("signup creates the free subscription", async ({
  request,
  ownedDomain,
}) => {
  const domain = ownedDomain("subs-signup");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request);
  const user = await setupUser(hub, "sgp", domain);
  try {
    const response = await hub.mySubscription(user.token);
    expect(response.status(), await response.text()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body = (await response.json()) as HubSubscription;
    expect(body).toEqual({
      plan_oid: "hub-free-tier",
      cancel_at_period_end: false,
    });
    const events = hubSubscriptionAuditEvents(user.hubUserDID, "sgp");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "hub.subscription.created",
      entity_type: "hub_subscription",
      actor_type: "anonymous",
      source: "hub-api",
      payload: { hub_plan_oid: "hub-free-tier" },
    });
  } finally {
    await cleanupUser(user, "sgp");
  }
});

test("signup rollback on subscription audit failure leaves no user", async ({
  request,
  ownedDomain,
}) => {
  const domain = ownedDomain("subs-rollback");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request);
  const email = `e2e+${randomUUID()}@${domain}`;
  const keys: string[] = [];
  let removeFailure: (() => void) | undefined;
  let createdDID: string | undefined;
  try {
    const signupKey = hubIdempotencyKey();
    const completeKey = hubIdempotencyKey();
    keys.push(signupKey, completeKey);
    const requestResponse = await hub.post(
      "/request-signup",
      {
        email_address: email,
        display_name: "Rollback User",
        preferred_language: "en-US",
        resident_country: "FR",
      },
      { idempotencyKey: signupKey },
    );
    expect(requestResponse.status(), await requestResponse.text()).toBe(202);

    const mailbox = `${MAILPIT_ORIGIN}/view/latest.txt?query=${encodeURIComponent(`to:${email}`)}`;
    let text = "";
    await expect
      .poll(
        async () => {
          const mail = await request.get(mailbox);
          text = mail.ok() ? await mail.text() : "";
          return text;
        },
        { timeout: 15000 },
      )
      .toContain(`${hub.origin}/complete-signup`);
    const token = text.match(/complete-signup\?token=([0-9a-f]{64})/)?.[1];
    expect(token).toBeDefined();

    removeFailure = installHubAuditInsertFailure({
      action: "hub.subscription.created",
      idempotencyKey: completeKey,
    });
    const completeResponse = await hub.post(
      "/complete-signup",
      { signup_token: token, password: `Password!${randomUUID()}` },
      { idempotencyKey: completeKey },
    );
    expect(completeResponse.status(), await completeResponse.text()).toBe(500);
    removeFailure();
    removeFailure = undefined;

    expect(hubSignupCompletionArtifactCounts(email, completeKey)).toEqual({
      activeSignupRequests: 1,
      auditEvents: 0,
      hubUsers: 0,
      idempotencyRows: 0,
    });

    // The signup request survived, so completion can be retried.
    const retry = await hub.post(
      "/complete-signup",
      { signup_token: token, password: `Password!${randomUUID()}` },
      { idempotencyKey: hubIdempotencyKey() },
    );
    keys.push(...hub.idempotencyKeys);
    expect(retry.status(), await retry.text()).toBe(201);
    const created = (await retry.json()) as { hub_user_did: string };
    createdDID = created.hub_user_did;
  } finally {
    removeFailure?.();
    if (createdDID !== undefined) {
      cleanupHubSubscriptionAudit(createdDID, "sgp");
    }
    cleanupHubUser(email, "sgp");
    cleanupHubIdempotency(keys, "sgp");
  }
});

test("GET my-subscription requires authentication", async ({
  request,
  ownedDomain,
}) => {
  const domain = ownedDomain("subs-auth");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request);
  const user = await setupUser(hub, "sgp", domain);
  try {
    const invalidToken = await hub.mySubscription("not-a-real-token");
    expect(invalidToken.status()).toBe(401);
    expect(invalidToken.headers()["www-authenticate"]).toBe(
      'Bearer realm="hub"',
    );

    const noToken = await hub.get("/my-subscription", "");
    expect(noToken.status()).toBe(401);
    expect(noToken.headers()["www-authenticate"]).toBe('Bearer realm="hub"');

    setHubUserState(user.email, "disabled");
    const disabled = await hub.mySubscription(user.token);
    expect(disabled.status()).toBe(401);
    expect(disabled.headers()["www-authenticate"]).toBe('Bearer realm="hub"');
  } finally {
    await cleanupUser(user, "sgp");
  }
});

test("POST set-subscription-plan rejects malformed and invalid requests", async ({
  request,
  ownedDomain,
}) => {
  const domain = ownedDomain("subs-validate");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request);
  const user = await setupUser(hub, "sgp", domain);
  try {
    const baseline = await hub.mySubscription(user.token);
    const baselineBody = await baseline.json();
    const baselineAuditCount = hubSubscriptionAuditEvents(
      user.hubUserDID,
      "sgp",
    ).length;

    for (const body of [
      '{"plan_oid":',
      '{"plan_oid":"hub-silver-tier","billing_interval":1}',
    ]) {
      const response = await hub.setSubscriptionPlanRaw(body, {
        token: user.token,
        idempotencyKey: hubIdempotencyKey(),
      });
      expect(response.status()).toBe(400);
      expect(await response.json()).toMatchObject({
        type: "vetchium-problem-details/invalid-json",
      });
    }

    for (const [body, fields] of [
      [{ plan_oid: "hub-gold-tier" }, ["plan_oid"]],
      [
        { plan_oid: "hub-free-tier", billing_interval: "month" },
        ["billing_interval"],
      ],
      [
        { plan_oid: "hub-free-tier", billing_interval: null },
        ["billing_interval"],
      ],
      [{ plan_oid: "hub-silver-tier" }, ["billing_interval"]],
      [
        { plan_oid: "hub-silver-tier", billing_interval: null },
        ["billing_interval"],
      ],
      [
        { plan_oid: "hub-silver-tier", billing_interval: "week" },
        ["billing_interval"],
      ],
    ] as const) {
      const response = await hub.setSubscriptionPlanRaw(body, {
        token: user.token,
        idempotencyKey: hubIdempotencyKey(),
      });
      expect(response.status(), JSON.stringify(body)).toBe(400);
      const problem = await response.json();
      expect(problem.type).toBe("vetchium-problem-details/validation-failed");
      expect(problem.fields).toEqual(fields);
    }

    const missingKey = await hub.request.post(
      `${hub.origin}/api/hub/set-subscription-plan`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.token}`,
        },
        data: { plan_oid: "hub-free-tier" },
      },
    );
    expect(missingKey.status()).toBe(400);
    expect(await missingKey.json()).toMatchObject({
      type: "vetchium-problem-details/validation-failed",
      fields: ["Idempotency-Key"],
    });

    const malformedKey = await hub.request.post(
      `${hub.origin}/api/hub/set-subscription-plan`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.token}`,
          "Idempotency-Key": "too-short",
        },
        data: { plan_oid: "hub-free-tier" },
      },
    );
    expect(malformedKey.status()).toBe(400);
    expect(await malformedKey.json()).toMatchObject({
      type: "vetchium-problem-details/validation-failed",
      fields: ["Idempotency-Key"],
    });

    const noToken = await hub.setSubscriptionPlanRaw(
      { plan_oid: "hub-free-tier" },
      { idempotencyKey: hubIdempotencyKey() },
    );
    expect(noToken.status()).toBe(401);
    expect(noToken.headers()["www-authenticate"]).toBe('Bearer realm="hub"');

    const stillValid = await hub.mySubscription(user.token);
    expect(await stillValid.json()).toEqual(baselineBody);
    expect(hubSubscriptionAuditEvents(user.hubUserDID, "sgp")).toHaveLength(
      baselineAuditCount,
    );

    setHubUserState(user.email, "disabled");
    const disabledAttempt = await hub.setSubscriptionPlanRaw(
      { plan_oid: "hub-free-tier" },
      { token: user.token, idempotencyKey: hubIdempotencyKey() },
    );
    expect(disabledAttempt.status()).toBe(401);
    expect(disabledAttempt.headers()["www-authenticate"]).toBe(
      'Bearer realm="hub"',
    );

    const finalCheck = await hub.mySubscription(user.token);
    expect(finalCheck.status()).toBe(401);
    expect(hubSubscriptionAuditEvents(user.hubUserDID, "sgp")).toHaveLength(
      baselineAuditCount,
    );
  } finally {
    await cleanupUser(user, "sgp");
  }
});

test("a plan the tenant does not offer is refused", async ({ request }) => {
  const domain = `e2e-subs-usa1-${randomUUID()}.example.test`;
  seedHubSignupDomain(domain, "usa1");
  const hub = new HubAPI(request, "usa1");
  const user = await setupUser(hub, "usa1", domain);
  try {
    const rejected = await hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "month" },
      { token: user.token, idempotencyKey: hubIdempotencyKey() },
    );
    expect(rejected.status(), await rejected.text()).toBe(403);
    expect(await rejected.json()).toMatchObject({
      type: "vetchium-problem-details/hub-plan-not-offered",
    });
    const after = await hub.mySubscription(user.token);
    expect(await after.json()).toMatchObject({ plan_oid: "hub-free-tier" });
    expect(hubSubscriptionAuditEvents(user.hubUserDID, "usa1")).toHaveLength(1);

    const acceptedKey = hubIdempotencyKey();
    user.keys.push(acceptedKey);
    const accepted = await hub.setSubscriptionPlan(
      { plan_oid: "hub-free-tier" },
      { token: user.token, idempotencyKey: acceptedKey },
    );
    expect(accepted.status(), await accepted.text()).toBe(200);
    expect(await accepted.json()).toEqual({
      plan_oid: "hub-free-tier",
      cancel_at_period_end: false,
    });
    expect(hubSubscriptionAuditEvents(user.hubUserDID, "usa1")).toHaveLength(1);
  } finally {
    await cleanupUser(user, "usa1");
    cleanupHubSignupDomain(domain, "usa1");
  }
});

test("an upgrade from free to silver monthly starts a new period", async ({
  request,
  ownedDomain,
}) => {
  const domain = ownedDomain("subs-upgrade");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request);
  const user = await setupUser(hub, "sgp", domain);
  try {
    const before = Date.now();
    const body = await upgradeToSilverMonthly(hub, user);
    const after = Date.now();
    expect(body.plan_oid).toBe("hub-silver-tier");
    expect(body.billing_interval).toBe("month");
    const start = Date.parse(body.current_period_start ?? "");
    expect(start).toBeGreaterThanOrEqual(before - 5000);
    expect(start).toBeLessThanOrEqual(after + 5000);
    const end = Date.parse(body.current_period_end ?? "");
    expect(end).toBe(boundary(new Date(start), "month", 1).getTime());

    const got = await hub.mySubscription(user.token);
    expect(await got.json()).toEqual(body);

    const events = hubSubscriptionAuditEvents(user.hubUserDID, "sgp");
    const upgraded = events.filter(
      (event) => event.action === "hub.subscription.upgraded",
    );
    expect(upgraded).toHaveLength(1);
    expect(upgraded[0]).toMatchObject({ actor_type: "hub_user" });
    const payload = upgraded[0]?.payload as {
      before: { hub_plan_oid: string };
      after: { subscription_anchor_at: string };
    };
    expect(payload.before.hub_plan_oid).toBe("hub-free-tier");
    expect(Date.parse(payload.after.subscription_anchor_at)).toBe(start);
  } finally {
    await cleanupUser(user, "sgp");
  }
});

test("idempotency replays and conflicts", async ({ request, ownedDomain }) => {
  const domain = ownedDomain("subs-idem");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request);
  const user = await setupUser(hub, "sgp", domain);
  try {
    const key = hubIdempotencyKey();
    user.keys.push(key);
    const first = await hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "month" },
      { token: user.token, idempotencyKey: key },
    );
    expect(first.status(), await first.text()).toBe(200);
    const firstBody = await first.json();

    const replay = await hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "month" },
      { token: user.token, idempotencyKey: key },
    );
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(firstBody);
    expect(
      hubSubscriptionAuditEvents(user.hubUserDID, "sgp").filter(
        (event) => event.action === "hub.subscription.upgraded",
      ),
    ).toHaveLength(1);

    const conflict = await hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "year" },
      { token: user.token, idempotencyKey: key },
    );
    expect(conflict.status()).toBe(409);
    expect(await conflict.json()).toMatchObject({
      type: "vetchium-problem-details/idempotency-key-conflict",
    });
  } finally {
    await cleanupUser(user, "sgp");
  }
});

test("every plan change rule", async ({ request, ownedDomain }) => {
  const domain = ownedDomain("subs-change");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request);
  const user = await setupUser(hub, "sgp", domain);
  try {
    await upgradeToSilverMonthly(hub, user);

    async function change(
      planOID: HubPlan,
      interval?: "month" | "year",
    ): Promise<HubSubscription> {
      const key = hubIdempotencyKey();
      user.keys.push(key);
      const body: SetSubscriptionPlanRequest = { plan_oid: planOID };
      if (interval !== undefined) body.billing_interval = interval;
      const response = await hub.setSubscriptionPlan(body, {
        token: user.token,
        idempotencyKey: key,
      });
      expect(response.status(), await response.text()).toBe(200);
      const responseBody = (await response.json()) as HubSubscription;
      const got = await hub.mySubscription(user.token);
      expect(await got.json()).toEqual(responseBody);
      return responseBody;
    }

    const annual = await change("hub-silver-tier", "year");
    expect(annual.billing_interval).toBe("year");
    expect(annual.scheduled_change).toBeUndefined();
    expect(
      hubSubscriptionAuditEvents(user.hubUserDID, "sgp").filter(
        (e) => e.action === "hub.subscription.upgraded",
      ),
    ).toHaveLength(2);

    const backToMonthly = await change("hub-silver-tier", "month");
    expect(backToMonthly.billing_interval).toBe("year");
    expect(backToMonthly.scheduled_change).toEqual({
      plan_oid: "hub-silver-tier",
      billing_interval: "month",
    });
    expect(
      hubSubscriptionAuditEvents(user.hubUserDID, "sgp").filter(
        (e) => e.action === "hub.subscription.change-scheduled",
      ),
    ).toHaveLength(1);

    const clearedSchedule = await change("hub-silver-tier", "year");
    expect(clearedSchedule.scheduled_change).toBeUndefined();
    expect(
      hubSubscriptionAuditEvents(user.hubUserDID, "sgp").filter(
        (e) => e.action === "hub.subscription.scheduled-change-cleared",
      ),
    ).toHaveLength(1);

    // Schedules a downgrade to monthly; the period move below applies it, so
    // the steps that follow act on an actual monthly plan, not annual.
    const monthlyAgain = await change("hub-silver-tier", "month");
    expect(monthlyAgain.billing_interval).toBe("year");
    expect(monthlyAgain.scheduled_change).toEqual({
      plan_oid: "hub-silver-tier",
      billing_interval: "month",
    });

    const now = databaseNow("sgp");
    const pair = boundaryPairEndingAt(now, "year");
    setHubSubscriptionPeriod(user.hubUserDID, "sgp", pair);
    await expect
      .poll(
        async () => {
          const response = await hub.mySubscription(user.token);
          const body = (await response.json()) as HubSubscription;
          return body.billing_interval;
        },
        { timeout: 30_000, intervals: [500] },
      )
      .toBe("month");

    const cancellation = await change("hub-free-tier");
    expect(cancellation.cancel_at_period_end).toBe(true);
    expect(cancellation.scheduled_change).toEqual({
      plan_oid: "hub-free-tier",
    });
    expect(
      hubSubscriptionAuditEvents(user.hubUserDID, "sgp").filter(
        (e) => e.action === "hub.subscription.change-scheduled",
      ),
    ).toHaveLength(3);

    // An upgrade (monthly to annual) while a cancellation is scheduled
    // clears the cancellation and applies immediately.
    const upgradeClearsCancellation = await change("hub-silver-tier", "year");
    expect(upgradeClearsCancellation.cancel_at_period_end).toBe(false);
    expect(upgradeClearsCancellation.scheduled_change).toBeUndefined();
    expect(upgradeClearsCancellation.billing_interval).toBe("year");
    expect(
      hubSubscriptionAuditEvents(user.hubUserDID, "sgp").filter(
        (e) => e.action === "hub.subscription.upgraded",
      ),
    ).toHaveLength(3);

    const unchangedEventsBefore = hubSubscriptionAuditEvents(
      user.hubUserDID,
      "sgp",
    ).length;
    const unchanged = await change("hub-silver-tier", "year");
    expect(unchanged.scheduled_change).toBeUndefined();
    expect(hubSubscriptionAuditEvents(user.hubUserDID, "sgp")).toHaveLength(
      unchangedEventsBefore,
    );
  } finally {
    await cleanupUser(user, "sgp");
  }
});

test("renewal advances many periods", async ({ request, ownedDomain }) => {
  test.setTimeout(60_000);
  const domain = ownedDomain("subs-renew");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request);
  const user = await setupUser(hub, "sgp", domain);
  try {
    await upgradeToSilverMonthly(hub, user);
    const now = databaseNow("sgp");
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1),
    );
    const end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
    );
    setHubSubscriptionPeriod(user.hubUserDID, "sgp", {
      anchor: start,
      start,
      end,
    });

    // GET computes the same transition in memory, so it would show the
    // renewed period even before the worker commits anything. The audit
    // trail is the only proof the worker itself applied it.
    await expect
      .poll(
        () =>
          hubSubscriptionAuditEvents(user.hubUserDID, "sgp").filter(
            (event) => event.action === "hub.subscription.renewed",
          ).length,
        { timeout: 30_000, intervals: [500] },
      )
      .toBeGreaterThan(0);

    const events = hubSubscriptionAuditEvents(user.hubUserDID, "sgp").filter(
      (event) => event.action === "hub.subscription.renewed",
    );
    expect(events).toHaveLength(1);
    const renewedEvent = events[0];
    if (renewedEvent === undefined) throw new Error("expected one event");
    expect(renewedEvent.actor_type).toBe("worker");
    expect(renewedEvent.source).toBe("workers");
    const payload = renewedEvent.payload as { periods_advanced?: number };
    expect(payload.periods_advanced ?? 0).toBeGreaterThanOrEqual(3);

    const response = await hub.mySubscription(user.token);
    const body = (await response.json()) as HubSubscription;
    const dbNow = databaseNow("sgp");
    let k = 0;
    while (boundary(start, "month", k + 1).getTime() <= dbNow.getTime()) k++;
    expect(Date.parse(body.current_period_start ?? "")).toBe(
      boundary(start, "month", k).getTime(),
    );
    expect(Date.parse(body.current_period_end ?? "")).toBe(
      boundary(start, "month", k + 1).getTime(),
    );
  } finally {
    await cleanupUser(user, "sgp");
  }
});

test("a scheduled cancellation is applied by the worker", async ({
  request,
  ownedDomain,
}) => {
  test.setTimeout(60_000);
  const domain = ownedDomain("subs-cancel-wk");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request);
  const user = await setupUser(hub, "sgp", domain);
  try {
    await upgradeToSilverMonthly(hub, user);
    const cancelKey = hubIdempotencyKey();
    user.keys.push(cancelKey);
    const scheduled = await hub.setSubscriptionPlan(
      { plan_oid: "hub-free-tier" },
      { token: user.token, idempotencyKey: cancelKey },
    );
    expect(scheduled.status()).toBe(200);

    const now = databaseNow("sgp");
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
    );
    setHubSubscriptionPeriod(user.hubUserDID, "sgp", {
      anchor: start,
      start,
      end,
    });

    await expect
      .poll(
        () =>
          hubSubscriptionAuditEvents(user.hubUserDID, "sgp").filter(
            (e) => e.action === "hub.subscription.scheduled-change-applied",
          ).length,
        { timeout: 30_000, intervals: [500] },
      )
      .toBeGreaterThan(0);

    const finalResponse = await hub.mySubscription(user.token);
    const finalBody = (await finalResponse.json()) as HubSubscription;
    expect(finalBody.plan_oid).toBe("hub-free-tier");

    const events = hubSubscriptionAuditEvents(user.hubUserDID, "sgp");
    const applied = events.filter(
      (e) => e.action === "hub.subscription.scheduled-change-applied",
    );
    expect(applied).toHaveLength(1);
    expect(applied[0]?.actor_type).toBe("worker");
    expect(applied[0]?.source).toBe("workers");
    expect(
      events.filter((e) => e.action === "hub.subscription.renewed"),
    ).toHaveLength(0);
  } finally {
    await cleanupUser(user, "sgp");
  }
});

test("a scheduled interval change catches up across further periods", async ({
  request,
  ownedDomain,
}) => {
  test.setTimeout(60_000);
  const domain = ownedDomain("subs-catchup");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request);
  const user = await setupUser(hub, "sgp", domain);
  try {
    await upgradeToSilverMonthly(hub, user);
    const annualKey = hubIdempotencyKey();
    user.keys.push(annualKey);
    expect(
      (
        await hub.setSubscriptionPlan(
          { plan_oid: "hub-silver-tier", billing_interval: "year" },
          { token: user.token, idempotencyKey: annualKey },
        )
      ).status(),
    ).toBe(200);
    const monthlyKey = hubIdempotencyKey();
    user.keys.push(monthlyKey);
    expect(
      (
        await hub.setSubscriptionPlan(
          { plan_oid: "hub-silver-tier", billing_interval: "month" },
          { token: user.token, idempotencyKey: monthlyKey },
        )
      ).status(),
    ).toBe(200);

    const now = databaseNow("sgp");
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 14, 1),
    );
    const end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 12, 1),
    );
    setHubSubscriptionPeriod(user.hubUserDID, "sgp", {
      anchor: start,
      start,
      end,
    });

    await expect
      .poll(
        () =>
          hubSubscriptionAuditEvents(user.hubUserDID, "sgp").filter(
            (e) => e.action === "hub.subscription.renewed",
          ).length,
        { timeout: 30_000, intervals: [500] },
      )
      .toBeGreaterThan(0);

    const finalResponse = await hub.mySubscription(user.token);
    const finalBody = (await finalResponse.json()) as HubSubscription;
    expect(finalBody.billing_interval).toBe("month");
    expect(finalBody.current_period_start).toMatch(/T00:00:00/);
    expect(new Date(finalBody.current_period_start ?? "").getUTCDate()).toBe(1);
    const finalStart = Date.parse(finalBody.current_period_start ?? "");
    const finalEnd = Date.parse(finalBody.current_period_end ?? "");
    expect(finalEnd).toBe(boundary(new Date(finalStart), "month", 1).getTime());
    const dbNow = databaseNow("sgp").getTime();
    expect(finalStart).toBeLessThanOrEqual(dbNow);
    expect(finalEnd).toBeGreaterThan(dbNow);

    const events = hubSubscriptionAuditEvents(user.hubUserDID, "sgp");
    const applied = events.filter(
      (e) => e.action === "hub.subscription.scheduled-change-applied",
    );
    const renewed = events.filter(
      (e) => e.action === "hub.subscription.renewed",
    );
    expect(applied).toHaveLength(1);
    expect(renewed).toHaveLength(1);
    const appliedEvent = applied[0];
    const renewedEvent = renewed[0];
    if (appliedEvent === undefined || renewedEvent === undefined) {
      throw new Error("expected both events to be present");
    }
    const appliedPayload = appliedEvent.payload as {
      after: { subscription_anchor_at: string };
    };
    const renewedPayload = renewedEvent.payload as {
      before?: unknown;
      periods_advanced?: number;
    };
    expect(renewedPayload.before).toEqual(appliedPayload.after);
    expect(renewedPayload.periods_advanced ?? 0).toBeGreaterThanOrEqual(2);
    expect(Date.parse(appliedPayload.after.subscription_anchor_at)).toBe(
      end.getTime(),
    );
  } finally {
    await cleanupUser(user, "sgp");
  }
});

test("an audit failure rolls back the subscription change", async ({
  request,
  ownedDomain,
}) => {
  const domain = ownedDomain("subs-audit-fail");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request);
  const user = await setupUser(hub, "sgp", domain);
  let removeFailure: (() => void) | undefined;
  try {
    removeFailure = installHubAuditInsertFailure({
      action: "hub.subscription.upgraded",
      actorID: user.hubUserDID,
    });
    const key = hubIdempotencyKey();
    user.keys.push(key);
    const response = await hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "month" },
      { token: user.token, idempotencyKey: key },
    );
    expect(response.status()).toBe(500);
    removeFailure();
    removeFailure = undefined;

    const after = await hub.mySubscription(user.token);
    expect(await after.json()).toMatchObject({ plan_oid: "hub-free-tier" });
  } finally {
    removeFailure?.();
    await cleanupUser(user, "sgp");
  }
});

test("the worker skips a committed due row a user change holds", async ({
  request,
  ownedDomain,
}) => {
  test.setTimeout(120_000);
  const domain = ownedDomain("subs-worker-skip");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request, "sgp");
  const userA = await setupUser(hub, "sgp", domain);
  const userB = await setupUser(hub, "sgp", domain);
  let lock: HeldRowLock | undefined;
  let pending: Promise<APIResponse> | undefined;
  try {
    await upgradeToSilverMonthly(hub, userA);
    await upgradeToSilverMonthly(hub, userB);

    const targetTime = new Date(databaseNow("sgp").getTime() + 15_000);
    const pairA = boundaryPairEndingAt(targetTime, "month");
    const pairB = boundaryPairEndingAt(
      new Date(targetTime.getTime() + 2000),
      "month",
    );
    setHubSubscriptionPeriods("sgp", [
      [userA.hubUserDID, pairA],
      [userB.hubUserDID, pairB],
    ]);

    lock = await holdHubUserRowLock(userA.hubUserDID, "sgp");
    expect(lock.lockedAt.getTime()).toBeLessThan(targetTime.getTime());

    const upgradeKey = hubIdempotencyKey();
    userA.keys.push(upgradeKey);
    pending = hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "year" },
      { token: userA.token, idempotencyKey: upgradeKey, timeout: 60_000 },
    );
    await waitForBlockedBy("sgp", lock.holderPID, 1);

    const deadline =
      pairB.end.getTime() - databaseNow("sgp").getTime() + 10_000;
    await expect
      .poll(
        () =>
          hubSubscriptionAuditEvents(userB.hubUserDID, "sgp").filter(
            (e) => e.action === "hub.subscription.renewed",
          ).length,
        { timeout: Math.max(deadline, 5000), intervals: [500] },
      )
      .toBeGreaterThan(0);

    expect(
      hubSubscriptionAuditEvents(userA.hubUserDID, "sgp").filter(
        (e) =>
          e.action === "hub.subscription.renewed" ||
          e.action === "hub.subscription.scheduled-change-applied",
      ),
    ).toHaveLength(0);

    const futureEnd = new Date(databaseNow("sgp").getTime() + 30 * 86_400_000);
    const futurePair = boundaryPairEndingAt(futureEnd, "month");
    await lock.release(futurePair);
    lock = undefined;

    const response = await pending;
    pending = undefined;
    expect(response.status(), await response.text()).toBe(200);
    const body = (await response.json()) as HubSubscription;
    expect(body.plan_oid).toBe("hub-silver-tier");
    expect(body.billing_interval).toBe("year");
    expect(Date.parse(body.current_period_start ?? "")).toBeGreaterThan(
      targetTime.getTime(),
    );
    const got = await hub.mySubscription(userA.token);
    expect(await got.json()).toEqual(body);

    const upgradedByKey = hubSubscriptionAuditEvents(
      userA.hubUserDID,
      "sgp",
    ).filter(
      (e) =>
        e.action === "hub.subscription.upgraded" &&
        e.idempotency_key === upgradeKey,
    );
    expect(upgradedByKey).toHaveLength(1);
  } finally {
    await lock?.release();
    if (pending !== undefined) await pending.catch(() => {});
    await cleanupUser(userA, "sgp");
    await cleanupUser(userB, "sgp");
  }
});

test("concurrent changes for one user serialize", async ({
  request,
  ownedDomain,
}) => {
  test.setTimeout(60_000);
  const domain = ownedDomain("subs-serialize");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request, "sgp");
  const user = await setupUser(hub, "sgp", domain);
  let lock: HeldRowLock | undefined;
  let requestA: ReturnType<HubAPI["setSubscriptionPlan"]> | undefined;
  let requestB: ReturnType<HubAPI["setSubscriptionPlan"]> | undefined;
  try {
    await upgradeToSilverMonthly(hub, user);
    lock = await holdHubUserRowLock(user.hubUserDID, "sgp");

    const keyA = hubIdempotencyKey();
    const keyB = hubIdempotencyKey();
    user.keys.push(keyA, keyB);
    requestA = hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "year" },
      { token: user.token, idempotencyKey: keyA, timeout: 30_000 },
    );
    requestB = hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "year" },
      { token: user.token, idempotencyKey: keyB, timeout: 30_000 },
    );
    await waitForBlockedBy("sgp", lock.holderPID, 2);
    await lock.release();
    lock = undefined;

    const [responseA, responseB] = await Promise.all([requestA, requestB]);
    expect(responseA.status(), await responseA.text()).toBe(200);
    expect(responseB.status(), await responseB.text()).toBe(200);
    const bodyA = await responseA.json();
    const bodyB = await responseB.json();
    expect(bodyA).toEqual(bodyB);
    const got = await hub.mySubscription(user.token);
    expect(await got.json()).toEqual(bodyA);

    const upgraded = hubSubscriptionAuditEvents(user.hubUserDID, "sgp").filter(
      (e) =>
        e.action === "hub.subscription.upgraded" &&
        (e.idempotency_key === keyA || e.idempotency_key === keyB),
    );
    expect(upgraded).toHaveLength(1);
  } finally {
    await lock?.release();
    await Promise.allSettled([requestA, requestB]);
    await cleanupUser(user, "sgp");
  }
});

test("database constraints for subscription shape", async ({
  request,
  ownedDomain,
}) => {
  const domain = ownedDomain("subs-constraints");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request);
  const user = await setupUser(hub, "sgp", domain);
  try {
    const violations = [
      "free-with-anchor",
      "free-with-period-start",
      "free-with-period-end",
      "free-with-interval",
      "paid-missing-anchor",
      "paid-missing-period-start",
      "paid-missing-period-end",
      "paid-missing-interval",
      "period-start-not-before-end",
      "anchor-after-start",
      "scheduled-paid-without-interval",
      "scheduled-free-with-interval",
      "scheduled-interval-without-plan",
      "scheduled-change-on-free-plan",
      "scheduled-change-equals-current",
    ] as const;
    for (const violation of violations) {
      expectHubUserSubscriptionRejected(user.hubUserDID, "sgp", violation);
      const after = await hub.mySubscription(user.token);
      expect(await after.json(), violation).toEqual({
        plan_oid: "hub-free-tier",
        cancel_at_period_end: false,
      });
    }
  } finally {
    await cleanupUser(user, "sgp");
  }
});

test("a plan change applies a due period end first", async ({
  request,
  ownedDomain,
}) => {
  test.setTimeout(60_000);
  const domain = ownedDomain("subs-apply-first");
  seedHubSignupDomain(domain, "sgp");
  const hub = new HubAPI(request);
  const user1 = await setupUser(hub, "sgp", domain);
  const user2 = await setupUser(hub, "sgp", domain);
  try {
    await upgradeToSilverMonthly(hub, user1);
    const cancelKey = hubIdempotencyKey();
    user1.keys.push(cancelKey);
    expect(
      (
        await hub.setSubscriptionPlan(
          { plan_oid: "hub-free-tier" },
          { token: user1.token, idempotencyKey: cancelKey },
        )
      ).status(),
    ).toBe(200);
    const now1 = databaseNow("sgp");
    const pair1 = boundaryPairEndingAt(now1, "month");
    setHubSubscriptionPeriod(user1.hubUserDID, "sgp", pair1);

    const requestStart = databaseNow("sgp").getTime();
    const upgradeKey = hubIdempotencyKey();
    user1.keys.push(upgradeKey);
    const response1 = await hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "year" },
      { token: user1.token, idempotencyKey: upgradeKey },
    );
    expect(response1.status(), await response1.text()).toBe(200);
    const body1 = (await response1.json()) as HubSubscription;
    expect(body1.plan_oid).toBe("hub-silver-tier");
    expect(body1.billing_interval).toBe("year");
    expect(Date.parse(body1.current_period_start ?? "")).toBeGreaterThanOrEqual(
      requestStart - 5000,
    );
    const got1 = await hub.mySubscription(user1.token);
    expect(await got1.json()).toEqual(body1);

    const events1 = hubSubscriptionAuditEvents(user1.hubUserDID, "sgp");
    const applied1 = events1.filter(
      (e) => e.action === "hub.subscription.scheduled-change-applied",
    );
    expect(applied1).toHaveLength(1);
    expect(["worker", "system"]).toContain(applied1[0]?.actor_type);
    if (applied1[0]?.actor_type === "system") {
      expect(applied1[0]?.source).toBe("hub-api");
      expect(applied1[0]?.idempotency_key).toBe(upgradeKey);
    } else {
      expect(applied1[0]?.source).toBe("workers");
    }
    const upgraded1 = events1.filter(
      (e) =>
        e.action === "hub.subscription.upgraded" &&
        e.idempotency_key === upgradeKey,
    );
    expect(upgraded1).toHaveLength(1);
    const upgraded1Payload = upgraded1[0]?.payload as {
      before: { hub_plan_oid: string };
    };
    expect(upgraded1Payload.before.hub_plan_oid).toBe("hub-free-tier");

    await upgradeToSilverMonthly(hub, user2);
    const now2 = databaseNow("sgp");
    const pair2 = boundaryPairEndingAt(now2, "month");
    setHubSubscriptionPeriod(user2.hubUserDID, "sgp", pair2);
    const monthlyKey = hubIdempotencyKey();
    user2.keys.push(monthlyKey);
    const response2 = await hub.setSubscriptionPlan(
      { plan_oid: "hub-silver-tier", billing_interval: "month" },
      { token: user2.token, idempotencyKey: monthlyKey },
    );
    expect(response2.status(), await response2.text()).toBe(200);
    const body2 = (await response2.json()) as HubSubscription;
    const got2 = await hub.mySubscription(user2.token);
    expect(await got2.json()).toEqual(body2);
    const dbNow2 = databaseNow("sgp").getTime();
    expect(Date.parse(body2.current_period_start ?? "")).toBeLessThanOrEqual(
      dbNow2,
    );
    expect(Date.parse(body2.current_period_end ?? "")).toBeGreaterThan(dbNow2);

    const events2 = hubSubscriptionAuditEvents(user2.hubUserDID, "sgp");
    const renewed2 = events2.filter(
      (e) => e.action === "hub.subscription.renewed",
    );
    expect(renewed2).toHaveLength(1);
    if (renewed2[0]?.actor_type === "system") {
      expect(renewed2[0]?.source).toBe("hub-api");
    } else {
      expect(renewed2[0]?.actor_type).toBe("worker");
      expect(renewed2[0]?.source).toBe("workers");
    }
    // Only the original upgrade is attributed to the Hub user; the period-end
    // transition is system- or worker-attributed.
    expect(events2.filter((e) => e.actor_type === "hub_user")).toHaveLength(1);
  } finally {
    await cleanupUser(user1, "sgp");
    await cleanupUser(user2, "sgp");
  }
});
