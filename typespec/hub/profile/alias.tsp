import "@typespec/http";
import "@typespec/openapi";

import "../../common/authentication.tsp";
import "../../common/idempotency.tsp";
import "../../directory/directory.tsp";
import "../../problem/common.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/profile.tsp";
import "../../problem/hub/subscriptions.tsp";
import "../operations/operations.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Profile;

model AliasState {
  profile_alias: Vetchium.Directory.HubAlias | null;

  /** Absent if no rolling seven-day change cooldown applies. */
  next_change_at?: utcDateTime;
}

model SetAliasRequest {
  /** Null releases the current alias. A paid plan is required to claim one. */
  profile_alias: Vetchium.Directory.HubAlias | null;
}

@route("/api/hub/profile/alias")
@tag("Hub profile alias")
interface AliasOperations {
  @route("/state")
  @get
  @useAuth(BearerAuth)
  state():
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: AliasState;
      }
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;

  @route("/set")
  @post
  @TypeSpec.OpenAPI.extension("x-vetchium-idempotency-replay-seconds", 604800)
  @useAuth(BearerAuth)
  set(
    @header("Idempotency-Key") idempotency_key: Vetchium.IdempotencyKey,
    @body request: SetAliasRequest,
  ):
    | {
        @statusCode status_code: 202;
        @header("Cache-Control") cache_control: "no-store";
        @body body: Vetchium.Hub.Operations.PendingOperation;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.HubPlanRequiredErrorResponse
    | Vetchium.Problem.HubProfileConflictErrorResponse
    | Vetchium.Problem.IdempotencyKeyConflictErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
