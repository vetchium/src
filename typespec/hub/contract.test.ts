import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCompleteSignupRequest,
  validateRequestSignupRequest,
} from "./auth/signup.ts";
import {
  type BillingInterval,
  DefaultPlan,
  FreeTier,
  type HubPlan,
  isBillingInterval,
  isHubPlan,
  isUpgrade,
  planIncludes,
  planRank,
  plans,
  plansAtOrAbove,
  requiresBillingInterval,
  SilverTier,
} from "./subscriptions/plans.ts";
import { validateSetSubscriptionPlanRequest } from "./subscriptions/subscriptions.ts";
import {
  frontendLocaleValues,
  isFrontendLocale,
  isHubHandle,
  isHubUserDID,
} from "./types.ts";

test("Hub locales are canonical and portal-owned", () => {
  assert.deepEqual(frontendLocaleValues, ["en-US", "ta", "de-DE"]);
  for (const locale of frontendLocaleValues)
    assert.equal(Intl.getCanonicalLocales(locale)[0], locale);
  assert.equal(isFrontendLocale("en-US"), true);
  assert.equal(isFrontendLocale("ta"), true);
  assert.equal(isFrontendLocale("de-DE"), true);
  assert.equal(isFrontendLocale("EN-us"), false);
  assert.equal(isFrontendLocale("de-AT"), false);
  assert.equal(isFrontendLocale("fr-FR"), false);
});

test("Hub signup validates locale and ISO country", () => {
  assert.deepEqual(
    validateRequestSignupRequest({
      email_address: "person@example.com",
      display_name: "Person",
      preferred_language: "de-DE",
      resident_country: "DE",
    }),
    [],
  );
  assert.deepEqual(
    validateRequestSignupRequest({
      email_address: "invalid",
      display_name: " ",
      preferred_language: "fr-FR" as "en-US",
      resident_country: "ZZ",
    }),
    ["email_address", "display_name", "preferred_language", "resident_country"],
  );
});

test("Hub signup completion validates token and password", () => {
  assert.deepEqual(
    validateCompleteSignupRequest({
      signup_token: "short",
      password: "short",
    }),
    ["signup_token", "password"],
  );
});

test("Hub identifiers enforce UUIDv7 and fixed-width handles", () => {
  assert.equal(isHubUserDID("018f7e32-7b5a-7d31-8fd0-f7e2a852f144"), true);
  assert.equal(isHubUserDID("018f7e32-7b5a-4d31-8fd0-f7e2a852f144"), false);
  assert.equal(isHubHandle("perso-00000000001"), true);
  assert.equal(isHubHandle("person-00000000001"), false);
});

test("Hub plans are ranked and default to the free tier", () => {
  assert.deepEqual(plans, ["hub-free-tier", "hub-silver-tier"]);
  assert.equal(DefaultPlan, FreeTier);
  assert.equal(planRank(FreeTier) < planRank(SilverTier), true);
  assert.deepEqual(plansAtOrAbove(SilverTier), ["hub-silver-tier"]);
  assert.equal(isHubPlan("hub-free-tier"), true);
  assert.equal(isHubPlan("hub-gold-tier"), false);
  assert.equal(isBillingInterval("month"), true);
  assert.equal(isBillingInterval("week"), false);
  assert.equal(requiresBillingInterval(FreeTier), false);
  assert.equal(requiresBillingInterval(SilverTier), true);
  assert.equal(planIncludes("hub-silver-tier", FreeTier), true);
  assert.equal(planIncludes("hub-gold-tier", FreeTier), false);
});

test("isUpgrade matches the Go companion's rule for every combination", () => {
  const cases: Array<
    [
      HubPlan,
      BillingInterval | undefined,
      HubPlan,
      BillingInterval | undefined,
      boolean,
    ]
  > = [
    [FreeTier, undefined, FreeTier, undefined, false],
    [FreeTier, undefined, SilverTier, "month", true],
    [FreeTier, undefined, SilverTier, "year", true],
    [SilverTier, "month", FreeTier, undefined, false],
    [SilverTier, "month", SilverTier, "month", false],
    [SilverTier, "month", SilverTier, "year", true],
    [SilverTier, "year", FreeTier, undefined, false],
    [SilverTier, "year", SilverTier, "month", false],
    [SilverTier, "year", SilverTier, "year", false],
  ];
  for (const [fromPlan, fromInterval, toPlan, toInterval, want] of cases) {
    assert.equal(
      isUpgrade(fromPlan, fromInterval, toPlan, toInterval),
      want,
      `isUpgrade(${fromPlan}, ${fromInterval}, ${toPlan}, ${toInterval})`,
    );
  }
});

test("set-subscription-plan request validation matches the Go companion", () => {
  assert.deepEqual(
    validateSetSubscriptionPlanRequest({ plan_oid: "hub-free-tier" }),
    [],
  );
  assert.deepEqual(
    validateSetSubscriptionPlanRequest({
      plan_oid: "hub-silver-tier",
      billing_interval: "month",
    }),
    [],
  );
  assert.deepEqual(validateSetSubscriptionPlanRequest(null), [
    "plan_oid",
    "billing_interval",
  ]);
  assert.deepEqual(
    validateSetSubscriptionPlanRequest({ plan_oid: "hub-gold-tier" }),
    ["plan_oid"],
  );
  assert.deepEqual(
    validateSetSubscriptionPlanRequest({
      plan_oid: "hub-free-tier",
      billing_interval: "month",
    }),
    ["billing_interval"],
  );
  assert.deepEqual(
    validateSetSubscriptionPlanRequest({
      plan_oid: "hub-free-tier",
      billing_interval: null,
    }),
    ["billing_interval"],
  );
  assert.deepEqual(
    validateSetSubscriptionPlanRequest({ plan_oid: "hub-silver-tier" }),
    ["billing_interval"],
  );
  assert.deepEqual(
    validateSetSubscriptionPlanRequest({
      plan_oid: "hub-silver-tier",
      billing_interval: null,
    }),
    ["billing_interval"],
  );
  assert.deepEqual(
    validateSetSubscriptionPlanRequest({
      plan_oid: "hub-silver-tier",
      billing_interval: "week",
    }),
    ["billing_interval"],
  );
  assert.deepEqual(
    validateSetSubscriptionPlanRequest({
      plan_oid: "hub-gold-tier",
      billing_interval: "week",
    }),
    ["plan_oid", "billing_interval"],
  );
});
