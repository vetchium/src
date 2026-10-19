import "@typespec/http";

import "../common/authentication.tsp";
import "../directory/directory.tsp";
import "../problem/common.tsp";
import "../problem/details.tsp";
import "../problem/federation/events.tsp";
import "../problem/global-coordinator/authentication.tsp";

using TypeSpec.Http;

namespace Vetchium.Federation;

/** A kind the owning feature registers at every tenant; the receiver looks
 * up its handler by this name. */
@pattern("^[a-z][a-z0-9]*(-[a-z0-9]+)*$")
@maxLength(100)
scalar EventKind extends string;

@format("uuid")
scalar EventID extends string;

@pattern("^[a-z][a-z0-9]*(_[a-z0-9]+)*$")
@maxLength(100)
scalar AggregateType extends string;

/** An effect of a committed change at the source tenant, for the home tenant
 * of its destination principal. Every delivery of one event carries
 * identical values. */
model DeliverEventRequest {
  event_id: EventID;
  kind: EventKind;
  destination_principal_type: Vetchium.Directory.PrincipalType;
  destination_principal_did: Vetchium.Directory.PrincipalDID;
  aggregate_type: AggregateType;

  @minLength(1)
  @maxLength(200)
  aggregate_id: string;

  /** Increases with every change of the aggregate; an event older than one
   * already applied is recorded but not applied. */
  @minValue(1)
  aggregate_version: int64;

  /** The payload the kind defines. */
  payload: Record<unknown>;
}

enum EventDeliveryOutcome {
  /** The receiver applied the event. */
  Applied: "applied",

  /** A newer version of the aggregate was already applied. */
  Superseded: "superseded",

  /** The event was received before; nothing changed. */
  Duplicate: "duplicate",
}

model EventReceipt {
  outcome: EventDeliveryOutcome;
}

alias DeliveredResponse = {
  @statusCode status_code: 200;
  @header("Cache-Control") cache_control: "no-store";
  @body body: EventReceipt;
};

/** None of these recorded or applied the event. */
alias DeliveryErrors =
  | Vetchium.Problem.InvalidJSONErrorResponse
  | Vetchium.Problem.ValidationFailedErrorResponse
  | Vetchium.Problem.FederationEventConflictErrorResponse
  | Vetchium.Problem.FederationDestinationMisdirectedErrorResponse
  | Vetchium.Problem.FederationEventOriginMismatchErrorResponse
  | Vetchium.Problem.InternalServerErrorResponse;

/** Resolves the destination principal's home tenant, then delivers the event
 * there: in mesh-api for this tenant, otherwise at that tenant's peer. */
@route("/mesh/events")
@tag("Tenant-local outbox event relay")
@useAuth(BearerAuth)
interface EventRelayOperations {
  @route("/deliver")
  @post
  deliver(@body request: DeliverEventRequest):
    | DeliveredResponse
    | DeliveryErrors
    | Vetchium.Problem.MeshRelayAuthenticationRequiredErrorResponse
    | Vetchium.Problem.FederationDestinationNotFoundErrorResponse
    | Vetchium.Problem.FederationEventUndeliveredErrorResponse;
}

@route("/api/mesh/events")
@tag("Authenticated peer outbox event delivery")
@useAuth(Vetchium.Authentication.MutualTLSAuth)
interface EventPeerOperations {
  @route("/deliver")
  @post
  deliver(@body request: DeliverEventRequest):
    | DeliveredResponse
    | DeliveryErrors
    | Vetchium.Problem.MeshPeerAuthenticationRequiredErrorResponse;
}
