import type { TOTPRecoveryCodeCount } from "../../common/authentication.ts";
import type { EmailAddress } from "../../common/common.ts";
import type { CountryCode, DisplayName } from "../../common/localization.ts";
import type { OrgPermissionID } from "../authorization/types.ts";
import type { Capability } from "../marketplace/capabilities.ts";
import type { OrgPlanOID } from "../subscriptions/plans.ts";
import type { FrontendLocale, OrgDomain } from "../types.ts";

export const OrgActive = "active" as const;
export const OrgSuspended = "suspended" as const;
export type OrgState = typeof OrgActive | typeof OrgSuspended;

export const DomainVerified = "verified" as const;
export const DomainFailing = "failing" as const;
export const DomainReleased = "released" as const;
export type DomainVerificationState =
  | typeof DomainVerified
  | typeof DomainFailing
  | typeof DomainReleased;

export interface DomainStatus {
  domain: OrgDomain;
  state: DomainVerificationState;
  dns_record_name: string;
  dns_record_value: string;
  last_verified_at: string;
  failing_since: string | null;
  release_after: string | null;
}

export interface OrgSummary {
  display_name: DisplayName;
  country: CountryCode;
  default_language: FrontendLocale;
  org_state: OrgState;
  domain: DomainStatus;
}

export interface MyInfoResponse {
  email_address: EmailAddress;
  preferred_language: FrontendLocale;
  permissions: OrgPermissionID[];
  totp_enabled: boolean;
  recovery_codes_remaining: TOTPRecoveryCodeCount;
  session_authenticated_at: string;
  org: OrgSummary;
  plan_oid: OrgPlanOID;
  /** A short-lived signed URL, present only while a logo is set. */
  logo_url?: string;
  google_sign_in_enabled: boolean;
  marketplace: MarketplaceRoles;
}

/**
 * What the Org does in the marketplace, which decides the navigation groups
 * the portal shows; the API still decides every action.
 */
export interface MarketplaceRoles {
  /**
   * The Capabilities the Org has a Listing or an engagement as provider for,
   * each once, in no particular order; empty when it provides nothing.
   */
  capabilities: Capability[];
}

export const CheckPresent = "present" as const;
export const CheckAbsent = "absent" as const;
export const CheckInconclusive = "inconclusive" as const;
export type DomainCheckResult =
  | typeof CheckPresent
  | typeof CheckAbsent
  | typeof CheckInconclusive;

export interface CheckDomainResponse {
  check_result: DomainCheckResult;
  org: OrgSummary;
}
