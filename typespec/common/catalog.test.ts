import assert from "node:assert/strict";
import test from "node:test";
import { currencyCatalog, isCurrencyCode } from "./currency_catalog.ts";
import { isLanguageTag, languageCatalog } from "./language_catalog.ts";

test("currency catalog accepts active codes and rejects invalid codes", () => {
  for (const code of ["USD", "EUR", "INR"]) {
    assert.equal(isCurrencyCode(code), true, code);
  }
  for (const code of ["usd", "ZZZ", "", "US"]) {
    assert.equal(isCurrencyCode(code), false, code);
  }
  assert.ok(currencyCatalog.length > 0);
});

test("common language catalog keeps the profile vocabulary", () => {
  assert.equal(languageCatalog.length, 578);
  assert.equal(isLanguageTag("ta"), true);
  assert.equal(isLanguageTag("en-US"), false);
});
