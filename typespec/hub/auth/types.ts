import type { CountryCode, FrontendLocale } from "../../common/localization.ts";
import type { HubHandle, HubUserDID } from "../types.ts";

export type HubSessionToken = string;
export type HubLoginChallengeToken = string;

export interface AuthenticatedSessionResponse {
  session_token: HubSessionToken;
  session_expires_at: string;
  preferred_language: FrontendLocale;
  resident_country: CountryCode;
  hub_user_did: HubUserDID;
  handle: HubHandle;
}
