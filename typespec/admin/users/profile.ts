import type { TOTPRecoveryCodeCount } from "../../common/authentication.ts";
import type { EmailAddress } from "../../common/common.ts";
import type { DisplayName, FrontendLocale } from "../../common/localization.ts";
import {
  isDisplayName,
  isFrontendLocale,
  normalizeDisplayName,
} from "../../common/localization.ts";
import type { AdminAuthorization } from "../authorization/types.ts";
import type { AdminUserID } from "../types.ts";
import type { State } from "../user/user.ts";

export interface SetPreferredLanguageRequest {
  preferred_language: FrontendLocale;
}

export function validateSetPreferredLanguageRequest(
  request: SetPreferredLanguageRequest,
): string[] {
  return isFrontendLocale(request.preferred_language)
    ? []
    : ["preferred_language"];
}

export interface SetDisplayNameRequest {
  display_name: DisplayName;
}

export function normalizeSetDisplayNameRequest(
  request: SetDisplayNameRequest,
): SetDisplayNameRequest {
  return {
    ...request,
    display_name: normalizeDisplayName(request.display_name),
  };
}

export function validateSetDisplayNameRequest(
  request: SetDisplayNameRequest,
): string[] {
  return isDisplayName(normalizeSetDisplayNameRequest(request).display_name)
    ? []
    : ["display_name"];
}

export interface MyInfoResponse extends AdminAuthorization {
  admin_user_id: AdminUserID;
  email_address: EmailAddress;
  display_name: DisplayName;
  state: State;
  totp_enabled: boolean;
  recovery_codes_remaining: TOTPRecoveryCodeCount;
  preferred_language: FrontendLocale;
  created_at: string;
  session_authenticated_at: string;
  session_expires_at: string;
  tenant_id: string;
}
