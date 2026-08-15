import type { TOTPRecoveryCodeCount } from "../../common/authentication.ts";
import type { EmailAddress } from "../../common/common.ts";
import type {
  FrontendLocale,
  LocalizedDisplayName,
  RegionalLanguageCode,
} from "../../common/localization.ts";
import { isFrontendLocale } from "../../common/localization.ts";
import type { AdminAuthorization } from "../authorization/types.ts";
import type { AdminUserID } from "../types.ts";
import type { State } from "../user/user.ts";
import { normalizeDisplayNames, validateDisplayNames } from "./validation.ts";

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

export interface SetDisplayNamesRequest {
  display_names: LocalizedDisplayName[];
  primary_display_name_language: RegionalLanguageCode;
}

export function normalizeSetDisplayNamesRequest(
  request: SetDisplayNamesRequest,
): SetDisplayNamesRequest {
  return {
    ...request,
    display_names: normalizeDisplayNames(request.display_names),
  };
}

export function validateSetDisplayNamesRequest(
  request: SetDisplayNamesRequest,
): string[] {
  const normalized = normalizeSetDisplayNamesRequest(request);
  const validation = validateDisplayNames(
    normalized.display_names,
    normalized.primary_display_name_language,
  );
  const fields: string[] = [];
  if (!validation.valid) {
    fields.push("display_names");
  }
  if (!validation.primaryPresent) {
    fields.push("primary_display_name_language");
  }
  return fields;
}

export interface MyInfoResponse extends AdminAuthorization {
  admin_user_id: AdminUserID;
  email_address: EmailAddress;
  display_names: LocalizedDisplayName[];
  primary_display_name_language: RegionalLanguageCode;
  state: State;
  totp_enabled: boolean;
  recovery_codes_remaining: TOTPRecoveryCodeCount;
  preferred_language: FrontendLocale;
  created_at: string;
  session_authenticated_at: string;
  session_expires_at: string;
  tenant_id: string;
}
