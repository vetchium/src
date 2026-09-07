import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCompleteSignupRequest,
  validateRequestSignupRequest,
} from "./auth/signup.ts";
import {
  frontendLocaleValues,
  isFrontendLocale,
  isHubHandle,
  isHubUserDID,
} from "./types.ts";

test("Hub locales are canonical and portal-owned", () => {
  assert.deepEqual(frontendLocaleValues, ["en-US", "ta", "de-DE"]);
  for (const locale of frontendLocaleValues)
    assert.equal(Intl.getCanonicalLocales(locale)[0], locale);
  assert.equal(isFrontendLocale("en-US"), true);
  assert.equal(isFrontendLocale("ta"), true);
  assert.equal(isFrontendLocale("de-DE"), true);
  assert.equal(isFrontendLocale("EN-us"), false);
  assert.equal(isFrontendLocale("de-AT"), false);
  assert.equal(isFrontendLocale("fr-FR"), false);
});

test("Hub signup validates locale and ISO country", () => {
  assert.deepEqual(
    validateRequestSignupRequest({
      email_address: "person@example.com",
      display_name: "Person",
      preferred_language: "de-DE",
      resident_country: "DE",
    }),
    [],
  );
  assert.deepEqual(
    validateRequestSignupRequest({
      email_address: "invalid",
      display_name: " ",
      preferred_language: "fr-FR" as "en-US",
      resident_country: "ZZ",
    }),
    ["email_address", "display_name", "preferred_language", "resident_country"],
  );
});

test("Hub signup completion validates token and password", () => {
  assert.deepEqual(
    validateCompleteSignupRequest({
      signup_token: "short",
      password: "short",
    }),
    ["signup_token", "password"],
  );
});

test("Hub identifiers enforce UUIDv7 and fixed-width handles", () => {
  assert.equal(isHubUserDID("018f7e32-7b5a-7d31-8fd0-f7e2a852f144"), true);
  assert.equal(isHubUserDID("018f7e32-7b5a-4d31-8fd0-f7e2a852f144"), false);
  assert.equal(isHubHandle("perso-00000000001"), true);
  assert.equal(isHubHandle("person-00000000001"), false);
});
