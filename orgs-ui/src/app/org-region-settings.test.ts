import assert from "node:assert/strict";
import test from "node:test";
import { parseOrgRegionSettings } from "./org-region-settings.ts";

const tenants = ["sgp", "usa1"];

test("orders plans by rank and requires every region", () => {
  const settings = parseOrgRegionSettings(
    {
      regions: [
        {
          tenantId: "sgp",
          orgPlans: ["org-gold-tier", "org-free-tier", "org-silver-tier"],
        },
        { tenantId: "usa1", orgPlans: ["org-free-tier"] },
      ],
    },
    tenants,
  );
  assert.deepEqual(settings.get("sgp")?.orgPlans, [
    "org-free-tier",
    "org-silver-tier",
    "org-gold-tier",
  ]);
  assert.deepEqual(settings.get("usa1")?.orgPlans, ["org-free-tier"]);
});

test("rejects a table a build must not ship", () => {
  for (const bad of [
    { regions: [{ tenantId: "sgp", orgPlans: ["org-silver-tier"] }] },
    {
      regions: [
        { tenantId: "sgp", orgPlans: ["org-free-tier", "org-platinum-tier"] },
        { tenantId: "usa1", orgPlans: ["org-free-tier"] },
      ],
    },
    {
      regions: [
        { tenantId: "sgp", orgPlans: ["org-free-tier", "org-free-tier"] },
        { tenantId: "usa1", orgPlans: ["org-free-tier"] },
      ],
    },
    { regions: [{ tenantId: "sgp", orgPlans: ["org-free-tier"] }] },
    {
      regions: [
        { tenantId: "mars", orgPlans: ["org-free-tier"] },
        { tenantId: "sgp", orgPlans: ["org-free-tier"] },
        { tenantId: "usa1", orgPlans: ["org-free-tier"] },
      ],
    },
    {},
  ]) {
    assert.throws(() => parseOrgRegionSettings(bad, tenants));
  }
});
