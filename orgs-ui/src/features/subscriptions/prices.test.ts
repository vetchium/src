import assert from "node:assert/strict";
import test from "node:test";
import { plans } from "typespec/orgs/subscriptions/plans";
import { planPrice } from "./prices.ts";

const tenants = ["usa1", "deu", "sgp", "ind1"] as const;

test("every tenant prices every paid plan in its own currency", () => {
  for (const tenant of tenants) {
    for (const plan of plans.filter((value) => value !== "org-free-tier")) {
      const month = planPrice(tenant, plan, "month");
      const year = planPrice(tenant, plan, "year");
      assert.ok(month !== undefined && year !== undefined, `${tenant} ${plan}`);
      assert.equal(year.amount, month.amount * 11);
      assert.equal(year.currency, month.currency);
    }
  }
  assert.equal(planPrice("usa1", "org-silver-tier", "month")?.currency, "USD");
  assert.equal(planPrice("deu", "org-silver-tier", "month")?.currency, "EUR");
  assert.equal(planPrice("sgp", "org-silver-tier", "month")?.currency, "SGD");
  assert.equal(planPrice("ind1", "org-silver-tier", "month")?.currency, "INR");
});

test("INR is one hundred times the USD number and gold costs more", () => {
  for (const plan of ["org-silver-tier", "org-gold-tier"] as const) {
    for (const interval of ["month", "year"] as const) {
      const dollars = planPrice("usa1", plan, interval)?.amount ?? 0;
      assert.equal(planPrice("ind1", plan, interval)?.amount, dollars * 100);
    }
  }
  assert.equal(planPrice("sgp", "org-silver-tier", "month")?.amount, 50);
  assert.equal(planPrice("sgp", "org-gold-tier", "month")?.amount, 200);
});

test("the free plan and unknown tenants have no price", () => {
  assert.equal(planPrice("usa1", "org-free-tier", "month"), undefined);
  assert.equal(planPrice("nowhere", "org-silver-tier", "month"), undefined);
  assert.equal(planPrice("toString", "org-silver-tier", "month"), undefined);
});
