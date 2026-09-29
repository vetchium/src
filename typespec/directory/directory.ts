import { type HubHandle, type HubUserDID, isHubHandle } from "../hub/types.ts";
import type { OrgDID, OrgDomain } from "../orgs/types.ts";

export type HubAlias = string;
export type TenantID = string;
export type CommandID = string;
export type ProfileSlugKind = "handle" | "alias";
export type PrincipalState = "provisioning" | "active";
export type EmailDigest = string;
export type DigestKeyID = string;
export type EmailChangeReservationState =
  | "reserved"
  | "cancelled"
  | "finalized";

const reservedAliases = new Set([
  "api",
  "admin",
  "auth",
  "help",
  "jobs",
  "login",
  "logout",
  "media",
  "org",
  "privacy",
  "settings",
  "signup",
  "support",
  "terms",
  "u",
]);
export function isHubAlias(value: unknown): value is HubAlias {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 30 &&
    /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(value) &&
    !reservedAliases.has(value) &&
    !isHubHandle(value)
  );
}
export function isTenantID(value: unknown): value is TenantID {
  return typeof value === "string" && /^[a-z][a-z0-9]{2,15}$/.test(value);
}
export function isCommandID(value: unknown): value is CommandID {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
export function isProfileSlug(value: unknown): value is string {
  return typeof value === "string" && (isHubHandle(value) || isHubAlias(value));
}
export function isEmailDigest(value: unknown): value is EmailDigest {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
export function isDigestKeyID(value: unknown): value is DigestKeyID {
  return typeof value === "string" && /^[0-9a-f]{16}$/.test(value);
}

export interface ResolveProfileSlugRequest {
  slug: string;
}
export function validateResolveProfileSlugRequest(
  request: ResolveProfileSlugRequest,
): string[] {
  return isProfileSlug(request.slug) ? [] : ["slug"];
}
export interface ResolveProfileSlugResponse {
  hub_user_did: HubUserDID;
  slug: string;
  kind: ProfileSlugKind;
  home_tenant_id: TenantID;
  routing_version: number;
}
export interface ReserveHubPrincipalRequest {
  command_id: CommandID;
  hub_user_did: HubUserDID;
  handle: HubHandle;
  home_tenant_id: TenantID;
  provisioning_expires_at: string;
  account_email_digest: EmailDigest;
  digest_key_id: DigestKeyID;
}
export interface ActivateHubPrincipalRequest {
  command_id: CommandID;
  hub_user_did: HubUserDID;
}
export interface SetHubAliasRequest {
  command_id: CommandID;
  hub_user_did: HubUserDID;
  profile_alias: HubAlias | null;
  downgrade_release_if_alias?: HubAlias;
}
export interface PrincipalCommandResponse {
  hub_user_did: HubUserDID;
  handle: HubHandle;
  profile_alias: HubAlias | null;
  home_tenant_id: TenantID;
  routing_version: number;
  state: PrincipalState;
}
export interface ResolveOrgDomainRequest {
  domain: OrgDomain;
}
export interface ResolveOrgDomainResponse {
  org_did: OrgDID;
  domain: OrgDomain;
  home_tenant_id: TenantID;
  routing_version: number;
}
export interface ReserveOrgPrincipalRequest {
  command_id: CommandID;
  org_did: OrgDID;
  domain: OrgDomain;
  home_tenant_id: TenantID;
  provisioning_expires_at: string;
}
export interface ActivateOrgPrincipalRequest {
  command_id: CommandID;
  org_did: OrgDID;
}
export interface ReleaseOrgDomainRequest {
  command_id: CommandID;
  org_did: OrgDID;
  domain: OrgDomain;
}
export interface ClaimOrgDomainRequest {
  command_id: CommandID;
  org_did: OrgDID;
  domain: OrgDomain;
}
export interface OrgPrincipalCommandResponse {
  org_did: OrgDID;
  domain: OrgDomain | null;
  home_tenant_id: TenantID;
  routing_version: number;
  state: PrincipalState;
}

export interface ResolveHubAccountEmailRequest {
  email_digest: EmailDigest;
  digest_key_id: DigestKeyID;
}
export interface ResolveHubAccountEmailResponse {
  home_tenant_id: TenantID;
}
export interface ReserveHubAccountEmailChangeRequest {
  command_id: CommandID;
  change_id: CommandID;
  hub_user_did: HubUserDID;
  new_email_digest: EmailDigest;
  not_after: string;
  digest_key_id: DigestKeyID;
}
export interface FinalizeHubAccountEmailChangeRequest {
  command_id: CommandID;
  change_id: CommandID;
  hub_user_did: HubUserDID;
}
export interface AbandonHubAccountEmailChangeRequest {
  command_id: CommandID;
  change_id: CommandID;
  hub_user_did: HubUserDID;
  not_after: string;
}
export interface HubAccountEmailChangeReservationResponse {
  state: EmailChangeReservationState;
}
