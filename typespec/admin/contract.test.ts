import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateChangePasswordRequest,
  validateCompletePasswordResetRequest,
  validateRequestPasswordResetRequest,
} from "./auth/password.ts";
import {
  validateConfirmTOTPEnrollmentRequest,
  validateVerifyRecoveryCodeRequest,
} from "./auth/totp.ts";
import { validateSetPermissionsRequest } from "./authorization/management.ts";
import {
  AdminPermissions,
  directPermissions,
  effectivePermissions,
  impliedPermissions,
  isAdminPermission,
  ManageHubSignupDomains,
  ManageUsers,
  ViewHubSignupDomains,
  ViewUsers,
} from "./authorization/types.ts";
import {
  isDomainName,
  normalizeCreateRequest as normalizeCreateDomainRequest,
  normalizeListRequest as normalizeDomainListRequest,
  validateCreateRequest as validateCreateDomainRequest,
  validateListRequest as validateDomainListRequest,
  validateUpdateRequest as validateUpdateDomainRequest,
} from "./hub-signup-domains/domains.ts";
import {
  normalizeCompleteSetupRequest,
  validateCompleteSetupRequest,
  validateInviteUserRequest,
} from "./users/invitations.ts";
import {
  validateDisableUserRequest,
  validateListUsersRequest,
} from "./users/management.ts";
import {
  normalizeSetDisplayNameRequest,
  validateSetDisplayNameRequest,
  validateSetPreferredLanguageRequest,
} from "./users/profile.ts";

const uuid = "11111111-1111-4111-8111-111111111111";
const token = "t".repeat(32);

test("password and TOTP requests report all invalid JSON members", () => {
  assert.deepEqual(
    validateRequestPasswordResetRequest({ email_address: " bad " }),
    ["email_address"],
  );
  assert.deepEqual(
    validateCompletePasswordResetRequest({
      reset_token: "short",
      new_password: "short",
    }),
    ["reset_token", "new_password"],
  );
  assert.deepEqual(validateChangePasswordRequest({ new_password: "short" }), [
    "new_password",
  ]);
  assert.deepEqual(
    validateConfirmTOTPEnrollmentRequest({
      totp_enrollment_token: "short",
      totp_code: "12x456",
    }),
    ["totp_enrollment_token", "totp_code"],
  );
  assert.deepEqual(
    validateVerifyRecoveryCodeRequest({
      login_challenge_token: "short",
      recovery_code: "bad/one",
    }),
    ["login_challenge_token", "recovery_code"],
  );
});

test("authorization requests validate identifiers and enums", () => {
  assert.deepEqual(
    validateSetPermissionsRequest({
      admin_user_id: "bad",
      permissions: ["admin:view_users", "admin:manage_domains"],
    }),
    ["admin_user_id", "permissions"],
  );
  assert.deepEqual(
    validateSetPermissionsRequest({
      admin_user_id: uuid,
      permissions: ["admin:view_users", "admin:view_users"],
    }),
    ["permissions"],
  );
  assert.deepEqual(
    validateSetPermissionsRequest({
      admin_user_id: uuid,
      permissions: ["admin:manage_users"],
    }),
    [],
  );
});

test("complete setup normalizes and validates the display name", () => {
  const request = {
    invitation_token: token,
    password: "a sufficiently long password",
    display_name: "  நிர்வாகி  ",
    preferred_language: "ta" as const,
  };
  const normalized = normalizeCompleteSetupRequest(request);
  assert.equal(normalized.display_name, "நிர்வாகி");
  assert.equal(request.display_name, "  நிர்வாகி  ");
  assert.deepEqual(validateCompleteSetupRequest(normalized), []);

  assert.deepEqual(
    validateCompleteSetupRequest({
      ...normalized,
      display_name: " ",
      preferred_language: "fr-FR" as "en-US",
    }),
    ["display_name", "preferred_language"],
  );
  assert.deepEqual(
    validateInviteUserRequest({ email_address: "USER@example.com" }),
    [],
  );
  assert.deepEqual(
    validateInviteUserRequest({
      email_address: "user@example.com",
      permissions: ["admin:view_users", "admin:view_users"],
    }),
    ["permissions"],
  );
});

test("list and profile validators cover defaults and bounds", () => {
  assert.deepEqual(validateListUsersRequest({}), []);
  assert.deepEqual(
    validateListUsersRequest({
      limit: 101,
      pagination_key: "",
      filter_search: "",
      filter_state: "deleted" as "active",
      filter_permissions: ["admin:manage_domains"],
      filter_last_login: "recent" as "never",
    }),
    [
      "limit",
      "pagination_key",
      "filter_search",
      "filter_state",
      "filter_permissions",
      "filter_last_login",
    ],
  );
  assert.deepEqual(validateDisableUserRequest({ admin_user_id: "bad" }), [
    "admin_user_id",
  ]);
  assert.deepEqual(
    validateSetPreferredLanguageRequest({ preferred_language: "de_DE" }),
    [],
  );
});

test("display-name request normalization is immutable", () => {
  const request = { display_name: " Admin " };
  const normalized = normalizeSetDisplayNameRequest(request);
  assert.equal(normalized.display_name, "Admin");
  assert.equal(request.display_name, " Admin ");
  assert.deepEqual(validateSetDisplayNameRequest(normalized), []);
  assert.deepEqual(validateSetDisplayNameRequest({ display_name: " " }), [
    "display_name",
  ]);
});

test("permission implications resolve the same way in every consumer", () => {
  assert.deepEqual(
    [...AdminPermissions],
    [ViewUsers, ManageUsers, ViewHubSignupDomains, ManageHubSignupDomains],
  );
  assert.ok(isAdminPermission(ManageUsers));
  assert.ok(!isAdminPermission("admin:manage_domains"));
  assert.deepEqual([...impliedPermissions(ManageUsers)], [ViewUsers]);
  assert.deepEqual([...impliedPermissions(ViewUsers)], []);
  assert.deepEqual(
    [...impliedPermissions(ManageHubSignupDomains)],
    [ViewHubSignupDomains],
  );
  assert.deepEqual([...impliedPermissions("admin:manage_domains")], []);

  assert.deepEqual(effectivePermissions([]), []);
  assert.deepEqual(effectivePermissions([ManageUsers]), [
    ManageUsers,
    ViewUsers,
  ]);
  assert.deepEqual(effectivePermissions([ViewUsers, ManageUsers]), [
    ManageUsers,
    ViewUsers,
  ]);

  assert.deepEqual(directPermissions([ViewUsers, ManageUsers]), [ManageUsers]);
  assert.deepEqual(directPermissions([ViewUsers]), [ViewUsers]);
});

test("Hub signup domain requests normalize and validate exact domains", () => {
  const create = { domain: "  EXAMPLE.COM.  ", state: "active" as const };
  const normalized = normalizeCreateDomainRequest(create);
  assert.equal(normalized.domain, "example.com");
  assert.equal(create.domain, "  EXAMPLE.COM.  ");
  assert.deepEqual(validateCreateDomainRequest(normalized), []);

  const disabledCreate = {
    domain: "example.org",
    state: "disabled" as const,
    disabled_comment: "  Vendor contract ended  ",
  };
  const normalizedDisabled = normalizeCreateDomainRequest(disabledCreate);
  assert.equal(normalizedDisabled.disabled_comment, "Vendor contract ended");
  assert.equal(disabledCreate.disabled_comment, "  Vendor contract ended  ");
  assert.deepEqual(validateCreateDomainRequest(normalizedDisabled), []);

  for (const domain of [
    "example.com",
    "jobs.example.co.in",
    "xn--bcher-kva.example",
  ]) {
    assert.equal(isDomainName(domain), true, domain);
  }
  for (const domain of [
    "localhost",
    "*.example.com",
    "user@example.com",
    "https://example.com",
    "127.0.0.1",
    "example.123",
    "example..com",
    "bücher.example",
    `${"a".repeat(64)}.example`,
  ]) {
    assert.equal(isDomainName(domain), false, domain);
  }

  assert.deepEqual(
    validateCreateDomainRequest({
      domain: "bad",
      state: "retired" as "active",
    }),
    ["domain", "state"],
  );
  assert.deepEqual(
    validateUpdateDomainRequest({
      hub_signup_domain_id: "bad",
      domain: "bad",
      state: "retired" as "active",
    }),
    ["hub_signup_domain_id", "domain", "state"],
  );
  assert.deepEqual(
    validateUpdateDomainRequest({
      hub_signup_domain_id: uuid,
      domain: "example.com",
      state: "disabled",
    }),
    ["disabled_comment"],
  );
  assert.deepEqual(
    validateUpdateDomainRequest({
      hub_signup_domain_id: uuid,
      domain: "example.com",
      state: "active",
      disabled_comment: "No longer needed",
    }),
    ["disabled_comment"],
  );
  assert.deepEqual(
    validateUpdateDomainRequest({
      hub_signup_domain_id: uuid,
      domain: "example.com",
      state: "disabled",
      disabled_comment: "界".repeat(501),
    }),
    ["disabled_comment"],
  );
});

test("Hub signup domain listing validates defaults, filters, and pagination", () => {
  assert.deepEqual(validateDomainListRequest({}), []);
  const request = { filter_search: "  EXAMPLE  " };
  assert.deepEqual(validateDomainListRequest(request), []);
  const normalized = normalizeDomainListRequest(request);
  assert.equal(normalized.filter_search, "example");
  assert.equal(request.filter_search, "  EXAMPLE  ");
  assert.deepEqual(
    validateDomainListRequest({
      limit: 101,
      pagination_key: "",
      filter_search: "%",
      filter_state: "retired" as "active",
    }),
    ["limit", "pagination_key", "filter_search", "filter_state"],
  );
});

test("permissions an older portal does not define survive a round trip", () => {
  const held = ["admin:view_domains", ManageUsers, ViewUsers];
  assert.deepEqual(directPermissions(held), [
    ManageUsers,
    "admin:view_domains",
  ]);
  assert.deepEqual(effectivePermissions(directPermissions(held)), [
    ManageUsers,
    "admin:view_domains",
    ViewUsers,
  ]);
});
