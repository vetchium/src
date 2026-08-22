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
  ManageUsers,
  ViewUsers,
} from "./authorization/types.ts";
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
  assert.deepEqual([...AdminPermissions], [ViewUsers, ManageUsers]);
  assert.ok(isAdminPermission(ManageUsers));
  assert.ok(!isAdminPermission("admin:manage_domains"));
  assert.deepEqual([...impliedPermissions(ManageUsers)], [ViewUsers]);
  assert.deepEqual([...impliedPermissions(ViewUsers)], []);
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
