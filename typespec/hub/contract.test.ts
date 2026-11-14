import assert from "node:assert/strict";
import test from "node:test";
import { isHubAccountHomedElsewhereProblem } from "../problem/hub/signup.ts";

import {
  normalizeRequestEmailChangeRequest,
  validateConfirmEmailChangeRequest,
  validateRequestEmailChangeRequest,
} from "./auth/email_change.ts";
import {
  validateCompleteSignupRequest,
  validateRequestSignupRequest,
} from "./auth/signup.ts";
import {
  conversationFilters,
  isConversationFilter,
  validateListConversationsRequest,
} from "./messages/messages.ts";
import { validateListOrgOpeningsRequest } from "./openings/public.ts";
import {
  normalizeSearchOpeningsRequest,
  normalizeSuggestOpeningOrgsRequest,
  type OpeningSearchPostedWithinDays,
  type SearchOpeningsRequest,
  validateSearchOpeningsRequest,
  validateSuggestOpeningOrgsRequest,
} from "./openings/search.ts";
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
  assert.equal(isHubHandle("perso000-00000000001"), true);
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

test("Hub email change normalizes without mutating and validates each field", () => {
  const original = { new_email_address: "  Person@Example.COM " };
  const normalized = normalizeRequestEmailChangeRequest(original);
  assert.equal(normalized.new_email_address, "person@example.com");
  assert.equal(original.new_email_address, "  Person@Example.COM ");
  assert.deepEqual(validateRequestEmailChangeRequest(original), []);
  for (const address of ["", "not-an-address", "a@", "@b.c"])
    assert.deepEqual(
      validateRequestEmailChangeRequest({ new_email_address: address }),
      ["new_email_address"],
    );
  assert.deepEqual(
    validateConfirmEmailChangeRequest({ challenge_id: "bad", code: "12345a" }),
    ["challenge_id", "code"],
  );
  assert.deepEqual(
    validateConfirmEmailChangeRequest({
      challenge_id: "22222222-2222-4222-8222-222222222222",
      code: "12345",
    }),
    ["code"],
  );
  assert.deepEqual(
    validateConfirmEmailChangeRequest({
      challenge_id: "22222222-2222-4222-8222-222222222222",
      code: "000123",
    }),
    [],
  );
});

test("the homed-elsewhere guard requires every extension member", () => {
  const problem = {
    type: "vetchium-problem-details/hub-account-homed-elsewhere",
    title: "Hub account homed in another region",
    status: 409,
    detail: "This Hub account signs in at another region",
    tenant_id: "usa1",
    hosting_country: "US",
  };
  assert.equal(isHubAccountHomedElsewhereProblem(problem), true);
  for (const field of ["tenant_id", "hosting_country"] as const) {
    const missing: Record<string, unknown> = { ...problem };
    delete missing[field];
    assert.equal(isHubAccountHomedElsewhereProblem(missing), false, field);
  }
  assert.equal(
    isHubAccountHomedElsewhereProblem({ ...problem, hosting_country: "us" }),
    false,
  );
  assert.equal(isHubAccountHomedElsewhereProblem(null), false);
});

test("the conversation list takes a known filter", () => {
  assert.deepEqual(conversationFilters, ["all", "requests_received", "unread"]);
  for (const filter of conversationFilters) {
    assert.equal(isConversationFilter(filter), true);
    assert.deepEqual(validateListConversationsRequest({ filter }), []);
  }
  assert.equal(isConversationFilter("requests"), false);
  assert.equal(isConversationFilter(undefined), false);
  assert.deepEqual(
    validateListConversationsRequest({ filter: "requests" as never, limit: 0 }),
    ["limit", "filter"],
  );
});

test("the Org Openings list takes a well-formed tag filter", () => {
  assert.deepEqual(
    validateListOrgOpeningsRequest({
      domain: "example.com",
      tag_oid: "golang",
    }),
    [],
  );
  assert.deepEqual(
    validateListOrgOpeningsRequest({
      domain: "example.com",
      tag_oid: "Go Lang",
    }),
    ["tag_oid"],
  );
});

test("Opening search validation matches the Go companion", () => {
  const astral = "😀".repeat(200);
  const countries = [
    "DE",
    "FR",
    "GB",
    "IN",
    "SG",
    "US",
    "JP",
    "CA",
    "AU",
    "NL",
  ];
  const cases: [string, SearchOpeningsRequest, string[]][] = [
    ["empty", {}, []],
    ["keyword 1", { keyword: "g" }, ["keyword"]],
    ["keyword 2", { keyword: "go" }, []],
    ["keyword 200 code points", { keyword: astral }, []],
    ["keyword 201 code points", { keyword: `${astral}a` }, ["keyword"]],
    ["malformed org domain", { org_domain: "not a domain" }, ["org_domain"]],
    ["five tags", { tag_oids: ["a1", "b1", "c1", "d1", "e1"] }, []],
    [
      "six tags",
      { tag_oids: ["a1", "b1", "c1", "d1", "e1", "f1"] },
      ["tag_oids"],
    ],
    ["empty tags", { tag_oids: [] }, ["tag_oids"]],
    ["repeated tag", { tag_oids: ["golang", "golang"] }, ["tag_oids.1"]],
    ["malformed tag", { tag_oids: ["Go Lang"] }, ["tag_oids.0"]],
    ["ten countries", { work_countries: countries }, []],
    [
      "eleven countries",
      { work_countries: [...countries, "BE"] },
      ["work_countries"],
    ],
    ["unknown country", { work_countries: ["XX"] }, ["work_countries.0"]],
    [
      "repeated arrangement",
      { work_arrangements: ["remote", "remote"] },
      ["work_arrangements.1"],
    ],
    [
      "unknown arrangement",
      { work_arrangements: ["office"] },
      ["work_arrangements.0"],
    ],
    [
      "unknown employment type",
      { employment_types: ["gig"] },
      ["employment_types.0"],
    ],
    ["posted within 7", { posted_within_days: 7 }, []],
    [
      "posted within 2",
      { posted_within_days: 2 as OpeningSearchPostedWithinDays },
      ["posted_within_days"],
    ],
    ["experience 0", { experience_years: 0 }, []],
    ["experience 50", { experience_years: 50 }, []],
    ["experience -1", { experience_years: -1 }, ["experience_years"]],
    ["experience 51", { experience_years: 51 }, ["experience_years"]],
    ["unknown education", { education_level: "diploma" }, ["education_level"]],
    ["malformed pagination key", { pagination_key: "" }, ["pagination_key"]],
    ["limit 1", { limit: 1 }, []],
    ["limit 50", { limit: 50 }, []],
    ["limit 0", { limit: 0 }, ["limit"]],
    ["limit 51", { limit: 51 }, ["limit"]],
    ["region", { region: "usa1" }, []],
    ["malformed region", { region: "USA 1" }, ["region"]],
    [
      "several fields at once",
      { keyword: "g", limit: 0, region: "X" },
      ["keyword", "limit", "region"],
    ],
  ];
  for (const [name, request, want] of cases) {
    assert.deepEqual(validateSearchOpeningsRequest(request), want, name);
  }
});

test("Opening search normalization keeps the original", () => {
  const original: SearchOpeningsRequest = {
    keyword: "  golang  ",
    org_domain: "Example.COM",
    work_countries: [" de ", "fr"],
  };
  const normalized = normalizeSearchOpeningsRequest(original);
  assert.equal(normalized.keyword, "golang");
  assert.equal(normalized.org_domain, "example.com");
  assert.deepEqual(normalized.work_countries, ["DE", "FR"]);
  assert.equal(original.keyword, "  golang  ");
  assert.deepEqual(original.work_countries, [" de ", "fr"]);
  assert.deepEqual(validateSearchOpeningsRequest(normalized), []);
});

test("Opening Org suggestions validate the query and region", () => {
  assert.deepEqual(validateSuggestOpeningOrgsRequest({ query: "a" }), [
    "query",
  ]);
  assert.deepEqual(validateSuggestOpeningOrgsRequest({ query: "ab" }), []);
  assert.deepEqual(
    validateSuggestOpeningOrgsRequest({ query: "é".repeat(100) }),
    [],
  );
  assert.deepEqual(
    validateSuggestOpeningOrgsRequest({ query: "é".repeat(101) }),
    ["query"],
  );
  assert.deepEqual(
    validateSuggestOpeningOrgsRequest({ query: "ab", region: "1x" }),
    ["region"],
  );
  assert.equal(
    normalizeSuggestOpeningOrgsRequest({ query: "  ab " }).query,
    "ab",
  );
});
