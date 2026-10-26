package federation

import "github.com/vetchium/src/typespec/problem"

var CommandConflictError = problem.Details{
	Type:   "vetchium-problem-details/federation-command-conflict",
	Title:  "Federation command conflict",
	Status: 409,
	Detail: "The command id was already used for a different command",
}

var AuthorityMisdirectedError = problem.Details{
	Type:   "vetchium-problem-details/federation-authority-misdirected",
	Title:  "Federation authority misdirected",
	Status: 421,
	Detail: "The authority principal is not homed by this tenant",
}

var AuthorityNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/federation-authority-not-found",
	Title:  "Federation authority not found",
	Status: 404,
	Detail: "The authority principal is not an active principal",
}

var AuthorityUnavailableError = problem.Details{
	Type:   "vetchium-problem-details/federation-authority-unavailable",
	Title:  "Federation authority unavailable",
	Status: 503,
	Detail: "The authority tenant could not be reached; the command was not sent",
}

var CommandOutcomeUnknownError = problem.Details{
	Type:   "vetchium-problem-details/federation-command-outcome-unknown",
	Title:  "Federation command outcome unknown",
	Status: 504,
	Detail: "The command was sent but its outcome is unknown",
}

var InitiatorMismatchError = problem.Details{
	Type:   "vetchium-problem-details/federation-initiator-mismatch",
	Title:  "Federation initiator mismatch",
	Status: 403,
	Detail: "The initiating principal is not homed at the sending tenant",
}
