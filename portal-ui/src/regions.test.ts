import assert from "node:assert/strict";
import test from "node:test";
import ci from "./regions/ci.json" with { type: "json" };
import dev from "./regions/dev.json" with { type: "json" };
import production from "./regions/production.json" with { type: "json" };
import {
  type PortalEnvironment,
  parsePortalEnvironment,
  parseRegionTable,
} from "./regions.ts";

function validTable() {
  return {
    defaultTenant: "sgp",
    recommendations: { IN: "ind1" },
    regions: [
      {
        tenantId: "sgp",
        hostingCountry: "SG",
        apiOrigin: "https://sgp.api.example.com",
        signupEnabled: true,
        orgSignupEnabled: true,
        allowedCountries: [],
      },
      {
        tenantId: "ind1",
        hostingCountry: "IN",
        apiOrigin: "https://ind1.api.example.com",
        signupEnabled: false,
        orgSignupEnabled: true,
        allowedCountries: ["IN"],
      },
    ],
  };
}

test("every checked-in environment table is valid", () => {
  for (const [environment, table] of Object.entries({ dev, ci, production })) {
    const name = parsePortalEnvironment(environment);
    assert.ok(parseRegionTable(table, name).regions.length > 0);
  }
});

test("an unknown or unset environment fails", () => {
  for (const environment of [undefined, "", "local", "Production"]) {
    assert.throws(
      () => parsePortalEnvironment(environment),
      /VITE_VETCHIUM_ENVIRONMENT must be one of/,
    );
  }
});

test("a valid table parses into a new value", () => {
  const raw = validTable();
  const table = parseRegionTable(raw, "production");
  assert.deepEqual(table, raw);
  assert.notEqual(table.regions, raw.regions);
});

test("invalid tables are rejected", () => {
  const cases: [
    string,
    (table: ReturnType<typeof validTable>) => unknown,
    RegExp,
    PortalEnvironment?,
  ][] = [
    ["unknown member", (t) => ({ ...t, extra: 1 }), /extra is not a known/],
    ["empty regions", (t) => ({ ...t, regions: [] }), /non-empty array/],
    [
      "duplicate tenant",
      (t) => ({ ...t, regions: [t.regions[0], { ...t.regions[0] }] }),
      /regions\[1\]\.tenantId/,
    ],
    [
      "invalid tenant id",
      (t) => ({ ...t, regions: [{ ...t.regions[0], tenantId: "SGP" }] }),
      /regions\[0\]\.tenantId/,
    ],
    [
      "HTTP API origin in production",
      (t) => ({
        ...t,
        regions: [{ ...t.regions[0], apiOrigin: "http://sgp.api.example.com" }],
      }),
      /apiOrigin/,
    ],
    [
      "API origin with a path",
      (t) => ({
        ...t,
        regions: [
          { ...t.regions[0], apiOrigin: "http://sgp.api.example.com/api" },
        ],
      }),
      /apiOrigin/,
      "dev",
    ],
    [
      "missing flag",
      (t) => {
        const { signupEnabled: _, ...region } = t.regions[0] ?? {};
        return { ...t, regions: [region] };
      },
      /regions\[0\]\.signupEnabled must be a boolean/,
    ],
    [
      "duplicate allowed country",
      (t) => ({
        ...t,
        regions: [{ ...t.regions[0], allowedCountries: ["SG", "SG"] }],
      }),
      /allowedCountries/,
    ],
    [
      "unknown default tenant",
      (t) => ({ ...t, defaultTenant: "deu" }),
      /defaultTenant/,
    ],
    [
      "recommendation to an unknown tenant",
      (t) => ({ ...t, recommendations: { DE: "deu" } }),
      /recommendations\.DE/,
    ],
    [
      "recommendation for an invalid country",
      (t) => ({ ...t, recommendations: { XX: "sgp" } }),
      /recommendations\.XX/,
    ],
  ];
  for (const [name, mutate, message, environment] of cases) {
    assert.throws(
      () => parseRegionTable(mutate(validTable()), environment ?? "production"),
      message,
      name,
    );
  }
});
