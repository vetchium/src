import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDNSOverHTTPS,
  parseOrgRegionSettings,
} from "./org-region-settings.ts";

const tenants = ["sgp", "usa1"];
const media = "https://media.example";

function region(
  tenantId: string,
  orgPlans: string[],
  allowSpecialUseDomains: unknown = false,
) {
  return { tenantId, allowSpecialUseDomains, mediaOrigin: media, orgPlans };
}

test("orders plans by rank and requires every region", () => {
  const settings = parseOrgRegionSettings(
    {
      regions: [
        region(
          "sgp",
          ["org-gold-tier", "org-free-tier", "org-silver-tier"],
          true,
        ),
        region("usa1", ["org-free-tier"]),
      ],
    },
    tenants,
  );
  assert.deepEqual(settings.get("sgp")?.orgPlans, [
    "org-free-tier",
    "org-silver-tier",
    "org-gold-tier",
  ]);
  assert.equal(settings.get("sgp")?.allowSpecialUseDomains, true);
  assert.deepEqual(settings.get("usa1")?.orgPlans, ["org-free-tier"]);
  assert.equal(settings.get("usa1")?.allowSpecialUseDomains, false);
});

test("rejects a table a build must not ship", () => {
  for (const bad of [
    { regions: [region("sgp", ["org-silver-tier"])] },
    {
      regions: [
        region("sgp", ["org-free-tier", "org-platinum-tier"]),
        region("usa1", ["org-free-tier"]),
      ],
    },
    {
      regions: [
        region("sgp", ["org-free-tier", "org-free-tier"]),
        region("usa1", ["org-free-tier"]),
      ],
    },
    { regions: [region("sgp", ["org-free-tier"])] },
    {
      regions: [
        region("mars", ["org-free-tier"]),
        region("sgp", ["org-free-tier"]),
        region("usa1", ["org-free-tier"]),
      ],
    },
    {
      regions: [
        region("sgp", ["org-free-tier"], "true"),
        region("usa1", ["org-free-tier"]),
      ],
    },
    {
      regions: [
        { tenantId: "sgp", mediaOrigin: media, orgPlans: ["org-free-tier"] },
        region("usa1", ["org-free-tier"]),
      ],
    },
    {},
  ]) {
    assert.throws(() => parseOrgRegionSettings(bad, tenants));
  }
});

test("accepts a DNS-over-HTTPS endpoint URL", () => {
  for (const url of [
    "https://cloudflare-dns.com/dns-query",
    "http://doh.vetchium.localhost/dns-query",
  ]) {
    assert.equal(parseDNSOverHTTPS({ dnsOverHTTPS: url }), url);
  }
});

test("rejects a DNS-over-HTTPS value that is not a plain endpoint", () => {
  for (const bad of [
    {},
    { dnsOverHTTPS: 1 },
    { dnsOverHTTPS: "cloudflare-dns.com/dns-query" },
    { dnsOverHTTPS: "ftp://resolver.example/dns-query" },
    { dnsOverHTTPS: "https://resolver.example/dns-query?dns=x" },
    { dnsOverHTTPS: "https://user:secret@resolver.example/dns-query" },
  ]) {
    assert.throws(() => parseDNSOverHTTPS(bad));
  }
});
