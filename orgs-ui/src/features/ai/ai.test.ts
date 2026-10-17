import assert from "node:assert/strict";
import test from "node:test";
import type { AICreditBalance, AIModel } from "typespec/orgs/ai/types";
import { creditUse } from "./creditUse.ts";
import { estimateDraftCredits } from "./estimate.ts";
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
  const balance = (available: number, total: number): AICreditBalance => ({
    available,
    monthly_grant_remaining: available,
    purchased_remaining: 0,
    reserved: 0,
    usable_total: total,
  });
  assert.equal(creditUse(balance(0, 0)), undefined);
  assert.deepEqual(creditUse(balance(1000, 1000)), {
    used: 0,
    total: 1000,
    percent: 0,
    level: "normal",
  });
  assert.equal(creditUse(balance(201, 1000))?.level, "normal");
  assert.equal(creditUse(balance(200, 1000))?.level, "warning");
  assert.equal(creditUse(balance(1, 1000))?.percent, 99);
  assert.deepEqual(creditUse(balance(0, 1000)), {
    used: 1000,
    total: 1000,
    percent: 100,
    level: "exhausted",
  });
});
