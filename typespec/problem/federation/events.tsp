import "../details.tsp";

namespace Vetchium.Problem;

/** The event id was already received with other content: a protocol error
 * that redelivery cannot fix. */
const FederationEventConflictError = #{
  type: "vetchium-problem-details/federation-event-conflict",
  title: "Federation event conflict",
  status: 409,
  detail: "The event id was already received for a different event",
};
alias FederationEventConflictErrorResponse = Response<
  409,
  typeof FederationEventConflictError
>;

/** The destination principal is not homed by the tenant that received the
 * event. Nothing was recorded; re-resolve the principal and deliver again. */
const FederationDestinationMisdirectedError = #{
  type: "vetchium-problem-details/federation-destination-misdirected",
  title: "Federation destination misdirected",
  status: 421,
  detail: "The destination principal is not homed by this tenant",
};
alias FederationDestinationMisdirectedErrorResponse = Response<
  421,
  typeof FederationDestinationMisdirectedError
>;

const FederationDestinationNotFoundError = #{
  type: "vetchium-problem-details/federation-destination-not-found",
  title: "Federation destination not found",
  status: 404,
  detail: "The destination principal is not an active principal",
};
alias FederationDestinationNotFoundErrorResponse = Response<
  404,
  typeof FederationDestinationNotFoundError
>;

/** Routing, the peer, or its answer failed, so delivery is unconfirmed; the
 * event may or may not have been received. Deliver it again. */
const FederationEventUndeliveredError = #{
  type: "vetchium-problem-details/federation-event-undelivered",
  title: "Federation event undelivered",
  status: 503,
  detail: "The event could not be confirmed delivered",
};
alias FederationEventUndeliveredErrorResponse = Response<
  503,
  typeof FederationEventUndeliveredError
>;
