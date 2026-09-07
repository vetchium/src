import assert from "node:assert/strict";
import test from "node:test";
import { matchFrontendLocale } from "./localization.ts";

test("browser matching uses the calling portal's supported locales", () => {
  const adminLocales = ["en-US"] as const;
  const hubLocales = ["en-US", "de-DE"] as const;

  assert.equal(matchFrontendLocale(["de-DE"], adminLocales), undefined);
  assert.equal(matchFrontendLocale(["de-DE"], hubLocales), "de-DE");
  assert.equal(matchFrontendLocale(["fr-FR"], hubLocales), undefined);
  assert.equal(
    matchFrontendLocale(["invalid", "en-GB"], adminLocales),
    "en-US",
  );
});
