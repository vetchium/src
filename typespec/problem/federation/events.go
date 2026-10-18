package federation

import "github.com/vetchium/src/typespec/problem"

var EventConflictError = problem.Details{
	Type:   "vetchium-problem-details/federation-event-conflict",
	Title:  "Federation event conflict",
	Status: 409,
	Detail: "The event id was already received for a different event",
}

var DestinationMisdirectedError = problem.Details{
	Type:   "vetchium-problem-details/federation-destination-misdirected",
	Title:  "Federation destination misdirected",
	Status: 421,
	Detail: "The destination principal is not homed by this tenant",
}

var DestinationNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/federation-destination-not-found",
	Title:  "Federation destination not found",
	Status: 404,
	Detail: "The destination principal is not an active principal",
}

var EventUndeliveredError = problem.Details{
	Type:   "vetchium-problem-details/federation-event-undelivered",
	Title:  "Federation event undelivered",
	Status: 503,
	Detail: "The event could not be confirmed delivered",
}
