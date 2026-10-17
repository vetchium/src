import assert from "node:assert/strict";
import test from "node:test";
import type { AICreditBalance, AIModel } from "typespec/orgs/ai/types";
import { creditUse, overallCreditUse } from "./creditUse.ts";
import { estimateDraftCredits, typicalDraftCredits } from "./estimate.ts";
import { formatPrice } from "./format.ts";

const model: AIModel = {
  model_oid: "qwen3-1-7b",
  display_name: "Qwen3 1.7B",
  vendor: "Qwen",
  licence: "Apache-2.0",
  status: "offered",
  input_credits_per_million_tokens: 20000,
  output_credits_per_million_tokens: 60000,
};

test("a draft estimate grows with the prompt and is never zero", () => {
  const short = estimateDraftCredits(model, "Engineer", {});
  const long = estimateDraftCredits(model, "Engineer ".repeat(400), {
    description: "x".repeat(4000),
  });
  assert.ok(short > 0);
  assert.ok(long > short);
  assert.equal(
    estimateDraftCredits(
      {
        ...model,
        input_credits_per_million_tokens: 0,
        output_credits_per_million_tokens: 0,
      },
      "x",
      {},
    ),
    1,
  );
});

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

test("a typical draft costs more than an empty one", () => {
  assert.ok(typicalDraftCredits(model) > estimateDraftCredits(model, "", {}));
});
