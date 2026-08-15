import type { OpaqueToken } from "../../common/authentication.ts";
import type { FrontendLocale } from "../../common/localization.ts";

export type AdminSessionToken = OpaqueToken;
export type AdminLoginChallengeToken = OpaqueToken;

export interface AuthenticatedSessionResponse {
  session_token: AdminSessionToken;
  session_expires_at: string;
  preferred_language: FrontendLocale;
}
