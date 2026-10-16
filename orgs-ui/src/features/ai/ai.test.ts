import assert from "node:assert/strict";
import test from "node:test";
import type { AIModel } from "typespec/orgs/ai/types";
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
