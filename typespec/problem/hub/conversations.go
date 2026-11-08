package hub

import "github.com/vetchium/src/typespec/problem"

var HubConversationNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/hub-conversation-not-found",
	Title:  "Hub conversation not found",
	Status: 404,
	Detail: "You have no conversation with that agency",
}

var HubConversationPartyDeletedError = problem.Details{
	Type:   "vetchium-problem-details/hub-conversation-party-deleted",
	Title:  "Hub conversation party deleted",
	Status: 409,
	Detail: "The agency no longer exists on Vetchium",
}

var HubChatRequestLimitReachedError = problem.Details{
	Type:   "vetchium-problem-details/hub-chat-request-limit-reached",
	Title:  "Hub chat request limit reached",
	Status: 429,
	Detail: "You reached your limit of chat requests for today",
}

var HubChatRequestExistsError = problem.Details{
	Type:   "vetchium-problem-details/hub-chat-request-exists",
	Title:  "Hub chat request exists",
	Status: 409,
	Detail: "A chat request between you and this agency is pending",
}

var HubChatRequestBlockedError = problem.Details{
	Type:   "vetchium-problem-details/hub-chat-request-blocked",
	Title:  "Hub chat request blocked",
	Status: 403,
	Detail: "The agency declined chat requests from you for this Opening or until a later date",
}

var HubChatRequestNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/hub-chat-request-not-found",
	Title:  "Hub chat request not found",
	Status: 404,
	Detail: "No pending chat request to you from that agency has that number",
}

var HubConversationOpenError = problem.Details{
	Type:   "vetchium-problem-details/hub-conversation-open",
	Title:  "Hub conversation open",
	Status: 409,
	Detail: "You may still write in the conversation",
}

var HubConversationClosedError = problem.Details{
	Type:   "vetchium-problem-details/hub-conversation-closed",
	Title:  "Hub conversation closed",
	Status: 409,
	Detail: "The conversation is closed to you until the agency writes or accepts a new chat request",
}

var HubAgencyNotAssignedError = problem.Details{
	Type:   "vetchium-problem-details/hub-agency-not-assigned",
	Title:  "Hub agency not assigned",
	Status: 422,
	Detail: "The Opening is not published or the agency does not work on it",
}

var HubConversationMessageNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/hub-conversation-message-not-found",
	Title:  "Hub conversation message not found",
	Status: 404,
	Detail: "No text message you sent and have not deleted has that number",
}
