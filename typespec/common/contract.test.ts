import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isNewPassword,
  isOpaqueToken,
  isTOTPCode,
  isTOTPManualEntryKey,
  isTOTPRecoveryCode,
} from "./authentication.ts";
import { isEmailAddress } from "./common.ts";
import { isIdempotencyKey } from "./idempotency.ts";
import {
  isDisplayName,
  isFrontendLocale,
  isRegionalLanguageCode,
  normalizeDisplayName,
} from "./localization.ts";
import { isPageSize, isPaginationKey } from "./pagination.ts";

test("authentication scalar validators enforce every boundary", () => {
  assert.equal(isOpaqueToken("x".repeat(31)), false);
  assert.equal(isOpaqueToken("x".repeat(32)), true);
  assert.equal(isOpaqueToken("x".repeat(4096)), true);
  assert.equal(isOpaqueToken("x".repeat(4097)), false);
  assert.equal(isOpaqueToken("🙂".repeat(31)), false);
  assert.equal(isOpaqueToken("🙂".repeat(32)), true);
  assert.equal(isOpaqueToken("🙂".repeat(4096)), true);
  assert.equal(isOpaqueToken("🙂".repeat(4097)), false);
  assert.equal(isTOTPCode("012345"), true);
  assert.equal(isTOTPCode("12345"), false);
  assert.equal(isTOTPCode("12345a"), false);
  assert.equal(isTOTPRecoveryCode("ABCD-1234"), true);
  assert.equal(isTOTPRecoveryCode("bad/code"), false);
  assert.equal(isTOTPManualEntryKey("ABCDEFGHIJKLMNOP"), true);
  assert.equal(isTOTPManualEntryKey("abcdefghijklmnop"), false);
  assert.equal(isNewPassword("🙂".repeat(15)), true);
  assert.equal(isNewPassword("🙂".repeat(14)), false);
  assert.equal(isNewPassword("x".repeat(128)), true);
  assert.equal(isNewPassword("x".repeat(129)), false);
});

test("idempotency key validator enforces URL-safe ASCII and length", () => {
  assert.equal(isIdempotencyKey("a".repeat(22)), true);
  assert.equal(isIdempotencyKey(`a${"._~-Z09".repeat(18)}`), true);
  assert.equal(isIdempotencyKey("a".repeat(21)), false);
  assert.equal(isIdempotencyKey(`-${"a".repeat(21)}`), false);
  assert.equal(isIdempotencyKey(`a${"/".repeat(21)}`), false);
  assert.equal(isIdempotencyKey("a".repeat(129)), false);
});

test("localization validators require canonical registered identifiers", () => {
  assert.equal(isFrontendLocale("en-US"), true);
  assert.equal(isFrontendLocale("ta"), true);
  assert.equal(isFrontendLocale("de_DE"), true);
  assert.equal(isFrontendLocale("fr-FR"), false);
  assert.equal(isRegionalLanguageCode("en-US"), true);
  assert.equal(isRegionalLanguageCode("bn-IN"), true);
  assert.equal(isRegionalLanguageCode("en-us"), false);
  assert.equal(isRegionalLanguageCode("zz-ZZ"), false);
  assert.equal(isRegionalLanguageCode("en-XA"), false);
  assert.equal(isRegionalLanguageCode("en-AA"), false);
  assert.equal(normalizeDisplayName("  நிர்வாகி  "), "நிர்வாகி");
  assert.equal(isDisplayName("  நிர்வாகி  "), true);
  assert.equal(isDisplayName("   "), false);
  assert.equal(isDisplayName("x".repeat(201)), false);
});

test("email validation follows the shared ASCII addr-spec policy", () => {
  const cases: Array<[string, boolean]> = [
    ["person@example.test", true],
    [" First.Last+tag@Example.COM ", true],
    ["a@localhost", true],
    ["a@.", false],
    [".a@example.test", false],
    ["a..b@example.test", false],
    ["a@-example.test", false],
    ["a@example-.test", false],
    ["a@example..test", false],
    ["display <a@example.test>", false],
    ['"quoted"@example.test', false],
    ["a@exa_mple.test", false],
    [`${"a".repeat(65)}@example.test`, false],
  ];
  for (const [value, expected] of cases) {
    assert.equal(isEmailAddress(value), expected, value);
  }
});

test("pagination validators enforce integer and length bounds", () => {
  assert.equal(isPageSize(1), true);
  assert.equal(isPageSize(100), true);
  assert.equal(isPageSize(0), false);
  assert.equal(isPageSize(101), false);
  assert.equal(isPageSize(1.5), false);
  assert.equal(isPaginationKey("x"), true);
  assert.equal(isPaginationKey(""), false);
  assert.equal(isPaginationKey("x".repeat(4097)), false);
  assert.equal(isPaginationKey("🙂"), true);
  assert.equal(isPaginationKey("🙂".repeat(4096)), true);
  assert.equal(isPaginationKey("🙂".repeat(4097)), false);
});
