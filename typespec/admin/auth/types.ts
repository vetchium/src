import type { OpaqueToken } from "../../common/authentication.ts";
import type { LanguageCode, TimeZoneID } from "../../common/localization.ts";

export type AdminSessionToken = OpaqueToken;
export type AdminLoginChallengeToken = OpaqueToken;

export interface AuthenticatedSessionResponse {
  session_token: AdminSessionToken;
  session_expires_at: string;
  effective_language: LanguageCode;
  effective_timezone: TimeZoneID;
}
