import "@typespec/http";

import "../../common/authentication.tsp";
import "../../problem/details.tsp";
import "../../problem/hub/authentication.tsp";
import "../../problem/hub/operations.tsp";

using TypeSpec.Http;

namespace Vetchium.Hub.Operations;

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

@route("/api/hub/operations")
@tag("Hub operations")
interface Operations {
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
    | Vetchium.Problem.HubAuthenticationRequiredErrorResponse
    | Vetchium.Problem.HubOperationNotFoundErrorResponse
    | Vetchium.Problem.InternalServerErrorResponse;
}
