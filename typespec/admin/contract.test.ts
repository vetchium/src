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
import {
  validateGrantPermissionRequest,
  validatePromoteToSuperadminRequest,
} from "./authorization/management.ts";
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
  normalizeSetDisplayNamesRequest,
  validateSetDisplayNamesRequest,
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
    validateGrantPermissionRequest({
      admin_user_id: "bad",
      permission: "unknown" as "admin:view_users",
    }),
    ["admin_user_id", "permission"],
  );
  assert.deepEqual(
    validatePromoteToSuperadminRequest({ admin_user_id: uuid }),
    [],
  );
});

test("complete setup normalizes a deep copy and validates coupled names", () => {
  const request = {
    invitation_token: token,
    password: "a sufficiently long password",
    display_names: [
      { language_code: "en-US", display_name: "  Admin  " },
      { language_code: "ta-IN", display_name: " நிர்வாகி " },
    ],
    primary_display_name_language: "en-US",
    preferred_language: "ta" as const,
  };
  const normalized = normalizeCompleteSetupRequest(request);
  assert.equal(normalized.display_names[0]?.display_name, "Admin");
  assert.equal(request.display_names[0]?.display_name, "  Admin  ");
  assert.deepEqual(validateCompleteSetupRequest(normalized), []);

  assert.deepEqual(
    validateCompleteSetupRequest({
      ...normalized,
      display_names: [
        { language_code: "en-US", display_name: "Admin" },
        { language_code: "en-US", display_name: "Duplicate" },
      ],
      primary_display_name_language: "ta-IN",
      preferred_language: "fr-FR" as "en-US",
    }),
    ["display_names", "primary_display_name_language", "preferred_language"],
  );
  assert.deepEqual(
    validateInviteUserRequest({ email_address: "USER@example.com" }),
    [],
  );
});

test("list and profile validators cover defaults and bounds", () => {
  assert.deepEqual(validateListUsersRequest({}), []);
  assert.deepEqual(
    validateListUsersRequest({
      limit: 101,
      pagination_key: "",
      filter_email_address: "",
      filter_display_name: "x".repeat(321),
      filter_state: "deleted" as "active",
      filter_permission: "unknown" as "admin:view_users",
    }),
    [
      "limit",
      "pagination_key",
      "filter_email_address",
      "filter_display_name",
      "filter_state",
      "filter_permission",
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

test("display-name request normalization is immutable and primary-aware", () => {
  const request = {
    display_names: [{ language_code: "en-US", display_name: " Admin " }],
    primary_display_name_language: "en-US",
  };
  const normalized = normalizeSetDisplayNamesRequest(request);
  assert.equal(normalized.display_names[0]?.display_name, "Admin");
  assert.equal(request.display_names[0]?.display_name, " Admin ");
  assert.deepEqual(validateSetDisplayNamesRequest(normalized), []);
  assert.deepEqual(
    validateSetDisplayNamesRequest({
      display_names: [],
      primary_display_name_language: "en-US",
    }),
    ["display_names", "primary_display_name_language"],
  );
});
