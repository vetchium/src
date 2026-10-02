import assert from "node:assert/strict";
import test from "node:test";
import { parseHubRegionSettings } from "./hub-region-settings.ts";

const valid = {
  regions: [
    {
      tenantId: "sgp",
      mediaOrigin: "https://media.sgp.example.com",
      hubPlans: ["hub-silver-tier", "hub-free-tier"],
    },
  ],
};

test("settings keep plans in rank order", () => {
  const settings = parseHubRegionSettings(valid, ["sgp"]);
  assert.deepEqual(settings.get("sgp"), {
    mediaOrigin: "https://media.sgp.example.com",
    hubPlans: ["hub-free-tier", "hub-silver-tier"],
  });
});

test("settings must cover exactly the table's regions", () => {
  assert.throws(
    () => parseHubRegionSettings(valid, ["sgp", "deu"]),
    /region deu has no Hub settings/,
  );
  assert.throws(() => parseHubRegionSettings(valid, ["deu"]), /tenantId/);
});

test("invalid settings are rejected", () => {
  const region = valid.regions[0];
  for (const [entry, message] of [
    [{ ...region, mediaOrigin: "https://media.example.com/x" }, /mediaOrigin/],
    [{ ...region, hubPlans: ["hub-silver-tier"] }, /hubPlans/],
    [{ ...region, hubPlans: ["hub-free-tier", "hub-gold-tier"] }, /hubPlans/],
    [{ ...region, hubPlans: ["hub-free-tier", "hub-free-tier"] }, /hubPlans/],
  ] as const) {
    assert.throws(
      () => parseHubRegionSettings({ regions: [entry] }, ["sgp"]),
      message,
    );
  }
});
