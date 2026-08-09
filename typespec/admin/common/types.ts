import type { OpaqueToken } from "../../common/authentication.ts";
import type { TimeZoneID } from "../../common/localization.ts";

export type LanguageCode = "en-US" | "de-DE" | "ta-IN";

export const EnglishUnitedStates: LanguageCode = "en-US";
export const GermanGermany: LanguageCode = "de-DE";
export const TamilIndia: LanguageCode = "ta-IN";

export type AdminUserID = string;
export type AdminInvitationID = string;
export type AdminSessionToken = OpaqueToken;
export type AdminLoginChallengeToken = OpaqueToken;
export type AdminInvitationToken = OpaqueToken;
export type AdminPasswordResetToken = OpaqueToken;

export interface AuthenticatedSessionResponse {
  session_token: AdminSessionToken;
  session_expires_at: string;
  effective_language: LanguageCode;
  effective_timezone: TimeZoneID;
}

export function isLanguageCode(value: LanguageCode): boolean {
  return value === "en-US" || value === "de-DE" || value === "ta-IN";
}

export function isAdminUserID(value: AdminUserID): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export const isAdminInvitationID = isAdminUserID;
