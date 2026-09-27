import assert from "node:assert/strict";
import test from "node:test";

import { validateLoginRequest } from "./auth/login.ts";
import { validateRequestPasswordResetRequest } from "./auth/password.ts";
import {
  signupDomain,
  validateCompleteSignupRequest,
  validateRequestSignupRequest,
} from "./auth/signup.ts";
import { holds, Superadmin } from "./authorization/types.ts";
import { frontendLocaleValues, isFrontendLocale } from "./types.ts";

test("Org locales are canonical and portal-owned", () => {
  assert.deepEqual(frontendLocaleValues, ["en-US", "ta", "de-DE"]);
  for (const locale of frontendLocaleValues)
    assert.equal(Intl.getCanonicalLocales(locale)[0], locale);
  assert.equal(isFrontendLocale("fr-FR"), false);
});

test("Org signup claims exactly the email address's domain", () => {
  assert.equal(signupDomain(" IT@Eu.Example.COM "), "eu.example.com");
  assert.deepEqual(
    validateRequestSignupRequest({
      email_address: "it@example.com",
      preferred_language: "ta",
    }),
    [],
  );
  assert.deepEqual(
    validateRequestSignupRequest({
      email_address: "it@localhost",
      preferred_language: "fr-FR",
    }),
    ["email_address", "preferred_language"],
  );
  assert.deepEqual(
    validateCompleteSignupRequest({
      signup_token: "short",
      org_display_name: "  ",
      password: "short",
    }),
    ["signup_token", "org_display_name", "password"],
  );
});

test("Org sign-in and password reset require a domain", () => {
  assert.deepEqual(
    validateLoginRequest({
      domain: "Example.COM.",
      email_address: "IT@example.com",
      password: "x",
    }),
    [],
  );
  assert.deepEqual(
    validateLoginRequest({ domain: "", email_address: "", password: "" }),
    ["domain", "email_address", "password"],
  );
  assert.deepEqual(
    validateRequestPasswordResetRequest({
      domain: "example",
      email_address: "x",
    }),
    ["domain", "email_address"],
  );
});

test("Org permissions keep unknown identifiers", () => {
  assert.equal(holds(["org:future", Superadmin], Superadmin), true);
  assert.equal(holds(["org:future"], Superadmin), false);
});
