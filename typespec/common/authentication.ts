export type OpaqueToken = string;
export type TOTPCode = string;
export type TOTPRecoveryCode = string;
export type TOTPEnrollmentToken = OpaqueToken;
export type TOTPManualEntryKey = string;
export type TOTPRecoveryCodeCount = number;
export type NewPassword = string;

export interface TOTPConfiguration {
  algorithm: "SHA1";
  digits: 6;
  period_seconds: 30;
  allowed_clock_skew_steps: 1;
}

export function isOpaqueToken(value: string): boolean {
  const length = [...value].length;
  return length >= 32 && length <= 4096;
}

export function isTOTPCode(value: TOTPCode): boolean {
  return /^[0-9]{6}$/.test(value);
}

export function isTOTPRecoveryCode(value: TOTPRecoveryCode): boolean {
  return (
    value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9 -]+$/.test(value)
  );
}

export function isTOTPManualEntryKey(value: TOTPManualEntryKey): boolean {
  return value.length >= 16 && value.length <= 128 && /^[A-Z2-7]+$/.test(value);
}

export function isNewPassword(value: NewPassword): boolean {
  const length = [...value].length;
  return (
    length >= 15 &&
    length <= 128 &&
    !prohibitedPasswords.has(value.toLowerCase())
  );
}

const prohibitedPasswords = new Set([
  "123456789012345",
  "correct horse battery staple",
  "passwordpassword",
  "qwertyuiopasdfg",
]);

export const standardTOTPConfiguration: Readonly<TOTPConfiguration> = {
  algorithm: "SHA1",
  digits: 6,
  period_seconds: 30,
  allowed_clock_skew_steps: 1,
};
