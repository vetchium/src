import assert from "node:assert/strict";
import test from "node:test";
import type { AISettingsResponse } from "typespec/orgs/ai/ai";
import type {
  AICreditBalance,
  AIOperationPolicy,
} from "typespec/orgs/ai/types";
import { creditUse, overallCreditUse } from "./creditUse.ts";
import { formatPrice } from "./format.ts";
import { resendablePolicies } from "./policies.ts";

test("prices use each currency's minor unit", () => {
  assert.equal(formatPrice("en-US", "USD", 1000), "$10.00");
  assert.equal(formatPrice("en-US", "JPY", 1000), "¥1,000");
  assert.equal(formatPrice("de-DE", "EUR", 900), "9,00\u00a0€");
});

test("credit use warns from 80 percent and when nothing is left", () => {
  assert.equal(creditUse(0, 0), undefined);
  assert.deepEqual(creditUse(1000, 1000), {
    used: 0,
    left: 1000,
    total: 1000,
    percent: 0,
    level: "normal",
  });
  assert.equal(creditUse(1000, 201)?.level, "normal");
  assert.equal(creditUse(1000, 200)?.level, "warning");
  assert.equal(creditUse(1000, 1)?.percent, 99);
  assert.deepEqual(creditUse(1000, -5), {
    used: 1000,
    left: 0,
    total: 1000,
    percent: 100,
    level: "exhausted",
  });
});

test("overall credit use adds both sources and counts held credits as used", () => {
  const balance: AICreditBalance = {
    available: 150,
    monthly_grant_remaining: 100,
    monthly_grant_total: 400,
    purchased_remaining: 100,
    purchased_total: 600,
    reserved: 50,
  };
  assert.deepEqual(overallCreditUse(balance), {
    used: 850,
    left: 150,
    total: 1000,
    percent: 85,
    level: "warning",
  });
});

test("resent policies match what the API applies after a withdrawal", () => {
  const offered = (model_oid: string) => ({
    model_oid,
    display_name: model_oid,
    vendor: "Vendor",
    licence: "Apache-2.0",
    status: "offered" as const,
    input_credits_per_million_tokens: 1,
    output_credits_per_million_tokens: 1,
  });
  const resend = (policy: AIOperationPolicy) =>
    resendablePolicies({
      settings: { enabled: true, policies: [policy] },
      models: [offered("qwen"), offered("ministral")],
      operation_defaults: [
        { operation: "org-opening-draft", default_model: "qwen" },
      ],
      current_terms_version: "1",
      plan_allows_ai: true,
      unavailable_models: ["gemma", "deepseek"],
    } satisfies AISettingsResponse);
  const operation = "org-opening-draft";

  assert.deepEqual(resend({ operation, allowed_models: [] }), [
    { operation, allowed_models: [] },
  ]);
  assert.deepEqual(
    resend({
      operation,
      allowed_models: ["gemma", "ministral"],
      default_model: "ministral",
    }),
    [{ operation, allowed_models: ["ministral"], default_model: "ministral" }],
  );
  assert.deepEqual(
    resend({
      operation,
      allowed_models: ["gemma", "ministral"],
      default_model: "gemma",
    }),
    [
      {
        operation,
        allowed_models: ["ministral", "qwen"],
        default_model: "qwen",
      },
    ],
  );
  assert.deepEqual(
    resend({
      operation,
      allowed_models: ["gemma", "deepseek"],
      default_model: "gemma",
    }),
    [{ operation, allowed_models: ["qwen"], default_model: "qwen" }],
  );
});
