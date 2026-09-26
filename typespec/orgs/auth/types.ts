import type { FrontendLocale } from "../types.ts";

export type OrgSessionToken = string;
export type OrgLoginChallengeToken = string;

export interface AuthenticatedSessionResponse {
  session_token: OrgSessionToken;
  session_expires_at: string;
  preferred_language: FrontendLocale;
}
