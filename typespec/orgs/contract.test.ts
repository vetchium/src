import assert from "node:assert/strict";
import test from "node:test";

import { validateLoginRequest } from "./auth/login.ts";
import { validateRequestPasswordResetRequest } from "./auth/password.ts";
import {
  signupDomain,
  validateCompleteSignupRequest,
  validateRequestSignupRequest,
} from "./auth/signup.ts";
import {
  directPermissions,
  effectivePermissions,
  holds,
  ManageBilling,
  ManageUsers,
  Superadmin,
} from "./authorization/types.ts";
import { frontendLocaleValues, isFrontendLocale } from "./types.ts";
import {
  validateAcceptInvitationRequest,
  validateCancelInvitationsRequest,
  validateInviteUsersRequest,
  validateListInvitationsRequest,
} from "./users/invitations.ts";

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

test("Org invitations validate bulk bounds, permissions, and passwords", () => {
  const addresses = (count: number) =>
    Array.from({ length: count }, (_, index) => `user${index}@example.com`);
  assert.deepEqual(
    validateInviteUsersRequest({ email_addresses: addresses(100) }),
    [],
  );
  assert.deepEqual(
    validateInviteUsersRequest({ email_addresses: addresses(101) }),
    ["email_addresses"],
  );
  assert.deepEqual(validateInviteUsersRequest({ email_addresses: [] }), [
    "email_addresses",
  ]);
  assert.deepEqual(
    validateInviteUsersRequest({
      email_addresses: ["a@example.com", " A@EXAMPLE.COM"],
    }),
    ["email_addresses"],
  );
  assert.deepEqual(
    validateInviteUsersRequest({
      email_addresses: ["not-an-address"],
      permissions: ["org:future"],
    }),
    ["permissions"],
  );
  assert.deepEqual(
    validateListInvitationsRequest({ filter_search: "a", limit: 101 }),
    ["limit", "filter_search"],
  );
  assert.deepEqual(
    validateCancelInvitationsRequest({ email_addresses: ["nope"] }),
    ["email_addresses"],
  );
  assert.deepEqual(
    validateAcceptInvitationRequest({
      invitation_token: "short",
      password: "short",
      preferred_language: "fr-FR" as never,
    }),
    ["invitation_token", "password", "preferred_language"],
  );
});

test("Org permissions: superadmin implies both manage permissions", () => {
  assert.deepEqual(effectivePermissions([Superadmin]), [
    ManageBilling,
    ManageUsers,
    Superadmin,
  ]);
  assert.deepEqual(
    directPermissions([ManageBilling, ManageUsers, Superadmin]),
    [Superadmin],
  );
});
