import "@typespec/http";

import "../../common/authentication.tsp";
import "../../problem/details.tsp";
import "../../problem/orgs/authentication.tsp";
import "../../problem/orgs/operations.tsp";
import "../../problem/orgs/suspension.tsp";

using TypeSpec.Http;

namespace Vetchium.Orgs.Operations;

@format("uuid")
scalar OperationID extends string;

enum OperationState {
  Pending: "pending",
  Succeeded: "succeeded",
  Failed: "failed",
}

/** Returned when a durable cross-tenant command may have been transmitted. */
model PendingOperation {
  operation_id: OperationID;
}

model GetOperationRequest {
  operation_id: OperationID;
}

/** Replay the original request with its idempotency key for its typed result. */
model OperationStatus {
  operation_id: OperationID;
  state: OperationState;
}

@route("/api/orgs/operations")
@tag("Org operations")
interface Operations {
  /** Only the Org user who started the operation may read it. */
  @route("/status")
  @post
  @useAuth(BearerAuth)
  status(@body request: GetOperationRequest):
    | {
        @statusCode status_code: 200;
        @header("Cache-Control") cache_control: "no-store";
        @body body: OperationStatus;
      }
    | Vetchium.Problem.InvalidJSONErrorResponse
    | Vetchium.Problem.ValidationFailedErrorResponse
    | Vetchium.Problem.OrgAuthenticationRequiredErrorResponse
    | Vetchium.Problem.OrgSuspendedErrorResponse
    | Vetchium.Problem.OrgOperationNotFoundErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
