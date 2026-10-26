package hub

import "github.com/vetchium/src/typespec/problem"

var HubConversationNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/hub-conversation-not-found",
	Title:  "Hub conversation not found",
	Status: 404,
	Detail: "No conversation has that identifier",
}

var HubAgencyMessagesOffError = problem.Details{
	Type:   "vetchium-problem-details/hub-agency-messages-off",
	Title:  "Hub agency messages off",
	Status: 403,
	Detail: "Agency messages are turned off in your settings",
}

var HubConversationPartyDeletedError = problem.Details{
	Type:   "vetchium-problem-details/hub-conversation-party-deleted",
	Title:  "Hub conversation party deleted",
	Status: 409,
	Detail: "The agency no longer exists on Vetchium",
}
