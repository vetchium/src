import assert from "node:assert/strict";
import test from "node:test";
import { createPortalAPIClient } from "./api.ts";
import {
  createRegionalAPIOrigin,
  createRegionStore,
  initialRegion,
  regionFromSearchParams,
} from "./region-selection.ts";
import { parseRegionTable } from "./regions.ts";
import { createRegionalSessionStorage } from "./session.ts";

const table = parseRegionTable(
  {
    defaultTenant: "sgp",
    recommendations: { IN: "ind1", DE: "deu" },
    regions: ["sgp", "ind1", "deu"].map((tenantId, index) => ({
      tenantId,
      hostingCountry: ["SG", "IN", "DE"][index],
      apiOrigin: `https://${tenantId}.api.example.com`,
      signupEnabled: true,
      orgSignupEnabled: true,
      allowedCountries: [],
    })),
  },
  "production",
);

function fakeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

async function withGlobal<T>(
  name: string,
  value: unknown,
  run: () => T | Promise<T>,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true });
  try {
    return await run();
  } finally {
    if (descriptor === undefined) {
      delete (globalThis as Record<string, unknown>)[name];
    } else {
      Object.defineProperty(globalThis, name, descriptor);
    }
  }
}

test("the initial region prefers remembered, then recommended, then default", () => {
  assert.equal(initialRegion(table, "deu", ["en-IN"]), "deu");
  assert.equal(initialRegion(table, null, ["en-IN"]), "ind1");
  assert.equal(initialRegion(table, null, ["en"]), "sgp");
  assert.equal(initialRegion(table, null, []), "sgp");
});

test("an unknown remembered region is ignored", () => {
  assert.equal(initialRegion(table, "usa1", ["de-DE"]), "deu");
  assert.equal(initialRegion(table, "", ["de-DE"]), "deu");
});

test("only the first language tag naming a country is consulted", () => {
  assert.equal(initialRegion(table, null, ["not a tag", "hi-IN"]), "ind1");
  assert.equal(initialRegion(table, null, ["de", "en-IN"]), "ind1");
  assert.equal(initialRegion(table, null, ["ja-JP", "en-IN"]), "sgp");
});

test("the store remembers only known regions", async () => {
  const storage = fakeStorage();
  await withGlobal("localStorage", storage, () => {
    const store = createRegionStore({ key: "test.region", table });
    store.remember("ind1");
    assert.equal(store.read(), "ind1");
    store.remember("usa1");
    assert.equal(store.read(), "ind1");
    assert.equal(storage.getItem("test.region"), "ind1");
    storage.setItem("test.region", "usa1");
    const fresh = createRegionStore({ key: "test.region", table });
    assert.equal(fresh.read(), "sgp");
    fresh.select("deu");
    assert.equal(fresh.read(), "deu");
    assert.equal(storage.getItem("test.region"), "usa1");
    fresh.select("usa1");
    assert.equal(fresh.read(), "deu");
  });
});

test("the store keeps the choice in memory when storage throws", async () => {
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  await withGlobal("localStorage", throwing, () => {
    const store = createRegionStore({ key: "test.region", table });
    assert.equal(store.read(), "sgp");
    store.remember("deu");
    assert.equal(store.read(), "deu");
  });
});

test("a link's region parameter must name exactly one known region", () => {
  const read = (query: string) =>
    regionFromSearchParams(table, new URLSearchParams(query));
  assert.equal(read("region=deu&token=x"), "deu");
  assert.equal(read("token=x"), null);
  assert.equal(read("region="), null);
  assert.equal(read("region=usa1"), null);
  assert.equal(read("region=DEU"), null);
  assert.equal(read("region=deu&region=sgp"), null);
});

test("the signed-in session's region wins over the picker", () => {
  let session: string | null = "deu";
  const origin = createRegionalAPIOrigin({
    table,
    sessionTenant: () => session,
    selectedTenant: () => "ind1",
  });
  assert.equal(origin(), "https://deu.api.example.com");
  session = null;
  assert.equal(origin(), "https://ind1.api.example.com");
  session = "usa1";
  assert.throws(origin, /unknown region/);
});

test("a stored session is bound to a known region", async () => {
  const local = fakeStorage();
  const session = fakeStorage();
  await withGlobal("localStorage", local, () =>
    withGlobal("sessionStorage", session, () => {
      const storage = createRegionalSessionStorage<string>({
        key: "test.session",
        table,
        parse: (value) => (typeof value === "string" ? value : null),
      });
      storage.store({ tenantId: "deu", session: "token" }, true);
      assert.deepEqual(storage.read(), { tenantId: "deu", session: "token" });

      for (const stored of [
        { session: "token" },
        { tenantId: "usa1", session: "token" },
        { tenantId: "deu", session: 1 },
        "token",
      ]) {
        local.setItem("test.session", JSON.stringify(stored));
        assert.equal(storage.read(), null, JSON.stringify(stored));
      }
      local.setItem("test.session", "{");
      assert.equal(storage.read(), null);
    }),
  );
});

test("requests go to the configured origin unless one is given", async () => {
  const urls: string[] = [];
  const fetchStub = async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response("{}", { status: 200 });
  };
  await withGlobal("fetch", fetchStub, async () => {
    const configuration = {
      apiPrefix: "/api/hub",
      authenticationProblemType: "auth",
      recentAuthenticationProblemType: "recent",
      sessionExpiredEvent: "expired",
      readToken: () => null,
      clearSession: () => {},
    };
    await createPortalAPIClient(configuration).request("/ping");
    const regional = createPortalAPIClient({
      ...configuration,
      origin: () => "https://deu.api.example.com",
    });
    await regional.request("/ping");
    await regional.request("/ping", { origin: "https://sgp.api.example.com" });
  });
  assert.deepEqual(urls, [
    "/api/hub/ping",
    "https://deu.api.example.com/api/hub/ping",
    "https://sgp.api.example.com/api/hub/ping",
  ]);
});
