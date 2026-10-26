import "@typespec/http";

import "../common/authentication.tsp";
import "../directory/directory.tsp";
import "../problem/common.tsp";
import "../problem/details.tsp";
import "../problem/federation/commands.tsp";
import "../problem/global-coordinator/authentication.tsp";

using TypeSpec.Http;

namespace Vetchium.Federation;

/** A kind the owning feature registers at every tenant; the authority looks
 * up its handler by this name. */
@pattern("^[a-z][a-z0-9]*(-[a-z0-9]+)*$")
@maxLength(100)
scalar CommandKind extends string;

/** A durable command to the home tenant of its authority principal. Every
 * attempt carries the same command id, correlation id, and payload. */
model ExecuteCommandRequest {
  command_id: Vetchium.Directory.CommandID;

  /** The initiating tenant's operation id. */
  correlation_id: Vetchium.Directory.CommandID;

  kind: CommandKind;
  authority_principal_type: Vetchium.Directory.PrincipalType;
  authority_principal_did: Vetchium.Directory.PrincipalDID;

  @minLength(1)
  @maxLength(200)
  aggregate_id: string;

  /** The replayable logical payload the kind defines. */
  payload: Record<unknown>;
}

/** The stored outcome of a command: its kind's typed result for a 2xx status,
 * or an RFC 9457 problem for a deterministic 4xx rejection. A replay of the
 * same command returns the same outcome. */
model CommandResult {
  @minValue(200)
  @maxValue(499)
  status: int32;

  body: unknown;
}

alias ExecutedResponse = {
  @statusCode status_code: 200;
  @header("Cache-Control") cache_control: "no-store";
  @body body: CommandResult;
};

/** Neither a conflict nor a misdirected command ran. */
alias ExecutionErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.FederationCommandConflictErrorResponse
  | Vetchium.Problem.FederationAuthorityMisdirectedErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

/** Resolves the authority principal's home tenant, then executes the command
 * there: in mesh-api for this tenant, otherwise at that tenant's peer. */
@route("/mesh/commands")
@tag("Tenant-local durable command relay")
@useAuth(BearerAuth)
interface CommandRelayOperations {
  @route("/execute")
  @post
  execute(@body request: ExecuteCommandRequest):
    | ExecutedResponse
    | ExecutionErrors
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse
    | Vetchium.Problem.FederationAuthorityNotFoundErrorResponse
    | Vetchium.Problem.FederationAuthorityUnavailableErrorResponse
    | Vetchium.Problem.FederationCommandOutcomeUnknownErrorResponse;
}

@route("/api/mesh/commands")
@tag("Authenticated peer durable command execution")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface CommandPeerOperations {
  @route("/execute")
  @post
  execute(@body request: ExecuteCommandRequest):
    | ExecutedResponse
    | ExecutionErrors
    | Vetchium.Problem.MeshPeerAuthenticationRequiredErrorResponse;
}
