import "@typespec/http";
import "../common/idempotency.tsp";
import "../hub/types.tsp";
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

model ReserveHubPrincipalRequest {
  command_id: CommandID;
  hub_user_did: Vetchium.Hub.HubUserDID;
  handle: Vetchium.Hub.HubHandle;
  home_tenant_id: TenantID;
  provisioning_expires_at: utcDateTime;
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

alias ReadResponse =
  | ReadResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;

alias CommandResponse =
  | CommandResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;

alias ClaimCommandResponse =
  | ClaimCommandResponseBase
  | Vetchium.Problem.DirectoryAuthenticationRequiredErrorResponse;

alias MeshReadResponse =
  | ReadResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias MeshCommandResponse =
  | CommandResponseBase
  | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse;

alias MeshClaimCommandResponse =
  | ClaimCommandResponseBase
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
  ): ClaimCommandResponse;

  @route("/activate-hub-principal")
  @post
  activateHubPrincipal(
    @body request: ActivateHubPrincipalRequest,
  ): CommandResponse;

  @route("/set-hub-alias")
  @post
  setHubAlias(@body request: SetHubAliasRequest): ClaimCommandResponse;
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
  ): MeshClaimCommandResponse;

  @route("/activate-hub-principal")
  @post
  activateHubPrincipal(
    @body request: ActivateHubPrincipalRequest,
  ): MeshCommandResponse;

  @route("/set-hub-alias")
  @post
  setHubAlias(@body request: SetHubAliasRequest): MeshClaimCommandResponse;
}
