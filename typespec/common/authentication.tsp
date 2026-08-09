namespace Vetchium.Authentication;

/** A bounded opaque credential whose internal encoding is not API contract. */
@minLength(32)
@maxLength(4096)
scalar OpaqueToken extends string;

/** A six-digit RFC 6238 time-based one-time password. */
@pattern("^[0-9]{6}$", "Must be a six-digit TOTP code")
scalar TOTPCode extends string;

/** A single-use credential for recovering access when TOTP is unavailable. */
@minLength(8)
@maxLength(128)
@pattern(
  "^[A-Za-z0-9 -]+$",
  "Must contain only letters, digits, spaces, and hyphen separators"
)
scalar TOTPRecoveryCode extends string;

/** An opaque, short-lived token for a pending TOTP enrollment. */
scalar TOTPEnrollmentToken extends OpaqueToken;

/** A Base32 TOTP secret shown only while provisioning an authenticator. */
@minLength(16)
@maxLength(128)
@pattern("^[A-Z2-7]+$", "Must be an unpadded uppercase Base32 value")
scalar TOTPManualEntryKey extends string;

/** Number of unused recovery codes available to an authenticated principal. */
@minValue(0)
@maxValue(10)
scalar TOTPRecoveryCodeCount extends int32;

/** Interoperable parameters used for every Vetchium TOTP enrollment. */
model TOTPConfiguration {
  algorithm: "SHA1";
  digits: 6;
  period_seconds: 30;
  allowed_clock_skew_steps: 1;
}

/**
 * A password accepted when creating or changing a credential. Passwords may
 * contain Unicode and spaces and are checked against a prohibited-password
 * blocklist. They are never trimmed or case-normalized.
 */
@minLength(15)
@maxLength(128)
scalar NewPassword extends string;
