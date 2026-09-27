import "@typespec/http";
import "../common/idempotency.tsp";
import "../hub/types.tsp";
import "../orgs/types.tsp";
import "../problem/common.tsp";
import "../problem/details.tsp";
import "../problem/global-coordinator/directory.tsp";
import "../problem/global-coordinator/authentication.tsp";

using TypeSpec.Http;

namespace Vetchium.Directory;

@minLength(3)
@maxLength(30)
scalar HubAlias extends string;

@pattern("^[a-z][a-z0-9]{2,15}$")
scalar TenantID extends string;

@format("uuid")
scalar CommandID extends string;

enum ProfileSlugKind {
  Handle: "handle",
  Alias: "alias",
}

model ResolveProfileSlugRequest {
  slug: string;
}

model ResolveProfileSlugResponse {
  hub_user_did: Vetchium.Hub.HubUserDID;
  slug: string;
  kind: ProfileSlugKind;
  home_tenant_id: TenantID;
  routing_version: int64;
}

@pattern("^[0-9a-f]{64}$")
scalar EmailDigest extends string;

@pattern("^[0-9a-f]{16}$")
scalar DigestKeyID extends string;

model ReserveHubPrincipalRequest {
  command_id: CommandID;
  hub_user_did: Vetchium.Hub.HubUserDID;
  handle: Vetchium.Hub.HubHandle;
  home_tenant_id: TenantID;
  provisioning_expires_at: utcDateTime;
  account_email_digest: EmailDigest;
  digest_key_id: DigestKeyID;
}

model ActivateHubPrincipalRequest {
  command_id: CommandID;
  hub_user_did: Vetchium.Hub.HubUserDID;
}

model SetHubAliasRequest {
  command_id: CommandID;
  hub_user_did: Vetchium.Hub.HubUserDID;
  profile_alias: HubAlias | null;

  /**
   * Internal entitlement cleanup only: release the alias if it still equals
   * this value, without consuming or observing the user's change cooldown.
   * Valid only when profile_alias is null.
   */
  downgrade_release_if_alias?: HubAlias;
}

model PrincipalCommandResponse {
  hub_user_did: Vetchium.Hub.HubUserDID;
  handle: Vetchium.Hub.HubHandle;
  profile_alias: HubAlias | null;
  home_tenant_id: TenantID;
  routing_version: int64;
  state: "provisioning" | "active";
}

model ResolveOrgDomainRequest {
  domain: Vetchium.Orgs.OrgDomain;
}

model ResolveOrgDomainResponse {
  org_did: Vetchium.Orgs.OrgDID;
  domain: Vetchium.Orgs.OrgDomain;
  home_tenant_id: TenantID;
  routing_version: int64;
}

/** Reserves a provisioning Org and its first domain in one step. The domain
 * stays unresolvable until activation, and an expired reservation is reaped
 * together with its domain. */
model ReserveOrgPrincipalRequest {
  command_id: CommandID;
  org_did: Vetchium.Orgs.OrgDID;
  domain: Vetchium.Orgs.OrgDomain;
  home_tenant_id: TenantID;
  provisioning_expires_at: utcDateTime;
}

model ActivateOrgPrincipalRequest {
  command_id: CommandID;
  org_did: Vetchium.Orgs.OrgDID;
}

/** Releases the domain if this Org still owns it. Releasing a domain the Org
 * no longer owns succeeds without a change. */
model ReleaseOrgDomainRequest {
  command_id: CommandID;
  org_did: Vetchium.Orgs.OrgDID;
  domain: Vetchium.Orgs.OrgDomain;
}

/** Claims a domain for an active Org that holds none, as when a suspended Org
 * proves a released domain again. Claiming the domain the Org already owns
 * succeeds without a change. */
model ClaimOrgDomainRequest {
  command_id: CommandID;
  org_did: Vetchium.Orgs.OrgDID;
  domain: Vetchium.Orgs.OrgDomain;
}

model OrgPrincipalCommandResponse {
  org_did: Vetchium.Orgs.OrgDID;
  domain: Vetchium.Orgs.OrgDomain | null;
  home_tenant_id: TenantID;
  routing_version: int64;
  state: "provisioning" | "active";
}

model ResolveHubAccountEmailRequest {
  email_digest: EmailDigest;
  digest_key_id: DigestKeyID;
}

/** Never reveals the DID (GU-DIR-001). */
model ResolveHubAccountEmailResponse {
  home_tenant_id: TenantID;
}

model ReserveHubAccountEmailChangeRequest {
  command_id: CommandID;
  change_id: CommandID;
  hub_user_did: Vetchium.Hub.HubUserDID;
  new_email_digest: EmailDigest;
  not_after: utcDateTime;
  digest_key_id: DigestKeyID;
}

model FinalizeHubAccountEmailChangeRequest {
  command_id: CommandID;
  change_id: CommandID;
  hub_user_did: Vetchium.Hub.HubUserDID;
}

model AbandonHubAccountEmailChangeRequest {
  command_id: CommandID;
  change_id: CommandID;
  hub_user_did: Vetchium.Hub.HubUserDID;
  not_after: utcDateTime;
}

model HubAccountEmailChangeReservationResponse {
  state: "reserved" | "cancelled" | "finalized";
}

model ClaimHubProfessionalEmailRequest {
  command_id: CommandID;
  hub_user_did: Vetchium.Hub.HubUserDID;
  email_digest: EmailDigest;
  digest_key_id: DigestKeyID;
}

/**
 * superseded_same_tenant_hub_user_did is present only when the previous
 * holder's home tenant is the caller, so the caller can supersede locally in
 * the same step. It never reveals a DID from another tenant.
 */
model ClaimHubProfessionalEmailResponse {
  claim_revision: int64;
  superseded_same_tenant_hub_user_did?: Vetchium.Hub.HubUserDID;
}

model ReleaseHubProfessionalEmailRequest {
  command_id: CommandID;
  hub_user_did: Vetchium.Hub.HubUserDID;
  email_digest: EmailDigest;
  claim_revision: int64;
}

model ReleaseHubProfessionalEmailResponse {
  released: boolean;
}

@maxValue(500)
scalar HubProfessionalEmailSupersessionsLimit extends int32;

model PullHubProfessionalEmailSupersessionsRequest {
  acknowledged_seq: int64;
  limit: HubProfessionalEmailSupersessionsLimit;
}

/** hub_user_did is always homed at the caller: it is the caller's own Hub
 * user who lost this professional-email claim. */
model HubProfessionalEmailSupersession {
  supersession_seq: int64;
  hub_user_did: Vetchium.Hub.HubUserDID;
  email_digest: EmailDigest;
  superseded_by_revision: int64;
}

model PullHubProfessionalEmailSupersessionsResponse {
  supersessions: HubProfessionalEmailSupersession[];
  acknowledged_seq: int64;
  oldest_pending_created_at: utcDateTime | null;
}

model HubProfessionalEmailHoldingQuery {
  hub_user_did: Vetchium.Hub.HubUserDID;
  email_digest: EmailDigest;
}

model CheckHubProfessionalEmailHoldingsRequest {
  @maxItems(500)
  items: HubProfessionalEmailHoldingQuery[];
}

/** Never reveals another holder's DID. claim_revision is null whenever the
 * address is not currently held by anyone. */
model HubProfessionalEmailHoldingResult {
  held_by_requested_user: boolean;
  claim_revision: int64 | null;
}

model CheckHubProfessionalEmailHoldingsResponse {
  results: HubProfessionalEmailHoldingResult[];
}

alias ReadResponseBase =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: ResolveProfileSlugResponse;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.DirectoryEntryNotFoundErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias CommandResponseBase =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: PrincipalCommandResponse;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
  | Vetchium.Problem.DirectoryStateConflictErrorResponse
  | Vetchium.Problem.DirectoryCallerTenantMismatchErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

/**
 * Reserving a handle or claiming an alias competes for a globally unique
 * name. Activation only advances a principal the caller already reserved, so
 * it has no name left to lose.
 */
alias ClaimCommandResponseBase =
  | CommandResponseBase
  | Vetchium.Problem.DirectoryClaimConflictErrorResponse;

/**
 * The email digest is checked first, so a digest already claimed elsewhere
 * never burns a handle-rotation attempt: directory-email-claim-conflict is
 * distinct from directory-claim-conflict, which is the handle collision.
 */
alias ReserveHubPrincipalResponseBase =
  | ClaimCommandResponseBase
  | Vetchium.Problem.DirectoryEmailClaimConflictErrorResponse
  | Vetchium.Problem.DirectoryDigestKeyMismatchErrorResponse;

alias ResolveHubAccountEmailResponseBase =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: ResolveHubAccountEmailResponse;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.DirectoryEntryNotFoundErrorResponse
  | Vetchium.Problem.DirectoryDigestKeyMismatchErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias EmailChangeCommandResponseBase =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: HubAccountEmailChangeReservationResponse;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
  | Vetchium.Problem.DirectoryStateConflictErrorResponse
  | Vetchium.Problem.DirectoryCallerTenantMismatchErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias ReserveHubAccountEmailChangeResponseBase =
  | EmailChangeCommandResponseBase
  | Vetchium.Problem.DirectoryEmailClaimConflictErrorResponse
  | Vetchium.Problem.DirectoryDigestKeyMismatchErrorResponse
  | Vetchium.Problem.DirectoryReservationExpiredErrorResponse
  | Vetchium.Problem.DirectoryReservationCancelledErrorResponse;

alias ClaimHubProfessionalEmailResponseBase =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: ClaimHubProfessionalEmailResponse;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
  | Vetchium.Problem.DirectoryStateConflictErrorResponse
  | Vetchium.Problem.DirectoryCallerTenantMismatchErrorResponse
  | Vetchium.Problem.DirectoryDigestKeyMismatchErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias ReleaseHubProfessionalEmailResponseBase =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: ReleaseHubProfessionalEmailResponse;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
  | Vetchium.Problem.DirectoryCallerTenantMismatchErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

/**
 * Caller-scoped and naturally idempotent (it mutates only the caller's own
 * cursor), so it bypasses the command ledger and carries no
 * idempotency-key-conflict or caller-tenant-mismatch response.
 */
alias PullHubProfessionalEmailSupersessionsResponseBase =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: PullHubProfessionalEmailSupersessionsResponse;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.DirectoryStateConflictErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias CheckHubProfessionalEmailHoldingsResponseBase =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: CheckHubProfessionalEmailHoldingsResponse;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.DirectoryCallerTenantMismatchErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias OrgReadResponseBase =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: ResolveOrgDomainResponse;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.DirectoryEntryNotFoundErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias OrgCommandResponseBase =
  | {
      @statusCode status_code: 200;
      @header("Cache-Control") cache_control: "no-store";
      @body body: OrgPrincipalCommandResponse;
    }
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
  | Vetchium.Problem.DirectoryStateConflictErrorResponse
  | Vetchium.Problem.DirectoryCallerTenantMismatchErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

alias OrgClaimCommandResponseBase =
  | OrgCommandResponseBase
  | Vetchium.Problem.DirectoryClaimConflictErrorResponse;

alias ReadResponse =
  | ReadResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;

alias CommandResponse =
  | CommandResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;

alias ClaimCommandResponse =
  | ClaimCommandResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;

alias OrgReadResponse =
  | OrgReadResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;

alias OrgCommandResponse =
  | OrgCommandResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;

alias OrgClaimCommandResponse =
  | OrgClaimCommandResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;

alias MeshOrgReadResponse =
  | OrgReadResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias MeshOrgCommandResponse =
  | OrgCommandResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias MeshOrgClaimCommandResponse =
  | OrgClaimCommandResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias MeshReadResponse =
  | ReadResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias MeshCommandResponse =
  | CommandResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias MeshClaimCommandResponse =
  | ClaimCommandResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias ReserveHubPrincipalResponse =
  | ReserveHubPrincipalResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;
alias MeshReserveHubPrincipalResponse =
  | ReserveHubPrincipalResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias ResolveHubAccountEmailResult =
  | ResolveHubAccountEmailResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;
alias MeshResolveHubAccountEmailResult =
  | ResolveHubAccountEmailResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias ReserveHubAccountEmailChangeResult =
  | ReserveHubAccountEmailChangeResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;
alias MeshReserveHubAccountEmailChangeResult =
  | ReserveHubAccountEmailChangeResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias EmailChangeCommandResult =
  | EmailChangeCommandResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;
alias MeshEmailChangeCommandResult =
  | EmailChangeCommandResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias ClaimHubProfessionalEmailResult =
  | ClaimHubProfessionalEmailResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;
alias MeshClaimHubProfessionalEmailResult =
  | ClaimHubProfessionalEmailResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias ReleaseHubProfessionalEmailResult =
  | ReleaseHubProfessionalEmailResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;
alias MeshReleaseHubProfessionalEmailResult =
  | ReleaseHubProfessionalEmailResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias PullHubProfessionalEmailSupersessionsResult =
  | PullHubProfessionalEmailSupersessionsResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;
alias MeshPullHubProfessionalEmailSupersessionsResult =
  | PullHubProfessionalEmailSupersessionsResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias CheckHubProfessionalEmailHoldingsResult =
  | CheckHubProfessionalEmailHoldingsResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;
alias MeshCheckHubProfessionalEmailHoldingsResult =
  | CheckHubProfessionalEmailHoldingsResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

@route("/api/global-coordinator/directory")
@tag("Global directory")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface Operations {
  @route("/resolve-profile-slug")
  @post
  resolveProfileSlug(@body request: ResolveProfileSlugRequest): ReadResponse;

  @route("/reserve-hub-principal")
  @post
  reserveHubPrincipal(
    @body request: ReserveHubPrincipalRequest,
  ): ReserveHubPrincipalResponse;

  @route("/activate-hub-principal")
  @post
  activateHubPrincipal(
    @body request: ActivateHubPrincipalRequest,
  ): CommandResponse;

  @route("/set-hub-alias")
  @post
  setHubAlias(@body request: SetHubAliasRequest): ClaimCommandResponse;

  @route("/resolve-hub-account-email")
  @post
  resolveHubAccountEmail(
    @body request: ResolveHubAccountEmailRequest,
  ): ResolveHubAccountEmailResult;

  @route("/reserve-hub-account-email-change")
  @post
  reserveHubAccountEmailChange(
    @body request: ReserveHubAccountEmailChangeRequest,
  ): ReserveHubAccountEmailChangeResult;

  @route("/finalize-hub-account-email-change")
  @post
  finalizeHubAccountEmailChange(
    @body request: FinalizeHubAccountEmailChangeRequest,
  ): EmailChangeCommandResult;

  @route("/abandon-hub-account-email-change")
  @post
  abandonHubAccountEmailChange(
    @body request: AbandonHubAccountEmailChangeRequest,
  ): EmailChangeCommandResult;

  @route("/claim-hub-professional-email")
  @post
  claimHubProfessionalEmail(
    @body request: ClaimHubProfessionalEmailRequest,
  ): ClaimHubProfessionalEmailResult;

  @route("/release-hub-professional-email")
  @post
  releaseHubProfessionalEmail(
    @body request: ReleaseHubProfessionalEmailRequest,
  ): ReleaseHubProfessionalEmailResult;

  @route("/pull-hub-professional-email-supersessions")
  @post
  pullHubProfessionalEmailSupersessions(
    @body request: PullHubProfessionalEmailSupersessionsRequest,
  ): PullHubProfessionalEmailSupersessionsResult;

  @route("/check-hub-professional-email-holdings")
  @post
  checkHubProfessionalEmailHoldings(
    @body request: CheckHubProfessionalEmailHoldingsRequest,
  ): CheckHubProfessionalEmailHoldingsResult;

  @route("/resolve-org-domain")
  @post
  resolveOrgDomain(@body request: ResolveOrgDomainRequest): OrgReadResponse;

  @route("/reserve-org-principal")
  @post
  reserveOrgPrincipal(
    @body request: ReserveOrgPrincipalRequest,
  ): OrgClaimCommandResponse;

  @route("/activate-org-principal")
  @post
  activateOrgPrincipal(
    @body request: ActivateOrgPrincipalRequest,
  ): OrgCommandResponse;

  @route("/release-org-domain")
  @post
  releaseOrgDomain(@body request: ReleaseOrgDomainRequest): OrgCommandResponse;

  @route("/claim-org-domain")
  @post
  claimOrgDomain(@body request: ClaimOrgDomainRequest): OrgClaimCommandResponse;
}

@route("/mesh/directory")
@tag("Mesh global-directory relay")
@useAuth(BearerAuth)
interface MeshOperations {
  @route("/resolve-profile-slug")
  @post
  resolveProfileSlug(
    @body request: ResolveProfileSlugRequest,
  ): MeshReadResponse;

  @route("/reserve-hub-principal")
  @post
  reserveHubPrincipal(
    @body request: ReserveHubPrincipalRequest,
  ): MeshReserveHubPrincipalResponse;

  @route("/activate-hub-principal")
  @post
  activateHubPrincipal(
    @body request: ActivateHubPrincipalRequest,
  ): MeshCommandResponse;

  @route("/set-hub-alias")
  @post
  setHubAlias(@body request: SetHubAliasRequest): MeshClaimCommandResponse;

  @route("/resolve-hub-account-email")
  @post
  resolveHubAccountEmail(
    @body request: ResolveHubAccountEmailRequest,
  ): MeshResolveHubAccountEmailResult;

  @route("/reserve-hub-account-email-change")
  @post
  reserveHubAccountEmailChange(
    @body request: ReserveHubAccountEmailChangeRequest,
  ): MeshReserveHubAccountEmailChangeResult;

  @route("/finalize-hub-account-email-change")
  @post
  finalizeHubAccountEmailChange(
    @body request: FinalizeHubAccountEmailChangeRequest,
  ): MeshEmailChangeCommandResult;

  @route("/abandon-hub-account-email-change")
  @post
  abandonHubAccountEmailChange(
    @body request: AbandonHubAccountEmailChangeRequest,
  ): MeshEmailChangeCommandResult;

  @route("/claim-hub-professional-email")
  @post
  claimHubProfessionalEmail(
    @body request: ClaimHubProfessionalEmailRequest,
  ): MeshClaimHubProfessionalEmailResult;

  @route("/release-hub-professional-email")
  @post
  releaseHubProfessionalEmail(
    @body request: ReleaseHubProfessionalEmailRequest,
  ): MeshReleaseHubProfessionalEmailResult;

  @route("/pull-hub-professional-email-supersessions")
  @post
  pullHubProfessionalEmailSupersessions(
    @body request: PullHubProfessionalEmailSupersessionsRequest,
  ): MeshPullHubProfessionalEmailSupersessionsResult;

  @route("/check-hub-professional-email-holdings")
  @post
  checkHubProfessionalEmailHoldings(
    @body request: CheckHubProfessionalEmailHoldingsRequest,
  ): MeshCheckHubProfessionalEmailHoldingsResult;

  @route("/resolve-org-domain")
  @post
  resolveOrgDomain(@body request: ResolveOrgDomainRequest): MeshOrgReadResponse;

  @route("/reserve-org-principal")
  @post
  reserveOrgPrincipal(
    @body request: ReserveOrgPrincipalRequest,
  ): MeshOrgClaimCommandResponse;

  @route("/activate-org-principal")
  @post
  activateOrgPrincipal(
    @body request: ActivateOrgPrincipalRequest,
  ): MeshOrgCommandResponse;

  @route("/release-org-domain")
  @post
  releaseOrgDomain(
    @body request: ReleaseOrgDomainRequest,
  ): MeshOrgCommandResponse;

  @route("/claim-org-domain")
  @post
  claimOrgDomain(
    @body request: ClaimOrgDomainRequest,
  ): MeshOrgClaimCommandResponse;
}
