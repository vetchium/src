import type { Details } from "../details.ts";

export const EventConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/federation-event-conflict",
  title: "Federation event conflict",
  status: 409,
  detail: "The event id was already received for a different event",
};

export const DestinationMisdirectedError: Readonly<Details> = {
  type: "vetchium-problem-details/federation-destination-misdirected",
  title: "Federation destination misdirected",
  status: 421,
  detail: "The destination principal is not homed by this tenant",
};

export const DestinationNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/federation-destination-not-found",
  title: "Federation destination not found",
  status: 404,
  detail: "The destination principal is not an active principal",
};

export const EventUndeliveredError: Readonly<Details> = {
  type: "vetchium-problem-details/federation-event-undelivered",
  title: "Federation event undelivered",
  status: 503,
  detail: "The event could not be confirmed delivered",
};
