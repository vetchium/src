import type { APIResponse, Page } from "@playwright/test";
import {
  type AICreditsResponse,
  type AIOptions,
  type AISettingsResponse,
  type DraftOpeningResponse,
  type ListAICreditLotsResponse,
  type ListAIUsageResponse,
  OrgAITermsVersion,
} from "typespec/orgs/ai/ai";
import type { AIOperationPolicy, AIUsageText } from "typespec/orgs/ai/types";
import {
  IdempotencyKeyConflictError,
  InvalidPaginationKeyError,
} from "typespec/problem/common";
import {
  InvalidJSONError,
  ValidationFailedError,
} from "typespec/problem/details";
import {
  AICreditsInsufficientErrorType,
  AIModelFailedError,
  AIModelNotAllowedError,
  AIModelNotOfferedErrorType,
  AINotEnabledError,
  AIOperationOffError,
  AIOutputUnusableError,
  AIPackNotOfferedError,
  AIRequestInProgressError,
  AITermsRequiredErrorType,
  AIUnavailableError,
  AIUsageNotFoundError,
} from "typespec/problem/orgs/ai";
import {
  AuthenticationRequiredError,
  PermissionRequiredError,
} from "typespec/problem/orgs/authentication";
import { PlanRequiredErrorType } from "typespec/problem/orgs/billing";
import { OrgSuspendedError } from "typespec/problem/orgs/suspension";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import {
  addOrgMember,
  cleanupOrg,
  inviteeAddress,
  loginOrg,
  OrgsAPI,
  orgAuditEventsByKey,
  orgDID,
  orgSQL,
  orgsIdempotencyKey,
  orgUserID,
  type SignedUpOrg,
  signupOrg,
} from "../lib/orgs-api.ts";

// A second sgp API process runs without an AI block, sharing only test-owned
// records with the regular API.
const unavailableOrigin = "http://127.0.0.1:18084";
const qwen = "qwen3-1-7b";
const ministral = "ministral-3-3b";
const draft = "org-opening-draft";
const monthlyGrant = 100000;
const rates: Record<string, [number, number]> = {
  [qwen]: [20000, 60000],
  [ministral]: [30000, 80000],
};

interface Fixture {
  api: OrgsAPI;
  org: SignedUpOrg;
  owner: string;
}

async function withOrg(
  request: Page["request"],
  body: (fixture: Fixture) => Promise<void>,
  options: { gold?: boolean; enabled?: boolean } = {},
): Promise<void> {
  const api = new OrgsAPI(request);
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    if (options.gold) await choosePlan(api, owner, "org-gold-tier");
    if (options.enabled) await enable(api, owner);
    await body({ api, org, owner });
  } finally {
    await deleteOrgVerificationRecord(org.domain);
    cleanupOrg(org.domain);
  }
}

async function choosePlan(
  api: OrgsAPI,
  token: string,
  plan: "org-gold-tier" | "org-free-tier",
): Promise<void> {
  const response = await api.setSubscriptionPlan(
    token,
    plan === "org-free-tier"
      ? { plan_oid: plan }
      : { plan_oid: plan, billing_interval: "month" },
  );
  expect(response.status(), await response.text()).toBe(200);
}

async function enable(api: OrgsAPI, token: string): Promise<void> {
  const response = await api.setAISettings(token, {
    enabled: true,
    accept_terms_version: OrgAITermsVersion,
    policies: [],
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function credits(
  api: OrgsAPI,
  token: string,
): Promise<AICreditsResponse> {
  const response = await api.aiCredits(token);
  expect(response.status(), await response.text()).toBe(200);
  return responseJSON<AICreditsResponse>(response);
}

/** The grant worker runs every second in CI. */
async function waitForGrant(api: OrgsAPI, token: string): Promise<void> {
  await expect
    .poll(async () => (await credits(api, token)).balance.available, {
      timeout: 15000,
    })
    .toBe(monthlyGrant);
}

async function options(api: OrgsAPI, token: string): Promise<AIOptions> {
  const response = await api.getAIOptions(token, { operation: draft });
  expect(response.status(), await response.text()).toBe(200);
  return responseJSON<AIOptions>(response);
}

function charge(model: string, input: number, output: number): number {
  const [inputRate, outputRate] = rates[model] ?? [0, 0];
  return Math.ceil((input * inputRate + output * outputRate) / 1_000_000);
}

function suspend(org: SignedUpOrg): void {
  orgSQL(
    `UPDATE vetchium.orgs SET org_state = 'suspended', suspended_at = now()
     WHERE org_did = '${orgDID(org.domain)}'`,
  );
}

function usageRows(org: SignedUpOrg): string {
  return orgSQL(
    `SELECT COALESCE(string_agg(usage_state || ':' || COALESCE(failure_reason::text, '-')
       || ':' || credits_charged, ',' ORDER BY created_at), '')
     FROM vetchium.org_ai_usage WHERE org_did = '${orgDID(org.domain)}'`,
  );
}

async function draftJSON(response: APIResponse): Promise<DraftOpeningResponse> {
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return responseJSON<DraftOpeningResponse>(response);
}

test.describe("get-ai-options", () => {
  test("reports each availability state to a caller who may draft", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      let current = await options(api, owner);
      expect(current).toEqual({
        availability: "plan_required",
        models: [
          expect.objectContaining({ model_oid: qwen, status: "offered" }),
          expect.objectContaining({ model_oid: ministral, status: "offered" }),
        ],
        default_model: qwen,
        balance_available: 0,
      });
      expect(current.models[0]).toEqual({
        model_oid: qwen,
        display_name: "Qwen3 1.7B",
        vendor: "Alibaba Cloud Qwen",
        licence: "Apache-2.0",
        status: "offered",
        input_credits_per_million_tokens: 20000,
        output_credits_per_million_tokens: 60000,
      });
      // The plan outranks AI being off and a feature turned off.
      expect(
        (
          await api.setAISettings(owner, {
            enabled: false,
            policies: [{ operation: draft, allowed_models: [] }],
          })
        ).status(),
      ).toBe(200);
      expect((await options(api, owner)).availability).toBe("plan_required");
      await choosePlan(api, owner, "org-gold-tier");
      expect((await options(api, owner)).availability).toBe("not_enabled");
      await enable(api, owner);
      await waitForGrant(api, owner);
      current = await options(api, owner);
      expect(current.availability).toBe("ready");
      expect(current.balance_available).toBe(monthlyGrant);
      orgSQL(
        `UPDATE vetchium.org_ai_credit_lots SET credits_remaining = 0
         WHERE org_did = '${orgDID(org.domain)}'`,
      );
      expect((await options(api, owner)).availability).toBe("no_credits");
    });
  });

  test("validates the operation and requires its permission", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await expectProblem(
        await api.post(
          "/get-ai-options",
          { operation: "org-future" },
          {
            token: owner,
          },
        ),
        400,
        ValidationFailedError.type,
        ["operation"],
      );
      await expectProblem(
        await api.postRaw("/get-ai-options", "{", { token: owner }),
        400,
        InvalidJSONError.type,
      );
      const response = await api.getAIOptions(undefined, { operation: draft });
      await expectProblem(response, 401, AuthenticationRequiredError.type);
      expect(response.headers()["www-authenticate"]).toContain("Bearer");
      const viewer = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "viewer"),
        ["org:view_openings"],
      );
      await expectProblem(
        await api.getAIOptions(viewer.token, { operation: draft }),
        403,
        PermissionRequiredError.type,
      );
      const unavailable = new OrgsAPI(api.request, "sgp", unavailableOrigin);
      await expectProblem(
        await unavailable.getAIOptions(owner, { operation: draft }),
        404,
        AIUnavailableError.type,
      );
      suspend(org);
      await expectProblem(
        await api.getAIOptions(owner, { operation: draft }),
        403,
        OrgSuspendedError.type,
      );
    });
  });
});

test.describe("AI settings", () => {
  test("enabling needs the current terms; policies replace and narrow the models", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, owner }) => {
      await choosePlan(api, owner, "org-gold-tier");
      let response = await api.aiSettings(owner);
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      const initial = await responseJSON<AISettingsResponse>(response);
      expect(initial).toEqual({
        settings: { enabled: false, policies: [] },
        models: [
          expect.objectContaining({ model_oid: qwen }),
          expect.objectContaining({ model_oid: ministral }),
        ],
        operation_defaults: [{ operation: draft, default_model: qwen }],
        current_terms_version: OrgAITermsVersion,
        plan_allows_ai: true,
        unavailable_models: [],
      });

      response = await api.setAISettings(owner, {
        enabled: true,
        policies: [],
      });
      await expectProblem(response, 422, AITermsRequiredErrorType);
      expect((await response.json()).terms_version).toBe(OrgAITermsVersion);
      await expectProblem(
        await api.setAISettings(owner, {
          enabled: true,
          accept_terms_version: "ai-2020-01",
          policies: [],
        }),
        422,
        AITermsRequiredErrorType,
      );
      response = await api.setAISettings(owner, {
        enabled: false,
        policies: [
          {
            operation: draft,
            allowed_models: [qwen, "gemma-3-27b"],
            default_model: qwen,
          },
        ],
      });
      await expectProblem(response, 422, AIModelNotOfferedErrorType);
      expect((await response.json()).model_oids).toEqual(["gemma-3-27b"]);

      const key = orgsIdempotencyKey();
      const policy = {
        operation: draft,
        allowed_models: [ministral],
        default_model: ministral,
      };
      response = await api.setAISettings(
        owner,
        {
          enabled: true,
          accept_terms_version: OrgAITermsVersion,
          policies: [policy],
        },
        key,
      );
      expect(response.status(), await response.text()).toBe(200);
      const saved = await responseJSON<AISettingsResponse>(response);
      expect(saved.settings).toEqual({
        enabled: true,
        accepted_terms_version: OrgAITermsVersion,
        accepted_terms_at: expect.any(String),
        policies: [policy],
      });
      const audits = orgAuditEventsByKey(key);
      expect(audits.map((event) => event.action)).toEqual([
        "org.ai_settings.changed",
      ]);
      expect(audits[0]?.payload).toEqual({
        enabled: true,
        accepted_terms_version: OrgAITermsVersion,
        policy_operations: [draft],
      });
      const replay = await api.setAISettings(
        owner,
        {
          enabled: true,
          accept_terms_version: OrgAITermsVersion,
          policies: [policy],
        },
        key,
      );
      expect(await replay.json()).toEqual(saved);
      expect(orgAuditEventsByKey(key)).toHaveLength(1);
      await expectProblem(
        await api.setAISettings(owner, { enabled: false, policies: [] }, key),
        409,
        IdempotencyKeyConflictError.type,
      );

      // Saving the same settings again writes nothing; no terms are needed
      // once the current version is accepted.
      const unchangedKey = orgsIdempotencyKey();
      response = await api.setAISettings(
        owner,
        { enabled: true, policies: [policy] },
        unchangedKey,
      );
      expect(response.status()).toBe(200);
      expect(orgAuditEventsByKey(unchangedKey)).toEqual([]);

      const narrowed = await options(api, owner);
      expect(narrowed.models.map((model) => model.model_oid)).toEqual([
        ministral,
      ]);
      expect(narrowed.default_model).toBe(ministral);

      response = await api.setAISettings(owner, {
        enabled: true,
        policies: [],
      });
      expect(
        (await responseJSON<AISettingsResponse>(response)).settings.policies,
      ).toEqual([]);
      expect((await options(api, owner)).models).toHaveLength(2);
    });
  });

  test("turning AI on needs a plan with AI or purchased credits left", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      // The plan is checked before the terms, which cannot help.
      await expectProblem(
        await api.setAISettings(owner, { enabled: true, policies: [] }),
        403,
        PlanRequiredErrorType,
      );
      const key = orgsIdempotencyKey();
      const refused = await api.setAISettings(
        owner,
        {
          enabled: true,
          accept_terms_version: OrgAITermsVersion,
          policies: [],
        },
        key,
      );
      await expectProblem(refused, 403, PlanRequiredErrorType);
      expect((await refused.json()).plan_oid).toBe("org-gold-tier");
      expect(orgAuditEventsByKey(key)).toEqual([]);
      expect(
        (await responseJSON<AISettingsResponse>(await api.aiSettings(owner)))
          .settings,
      ).toEqual({ enabled: false, policies: [] });

      // Credits bought on Gold keep AI available after leaving it, until
      // they are spent.
      await choosePlan(api, owner, "org-gold-tier");
      await enable(api, owner);
      expect(
        (
          await api.buyAICreditPack(owner, { pack_id: "credits-100k" })
        ).status(),
      ).toBe(200);
      await choosePlan(api, owner, "org-free-tier");
      const off = { enabled: false, policies: [] };
      expect((await api.setAISettings(owner, off)).status()).toBe(200);
      expect(
        (
          await api.setAISettings(owner, { enabled: true, policies: [] })
        ).status(),
      ).toBe(200);
      orgSQL(
        `UPDATE vetchium.org_ai_credit_lots SET credits_remaining = 0
         WHERE org_did = '${orgDID(org.domain)}'`,
      );
      // Only turning AI on is refused: staying on, editing policies, and
      // turning off remain open.
      expect(
        (
          await api.setAISettings(owner, {
            enabled: true,
            policies: [{ operation: draft, allowed_models: [] }],
          })
        ).status(),
      ).toBe(200);
      expect((await api.setAISettings(owner, off)).status()).toBe(200);
      await expectProblem(
        await api.setAISettings(owner, { enabled: true, policies: [] }),
        403,
        PlanRequiredErrorType,
      );
    });
  });

  test("validate requests and refuse callers without org:manage_ai", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const valid = {
        operation: draft,
        allowed_models: [qwen],
        default_model: qwen,
      };
      for (const [policies, fields] of [
        [[valid, valid], ["policies.1.operation"]],
        [
          [{ ...valid, default_model: ministral }],
          ["policies.0.default_model"],
        ],
        [[{ ...valid, operation: "org-future" }], ["policies.0.operation"]],
        [
          [{ ...valid, allowed_models: [qwen, qwen] }],
          ["policies.0.allowed_models"],
        ],
        [[{ ...valid, allowed_models: [] }], ["policies.0.default_model"]],
        [
          [{ operation: draft, allowed_models: [qwen] }],
          ["policies.0.default_model"],
        ],
      ] satisfies Array<[AIOperationPolicy[], string[]]>) {
        await expectProblem(
          await api.setAISettings(owner, { enabled: false, policies }),
          400,
          ValidationFailedError.type,
          fields,
        );
      }
      await expectProblem(
        await api.post(
          "/set-ai-settings",
          { enabled: false, policies: [] },
          {
            token: owner,
          },
        ),
        400,
        ValidationFailedError.type,
        ["Idempotency-Key"],
      );
      await expectProblem(
        await api.postRaw("/set-ai-settings", "[]", {
          token: owner,
          idempotencyKey: orgsIdempotencyKey(),
        }),
        400,
        InvalidJSONError.type,
      );
      await expectProblem(
        await api.setAISettings(undefined, { enabled: false, policies: [] }),
        401,
        AuthenticationRequiredError.type,
      );
      await expectProblem(
        await api.aiSettings(),
        401,
        AuthenticationRequiredError.type,
      );
      const recruiter = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "recruiter"),
        ["org:manage_openings"],
      );
      await expectProblem(
        await api.aiSettings(recruiter.token),
        403,
        PermissionRequiredError.type,
      );
      await expectProblem(
        await api.setAISettings(recruiter.token, {
          enabled: false,
          policies: [],
        }),
        403,
        PermissionRequiredError.type,
      );
      const unavailable = new OrgsAPI(api.request, "sgp", unavailableOrigin);
      await expectProblem(
        await unavailable.aiSettings(owner),
        404,
        AIUnavailableError.type,
      );
      await expectProblem(
        await unavailable.setAISettings(owner, {
          enabled: false,
          policies: [],
        }),
        404,
        AIUnavailableError.type,
      );
      suspend(org);
      await expectProblem(
        await api.aiSettings(owner),
        403,
        OrgSuspendedError.type,
      );
      await expectProblem(
        await api.setAISettings(owner, { enabled: false, policies: [] }),
        403,
        OrgSuspendedError.type,
      );
    });
  });
});

test.describe("AI credits", () => {
  test("Gold gets the monthly grant and may buy packs; purchases are idempotent", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, owner }) => {
      let current = await credits(api, owner);
      expect(current).toEqual({
        balance: {
          available: 0,
          monthly_grant_remaining: 0,
          monthly_grant_total: 0,
          purchased_remaining: 0,
          purchased_total: 0,
          reserved: 0,
        },
        monthly_grant: 0,
        purchase_allowed: false,
        packs: [
          {
            pack_id: "credits-100k",
            credits: 100000,
            price_currency: "SGD",
            price_amount_minor: 1300,
          },
          {
            pack_id: "credits-500k",
            credits: 500000,
            price_currency: "SGD",
            price_amount_minor: 5900,
          },
        ],
      });
      const refused = await api.buyAICreditPack(owner, {
        pack_id: "credits-100k",
      });
      await expectProblem(refused, 403, PlanRequiredErrorType);
      expect((await refused.json()).plan_oid).toBe("org-gold-tier");

      await choosePlan(api, owner, "org-gold-tier");
      await waitForGrant(api, owner);
      current = await credits(api, owner);
      expect(current.monthly_grant).toBe(monthlyGrant);
      expect(current.purchase_allowed).toBe(true);
      expect(current.balance.monthly_grant_expires_at).toMatch(
        /^\d{4}-\d{2}-01T00:00:00Z$/,
      );

      const key = orgsIdempotencyKey();
      const bought = await api.buyAICreditPack(
        owner,
        { pack_id: "credits-100k" },
        key,
      );
      expect(bought.status(), await bought.text()).toBe(200);
      const afterPurchase = await responseJSON<AICreditsResponse>(bought);
      expect(afterPurchase.balance).toEqual({
        available: monthlyGrant + 100000,
        monthly_grant_remaining: monthlyGrant,
        monthly_grant_total: monthlyGrant,
        monthly_grant_expires_at: current.balance.monthly_grant_expires_at,
        purchased_remaining: 100000,
        purchased_total: 100000,
        purchased_next_expires_at: expect.stringMatching(/Z$/),
        reserved: 0,
      });
      const replay = await api.buyAICreditPack(
        owner,
        { pack_id: "credits-100k" },
        key,
      );
      expect(await replay.json()).toEqual(afterPurchase);
      expect(
        orgAuditEventsByKey(key).map((event) => [event.action, event.payload]),
      ).toEqual([
        [
          "org.ai_credits.purchased",
          {
            pack_id: "credits-100k",
            credits: 100000,
            price_currency: "SGD",
            price_amount_minor: 1300,
            payment: "simulated",
          },
        ],
      ]);
      await expectProblem(
        await api.buyAICreditPack(owner, { pack_id: "credits-500k" }, key),
        409,
        IdempotencyKeyConflictError.type,
      );
      await expectProblem(
        await api.buyAICreditPack(owner, { pack_id: "credits-1m" }),
        422,
        AIPackNotOfferedError.type,
      );

      // Lots, newest first, one page at a time.
      let response = await api.listAICreditLots(owner, { limit: 1 });
      expect(response.status()).toBe(200);
      const first = await responseJSON<ListAICreditLotsResponse>(response);
      expect(first.lots).toEqual([
        {
          kind: "purchase",
          credits_granted: 100000,
          credits_remaining: 100000,
          pack_id: "credits-100k",
          created_at: expect.any(String),
          expires_at: expect.any(String),
        },
      ]);
      const purchased = first.lots[0];
      expect(
        new Date(purchased?.expires_at ?? "").getTime() -
          new Date(purchased?.created_at ?? "").getTime(),
      ).toBeGreaterThan(360 * 24 * 3600 * 1000);
      expect(first.next_pagination_key).toBeDefined();
      response = await api.listAICreditLots(owner, {
        limit: 1,
        pagination_key: first.next_pagination_key ?? "missing",
      });
      const second = await responseJSON<ListAICreditLotsResponse>(response);
      expect(second.lots).toEqual([
        expect.objectContaining({
          kind: "grant",
          credits_granted: monthlyGrant,
        }),
      ]);
      expect(second.next_pagination_key).toBeUndefined();
      await expectProblem(
        await api.listAICreditLots(owner, { pagination_key: "forged" }),
        400,
        InvalidPaginationKeyError.type,
      );
    });
  });

  test("validate requests and refuse callers without org:manage_ai", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      await expectProblem(
        await api.buyAICreditPack(owner, { pack_id: "Not A Pack" }),
        400,
        ValidationFailedError.type,
        ["pack_id"],
      );
      await expectProblem(
        await api.post(
          "/buy-ai-credit-pack",
          { pack_id: "credits-100k" },
          {
            token: owner,
          },
        ),
        400,
        ValidationFailedError.type,
        ["Idempotency-Key"],
      );
      await expectProblem(
        await api.postRaw("/buy-ai-credit-pack", "{", {
          token: owner,
          idempotencyKey: orgsIdempotencyKey(),
        }),
        400,
        InvalidJSONError.type,
      );
      await expectProblem(
        await api.listAICreditLots(owner, { limit: 0 }),
        400,
        ValidationFailedError.type,
        ["limit"],
      );
      await expectProblem(
        await api.postRaw("/list-ai-credit-lots", "{", { token: owner }),
        400,
        InvalidJSONError.type,
      );
      for (const response of [
        await api.aiCredits(),
        await api.listAICreditLots(undefined),
        await api.buyAICreditPack(undefined, { pack_id: "credits-100k" }),
      ]) {
        await expectProblem(response, 401, AuthenticationRequiredError.type);
      }
      const recruiter = await addOrgMember(
        api,
        owner,
        org.domain,
        inviteeAddress(org.domain, "recruiter"),
        ["org:manage_openings"],
      );
      for (const response of [
        await api.aiCredits(recruiter.token),
        await api.listAICreditLots(recruiter.token),
        await api.buyAICreditPack(recruiter.token, { pack_id: "credits-100k" }),
      ]) {
        await expectProblem(response, 403, PermissionRequiredError.type);
      }
      const unavailable = new OrgsAPI(api.request, "sgp", unavailableOrigin);
      await expectProblem(
        await unavailable.aiCredits(owner),
        404,
        AIUnavailableError.type,
      );
      await expectProblem(
        await unavailable.buyAICreditPack(owner, { pack_id: "credits-100k" }),
        404,
        AIUnavailableError.type,
      );
      suspend(org);
      for (const response of [
        await api.aiCredits(owner),
        await api.listAICreditLots(owner),
        await api.buyAICreditPack(owner, { pack_id: "credits-100k" }),
      ]) {
        await expectProblem(response, 403, OrgSuspendedError.type);
      }
    });
  });
});

test.describe("draft-opening-with-ai", () => {
  test("drafts with the default model, charges actual tokens, and replays without charging again", async ({
    request,
  }) => {
    await withOrg(
      request,
      async ({ api, org, owner }) => {
        await waitForGrant(api, owner);
        const key = orgsIdempotencyKey();
        const body = {
          instruction: "Senior Go engineer for our payments team",
          current_content: { language: "en", employing_country: "SG" },
        };
        const drafted = await draftJSON(
          await api.draftOpeningWithAI(owner, body, key),
        );
        expect(drafted.content).toEqual({
          title: "Draft: Senior Go engineer for our payments team",
          description:
            "## About the role\n\nSenior Go engineer for our payments team",
          work_arrangement: "hybrid",
          employment_type: "full_time",
          positions: 1,
          location_details: "Drafted by ai/qwen3:1.7b",
        });
        expect(drafted.dropped_fields).toEqual([]);
        const usage = drafted.usage;
        expect(usage.model_oid).toBe(qwen);
        expect(usage.input_tokens).toBeGreaterThan(0);
        expect(usage.output_tokens).toBeGreaterThan(0);
        const charged = charge(qwen, usage.input_tokens, usage.output_tokens);
        expect(usage.credits_charged).toBe(charged);
        expect(drafted.balance_available).toBe(monthlyGrant - charged);
        expect(orgAuditEventsByKey(key).map((event) => event.action)).toEqual([
          "org.ai_usage.reserved",
          "org.ai_usage.settled",
        ]);

        const replay = await draftJSON(
          await api.draftOpeningWithAI(owner, body, key),
        );
        expect(replay).toEqual(drafted);
        expect(usageRows(org)).toBe(`settled:-:${charged}`);
        expect((await credits(api, owner)).balance.available).toBe(
          monthlyGrant - charged,
        );
        await expectProblem(
          await api.draftOpeningWithAI(
            owner,
            { ...body, instruction: "Something else" },
            key,
          ),
          409,
          IdempotencyKeyConflictError.type,
        );

        // Another allowed model is chosen explicitly and costs its own rates.
        const other = await draftJSON(
          await api.draftOpeningWithAI(owner, {
            model_oid: ministral,
            instruction: "Data analyst",
          }),
        );
        expect(other.content.location_details).toBe(
          "Drafted by ai/ministral3:3B-Q4_K_M",
        );
        expect(other.usage.credits_charged).toBe(
          charge(
            ministral,
            other.usage.input_tokens,
            other.usage.output_tokens,
          ),
        );

        // The kept text is the prompt sent and the answer received.
        const text = await api.getAIUsageText(owner, {
          usage_id: usage.usage_id,
        });
        expect(text.status(), await text.text()).toBe(200);
        const kept = await responseJSON<AIUsageText>(text);
        expect(kept.usage_id).toBe(usage.usage_id);
        expect(kept.request_messages.map((message) => message.role)).toEqual([
          "system",
          "user",
        ]);
        expect(kept.request_messages[1]?.content).toContain(
          "Request:\nSenior Go engineer for our payments team",
        );
        expect(kept.request_messages[1]?.content).toContain(
          '"employing_country":"SG"',
        );
        expect(JSON.parse(kept.response_text ?? "")).toEqual(drafted.content);
        const retention =
          new Date(kept.expires_at).getTime() - Date.now() - 4320 * 3600 * 1000;
        expect(Math.abs(retention)).toBeLessThan(5 * 60 * 1000);
      },
      { gold: true, enabled: true },
    );
  });

  test("charges nothing when the model fails, times out, omits usage, or answers unusably", async ({
    request,
  }) => {
    await withOrg(
      request,
      async ({ api, org, owner }) => {
        await waitForGrant(api, owner);
        const failKey = orgsIdempotencyKey();
        const failing = { instruction: "Engineer [ai-dev:fail]" };
        await expectProblem(
          await api.draftOpeningWithAI(owner, failing, failKey),
          503,
          AIModelFailedError.type,
        );
        // A failed attempt may be retried with the same key.
        await expectProblem(
          await api.draftOpeningWithAI(owner, failing, failKey),
          503,
          AIModelFailedError.type,
        );
        expect(
          orgAuditEventsByKey(failKey).map((event) => event.action),
        ).toEqual([
          "org.ai_usage.reserved",
          "org.ai_usage.released",
          "org.ai_usage.reserved",
          "org.ai_usage.released",
        ]);
        await expectProblem(
          await api.draftOpeningWithAI(owner, {
            instruction: "Engineer [ai-dev:slow]",
          }),
          503,
          AIModelFailedError.type,
        );
        await expectProblem(
          await api.draftOpeningWithAI(owner, {
            instruction: "Engineer [ai-dev:no-usage]",
          }),
          503,
          AIModelFailedError.type,
        );
        await expectProblem(
          await api.draftOpeningWithAI(owner, {
            instruction: "Engineer [ai-dev:invalid]",
          }),
          502,
          AIOutputUnusableError.type,
        );
        expect(usageRows(org)).toBe(
          [
            "released:model_failed:0",
            "released:model_failed:0",
            "released:model_failed:0",
            "released:model_failed:0",
            "released:unusable_output:0",
          ].join(","),
        );
        expect((await credits(api, owner)).balance).toEqual(
          expect.objectContaining({ available: monthlyGrant, reserved: 0 }),
        );

        // A partly valid answer keeps what passes and names what it dropped.
        const partial = await draftJSON(
          await api.draftOpeningWithAI(owner, {
            instruction: "Engineer [ai-dev:partial]",
          }),
        );
        expect(partial.content).toEqual({ title: "Partial draft" });
        expect(partial.dropped_fields).toEqual(["positions"]);

        const listed = await api.listAIUsage(owner);
        const entries = (await responseJSON<ListAIUsageResponse>(listed))
          .entries;
        const unusable = entries.find(
          (entry) => entry.failure_reason === "unusable_output",
        );
        expect(unusable).toEqual(
          expect.objectContaining({
            operation: draft,
            model_oid: qwen,
            state: "released",
            credits_charged: 0,
            text_available: true,
          }),
        );
        const unusableText = await responseJSON<AIUsageText>(
          await api.getAIUsageText(owner, {
            usage_id: unusable?.usage_id ?? "",
          }),
        );
        expect(unusableText.response_text).toBe("I cannot answer in JSON.");
        const failed = entries.find(
          (entry) => entry.failure_reason === "model_failed",
        );
        const failedText = await responseJSON<AIUsageText>(
          await api.getAIUsageText(owner, { usage_id: failed?.usage_id ?? "" }),
        );
        expect(failedText.response_text).toBeUndefined();
      },
      { gold: true, enabled: true },
    );
  });

  test("a second request with the key of a running one is refused", async ({
    request,
  }) => {
    await withOrg(
      request,
      async ({ api, org, owner }) => {
        await waitForGrant(api, owner);
        const key = orgsIdempotencyKey();
        const body = { instruction: "Engineer [ai-dev:slow]" };
        const running = api.draftOpeningWithAI(owner, body, key);
        await expect
          .poll(() => usageRows(org), { timeout: 5000 })
          .toBe("reserved:-:0");
        expect((await credits(api, owner)).balance.reserved).toBeGreaterThan(0);
        await expectProblem(
          await api.draftOpeningWithAI(owner, body, key),
          409,
          AIRequestInProgressError.type,
        );
        await expectProblem(await running, 503, AIModelFailedError.type);
        expect((await credits(api, owner)).balance.reserved).toBe(0);
      },
      { gold: true, enabled: true },
    );
  });

  test("refuses when the plan lacks AI, AI is off, the model is not allowed, or credits run short", async ({
    request,
  }) => {
    await withOrg(request, async ({ api, org, owner }) => {
      const body = { instruction: "Product designer" };
      const planRequired = await api.draftOpeningWithAI(owner, body);
      await expectProblem(planRequired, 403, PlanRequiredErrorType);
      expect((await planRequired.json()).plan_oid).toBe("org-gold-tier");

      await choosePlan(api, owner, "org-gold-tier");
      await expectProblem(
        await api.draftOpeningWithAI(owner, body),
        409,
        AINotEnabledError.type,
      );
      await waitForGrant(api, owner);
      const settings = await api.setAISettings(owner, {
        enabled: true,
        accept_terms_version: OrgAITermsVersion,
        policies: [
          {
            operation: draft,
            allowed_models: [ministral],
            default_model: ministral,
          },
        ],
      });
      expect(settings.status()).toBe(200);
      await expectProblem(
        await api.draftOpeningWithAI(owner, { ...body, model_oid: qwen }),
        422,
        AIModelNotAllowedError.type,
      );
      await expectProblem(
        await api.draftOpeningWithAI(owner, {
          ...body,
          model_oid: "gemma-3-27b",
        }),
        422,
        AIModelNotAllowedError.type,
      );
      expect(
        (await draftJSON(await api.draftOpeningWithAI(owner, body))).usage
          .model_oid,
      ).toBe(ministral);

      // No allowed model turns drafting off, ahead of the plan and credits.
      expect(
        (
          await api.setAISettings(owner, {
            enabled: true,
            policies: [{ operation: draft, allowed_models: [] }],
          })
        ).status(),
      ).toBe(200);
      const off = await options(api, owner);
      expect(off.availability).toBe("operation_off");
      expect(off.models).toEqual([]);
      expect(off.default_model).toBeUndefined();
      await expectProblem(
        await api.draftOpeningWithAI(owner, body),
        409,
        AIOperationOffError.type,
      );
      const stored = (await (await api.aiSettings(owner)).json()) as {
        settings: { policies: AIOperationPolicy[] };
      };
      expect(stored.settings.policies).toEqual([
        { operation: draft, allowed_models: [] },
      ]);
      await api.setAISettings(owner, {
        enabled: true,
        policies: [
          {
            operation: draft,
            allowed_models: [ministral],
            default_model: ministral,
          },
        ],
      });

      orgSQL(
        `UPDATE vetchium.org_ai_credit_lots SET credits_remaining = 10
         WHERE org_did = '${orgDID(org.domain)}'`,
      );
      const short = await api.draftOpeningWithAI(owner, body);
      await expectProblem(short, 409, AICreditsInsufficientErrorType);
      const problem = await short.json();
      expect(problem.available).toBe(10);
      expect(problem.required).toBeGreaterThan(10);
    });
  });

  test("purchased credits stay usable after leaving Gold; the grant does not", async ({
    request,
  }) => {
    await withOrg(
      request,
      async ({ api, owner }) => {
        await waitForGrant(api, owner);
        expect(
          (
            await api.buyAICreditPack(owner, { pack_id: "credits-100k" })
          ).status(),
        ).toBe(200);
        await choosePlan(api, owner, "org-free-tier");
        const after = await credits(api, owner);
        expect(after.balance).toEqual({
          available: 100000,
          monthly_grant_remaining: 0,
          monthly_grant_total: 0,
          purchased_remaining: 100000,
          purchased_total: 100000,
          purchased_next_expires_at: expect.stringMatching(/Z$/),
          reserved: 0,
        });
        expect(after.purchase_allowed).toBe(false);
        expect((await options(api, owner)).availability).toBe("ready");
        const drafted = await draftJSON(
          await api.draftOpeningWithAI(owner, { instruction: "Recruiter" }),
        );
        expect(drafted.balance_available).toBe(
          100000 - drafted.usage.credits_charged,
        );
        const spent = (await credits(api, owner)).balance;
        expect(spent.purchased_remaining).toBe(
          100000 - drafted.usage.credits_charged,
        );
        // Spending leaves the total, so the share used grows.
        expect(spent.purchased_total).toBe(100000);
      },
      { gold: true, enabled: true },
    );
  });

  test("a charge spends the grant first, then purchases by earliest expiry", async ({
    request,
  }) => {
    await withOrg(
      request,
      async ({ api, org, owner }) => {
        await waitForGrant(api, owner);
        for (const pack_id of ["credits-100k", "credits-500k"]) {
          expect((await api.buyAICreditPack(owner, { pack_id })).status()).toBe(
            200,
          );
        }
        // Leave one credit in the grant and two in the larger pack, which is
        // made to expire first, so one call must drain both and reach the
        // later pack.
        const did = orgDID(org.domain);
        orgSQL(
          `UPDATE vetchium.org_ai_credit_lots SET credits_remaining = 1
           WHERE org_did = '${did}' AND kind = 'grant'`,
        );
        orgSQL(
          `UPDATE vetchium.org_ai_credit_lots
           SET credits_remaining = 2, expires_at = now() + interval '1 month'
           WHERE org_did = '${did}' AND pack_id = 'credits-500k'`,
        );
        const drafted = await draftJSON(
          await api.draftOpeningWithAI(owner, { instruction: "Recruiter" }),
        );
        const charged = drafted.usage.credits_charged;
        expect(charged).toBeGreaterThan(3);
        expect(
          orgSQL(
            `SELECT string_agg(kind || ':' || COALESCE(pack_id, '-') || ':'
               || credits_remaining, ',' ORDER BY kind, pack_id)
             FROM vetchium.org_ai_credit_lots WHERE org_did = '${did}'`,
          ),
        ).toBe(
          `grant:-:0,purchase:credits-100k:${100000 - (charged - 3)},purchase:credits-500k:0`,
        );
        expect(drafted.balance_available).toBe(100000 - (charged - 3));
      },
      { gold: true, enabled: true },
    );
  });

  test("validates the request and requires the drafting permission", async ({
    request,
  }) => {
    await withOrg(
      request,
      async ({ api, org, owner }) => {
        await expectProblem(
          await api.draftOpeningWithAI(owner, { instruction: "  " }),
          400,
          ValidationFailedError.type,
          ["instruction"],
        );
        await expectProblem(
          await api.draftOpeningWithAI(owner, {
            instruction: "x",
            current_content: { positions: 11 },
          }),
          400,
          ValidationFailedError.type,
          ["current_content.positions"],
        );
        await expectProblem(
          await api.post(
            "/draft-opening-with-ai",
            { instruction: "x" },
            {
              token: owner,
            },
          ),
          400,
          ValidationFailedError.type,
          ["Idempotency-Key"],
        );
        await expectProblem(
          await api.postRaw("/draft-opening-with-ai", "{", {
            token: owner,
            idempotencyKey: orgsIdempotencyKey(),
          }),
          400,
          InvalidJSONError.type,
        );
        await expectProblem(
          await api.draftOpeningWithAI(undefined, { instruction: "x" }),
          401,
          AuthenticationRequiredError.type,
        );
        const approver = await addOrgMember(
          api,
          owner,
          org.domain,
          inviteeAddress(org.domain, "approver"),
          ["org:approve_openings"],
        );
        await expectProblem(
          await api.draftOpeningWithAI(approver.token, { instruction: "x" }),
          403,
          PermissionRequiredError.type,
        );
        const unavailable = new OrgsAPI(api.request, "sgp", unavailableOrigin);
        await expectProblem(
          await unavailable.draftOpeningWithAI(owner, { instruction: "x" }),
          404,
          AIUnavailableError.type,
        );
        suspend(org);
        await expectProblem(
          await api.draftOpeningWithAI(owner, { instruction: "x" }),
          403,
          OrgSuspendedError.type,
        );
      },
      { gold: true, enabled: true },
    );
  });
});

test.describe("AI usage", () => {
  test("lists newest first and shows text only to readers of the Opening data", async ({
    request,
  }) => {
    await withOrg(
      request,
      async ({ api, org, owner }) => {
        await waitForGrant(api, owner);
        const first = await draftJSON(
          await api.draftOpeningWithAI(owner, { instruction: "First role" }),
        );
        const second = await draftJSON(
          await api.draftOpeningWithAI(owner, { instruction: "Second role" }),
        );
        let response = await api.listAIUsage(owner, { limit: 1 });
        expect(response.status()).toBe(200);
        expect(response.headers()["cache-control"]).toBe("no-store");
        const page = await responseJSON<ListAIUsageResponse>(response);
        expect(page.entries).toEqual([
          {
            usage_id: second.usage.usage_id,
            operation: draft,
            model_oid: qwen,
            actor_email: org.emailAddress,
            state: "settled",
            input_tokens: second.usage.input_tokens,
            output_tokens: second.usage.output_tokens,
            credits_charged: second.usage.credits_charged,
            created_at: expect.any(String),
            text_available: true,
          },
        ]);
        response = await api.listAIUsage(owner, {
          limit: 1,
          pagination_key: page.next_pagination_key ?? "missing",
        });
        const next = await responseJSON<ListAIUsageResponse>(response);
        expect(next.entries.map((entry) => entry.usage_id)).toEqual([
          first.usage.usage_id,
        ]);
        expect(next.next_pagination_key).toBeUndefined();
        await expectProblem(
          await api.listAIUsage(owner, { pagination_key: "forged" }),
          400,
          InvalidPaginationKeyError.type,
        );
        await expectProblem(
          await api.listAIUsage(owner, { limit: 101 }),
          400,
          ValidationFailedError.type,
          ["limit"],
        );
        await expectProblem(
          await api.postRaw("/list-ai-usage", "{", { token: owner }),
          400,
          InvalidJSONError.type,
        );

        // org:manage_ai alone does not read prompts about Openings.
        const aiManager = await addOrgMember(
          api,
          owner,
          org.domain,
          inviteeAddress(org.domain, "ai"),
          ["org:manage_ai"],
        );
        expect((await api.listAIUsage(aiManager.token)).status()).toBe(200);
        await expectProblem(
          await api.getAIUsageText(aiManager.token, {
            usage_id: first.usage.usage_id,
          }),
          404,
          AIUsageNotFoundError.type,
        );
        await expectProblem(
          await api.getAIUsageText(owner, {
            usage_id: "0192f0c2-6a1e-7c3d-8e4f-0123456789ab",
          }),
          404,
          AIUsageNotFoundError.type,
        );
        await expectProblem(
          await api.getAIUsageText(owner, { usage_id: "not-a-uuid" }),
          400,
          ValidationFailedError.type,
          ["usage_id"],
        );
        await expectProblem(
          await api.postRaw("/get-ai-usage-text", "{", { token: owner }),
          400,
          InvalidJSONError.type,
        );

        // Expired text is unreadable at once and deleted by the worker.
        orgSQL(
          `UPDATE vetchium.org_ai_usage_texts SET expires_at = now()
           WHERE usage_id = '${first.usage.usage_id}'`,
        );
        await expectProblem(
          await api.getAIUsageText(owner, { usage_id: first.usage.usage_id }),
          404,
          AIUsageNotFoundError.type,
        );
        await expect
          .poll(
            () =>
              orgSQL(
                `SELECT count(*) FROM vetchium.org_ai_usage_texts
                 WHERE usage_id = '${first.usage.usage_id}'`,
              ),
            { timeout: 30000 },
          )
          .toBe("0");
        const after = await responseJSON<ListAIUsageResponse>(
          await api.listAIUsage(owner),
        );
        expect(
          after.entries.find((entry) => entry.usage_id === first.usage.usage_id)
            ?.text_available,
        ).toBe(false);

        for (const response of [
          await api.listAIUsage(undefined),
          await api.getAIUsageText(undefined, {
            usage_id: first.usage.usage_id,
          }),
        ]) {
          await expectProblem(response, 401, AuthenticationRequiredError.type);
        }
        const recruiter = await addOrgMember(
          api,
          owner,
          org.domain,
          inviteeAddress(org.domain, "recruiter"),
          ["org:manage_openings"],
        );
        for (const response of [
          await api.listAIUsage(recruiter.token),
          await api.getAIUsageText(recruiter.token, {
            usage_id: second.usage.usage_id,
          }),
        ]) {
          await expectProblem(response, 403, PermissionRequiredError.type);
        }
        suspend(org);
        for (const response of [
          await api.listAIUsage(owner),
          await api.getAIUsageText(owner, { usage_id: second.usage.usage_id }),
        ]) {
          await expectProblem(response, 403, OrgSuspendedError.type);
        }
      },
      { gold: true, enabled: true },
    );
  });

  test("a reservation that never settles is abandoned without charge", async ({
    request,
  }) => {
    await withOrg(
      request,
      async ({ api, org, owner }) => {
        await waitForGrant(api, owner);
        const userID = orgUserID(org.emailAddress);
        orgSQL(
          `INSERT INTO vetchium.org_ai_usage (
             usage_id, org_did, org_user_id, operation, model_oid, host_model,
             input_credits_per_million, output_credits_per_million,
             credits_reserved, idempotency_key, created_at
           ) VALUES (
             gen_random_uuid(), '${orgDID(org.domain)}', '${userID}',
             '${draft}', '${qwen}', 'ai/qwen3:1.7b', 20000, 60000, 500,
             'e2e-stranded', now() - interval '1 hour'
           )`,
        );
        expect((await credits(api, owner)).balance.reserved).toBe(500);
        await expect
          .poll(() => usageRows(org), { timeout: 15000 })
          .toBe("abandoned:abandoned:0");
        expect((await credits(api, owner)).balance).toEqual(
          expect.objectContaining({ available: monthlyGrant, reserved: 0 }),
        );
      },
      { gold: true, enabled: true },
    );
  });
});
