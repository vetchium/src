import assert from "node:assert/strict";
import test from "node:test";
import { rememberGoogleSignIn, takeGoogleSignIn } from "./pending.ts";

function memory(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

const known = (tenantId: string) => tenantId === "sgp";

test("an entry is taken once", () => {
  const store = memory();
  assert.equal(
    rememberGoogleSignIn(
      { tenantId: "sgp", returnTo: "/members", state: "s1" },
      store,
    ),
    true,
  );
  assert.deepEqual(takeGoogleSignIn(known, store), {
    tenantId: "sgp",
    returnTo: "/members",
    state: "s1",
  });
  assert.equal(takeGoogleSignIn(known, store), null);
});

test("an unknown region, malformed data, or no storage yields nothing", () => {
  const store = memory();
  rememberGoogleSignIn({ tenantId: "mars", returnTo: "/", state: "s" }, store);
  assert.equal(takeGoogleSignIn(known, store), null);
  store.setItem("vetchium.orgs.sso.google", "{not json");
  assert.equal(takeGoogleSignIn(known, store), null);
  store.setItem("vetchium.orgs.sso.google", JSON.stringify({ tenantId: 1 }));
  assert.equal(takeGoogleSignIn(known, store), null);
  store.setItem(
    "vetchium.orgs.sso.google",
    JSON.stringify({ tenantId: "sgp", returnTo: "/" }),
  );
  assert.equal(takeGoogleSignIn(known, store), null);
  assert.equal(
    rememberGoogleSignIn(
      { tenantId: "sgp", returnTo: "/", state: "s" },
      undefined,
    ),
    false,
  );
});

test("a failing store is treated as absent", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(
    rememberGoogleSignIn(
      { tenantId: "sgp", returnTo: "/", state: "s" },
      broken,
    ),
    false,
  );
  assert.equal(takeGoogleSignIn(known, broken), null);
});
