import assert from "node:assert/strict";
import test from "node:test";
import { planPrice } from "./prices.ts";

// The CI region table offers only the free plan in usa1, so the browser tests
// cannot reach its silver price; this keeps every tenant's price covered.
test("every tenant prices silver in its own currency", () => {
  for (const [tenant, currency, month] of [
    ["usa1", "USD", 10],
    ["deu", "EUR", 10],
    ["sgp", "SGD", 10],
    ["ind1", "INR", 1000],
  ] as const) {
    assert.deepEqual(planPrice(tenant, "hub-silver-tier", "month"), {
      amount: month,
      currency,
    });
    assert.deepEqual(planPrice(tenant, "hub-silver-tier", "year"), {
      amount: month * 11,
      currency,
    });
  }
});

test("the free plan and unknown tenants have no price", () => {
  assert.equal(planPrice("usa1", "hub-free-tier", "month"), undefined);
  assert.equal(planPrice("nowhere", "hub-silver-tier", "month"), undefined);
  assert.equal(planPrice("toString", "hub-silver-tier", "month"), undefined);
});
