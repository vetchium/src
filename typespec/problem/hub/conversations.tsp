import "../details.tsp";

namespace Vetchium.Problem;

const HubConversationNotFoundError = #{
  type: "vetchium-problem-details/hub-conversation-not-found",
  title: "Hub conversation not found",
  status: 404,
  detail: "No conversation has that identifier",
};
alias HubConversationNotFoundErrorResponse = Response<
  404,
  typeof HubConversationNotFoundError
>;

const HubConversationPartyDeletedError = #{
  type: "vetchium-problem-details/hub-conversation-party-deleted",
  title: "Hub conversation party deleted",
  status: 409,
  detail: "The agency no longer exists on Vetchium",
};
alias HubConversationPartyDeletedErrorResponse = Response<
  409,
  typeof HubConversationPartyDeletedError
>;

const HubChatRequestLimitReachedError = #{
  type: "vetchium-problem-details/hub-chat-request-limit-reached",
  title: "Hub chat request limit reached",
  status: 429,
  detail: "You reached your limit of chat requests for today",
};
alias HubChatRequestLimitReachedErrorResponse = Response<
  429,
  typeof HubChatRequestLimitReachedError
>;

const HubChatRequestExistsError = #{
  type: "vetchium-problem-details/hub-chat-request-exists",
  title: "Hub chat request exists",
  status: 409,
  detail: "A chat request between you and this agency is pending",
};
alias HubChatRequestExistsErrorResponse = Response<
  409,
  typeof HubChatRequestExistsError
>;

const HubChatRequestBlockedError = #{
  type: "vetchium-problem-details/hub-chat-request-blocked",
  title: "Hub chat request blocked",
  status: 403,
  detail: "The agency declined chat requests from you for this Opening or until a later date",
};
alias HubChatRequestBlockedErrorResponse = Response<
  403,
  typeof HubChatRequestBlockedError
>;

const HubChatRequestNotFoundError = #{
  type: "vetchium-problem-details/hub-chat-request-not-found",
  title: "Hub chat request not found",
  status: 404,
  detail: "No pending chat request to you has that identifier",
};
alias HubChatRequestNotFoundErrorResponse = Response<
  404,
  typeof HubChatRequestNotFoundError
>;

const HubConversationOpenError = #{
  type: "vetchium-problem-details/hub-conversation-open",
  title: "Hub conversation open",
  status: 409,
  detail: "You may still write in the conversation",
};
alias HubConversationOpenErrorResponse = Response<
  409,
  typeof HubConversationOpenError
>;

const HubConversationClosedError = #{
  type: "vetchium-problem-details/hub-conversation-closed",
  title: "Hub conversation closed",
  status: 409,
  detail: "The conversation is closed to you until the agency writes or accepts a new chat request",
};
alias HubConversationClosedErrorResponse = Response<
  409,
  typeof HubConversationClosedError
>;

const HubAgencyNotAssignedError = #{
  type: "vetchium-problem-details/hub-agency-not-assigned",
  title: "Hub agency not assigned",
  status: 422,
  detail: "The Opening is not published or the agency does not work on it",
};
alias HubAgencyNotAssignedErrorResponse = Response<
  422,
  typeof HubAgencyNotAssignedError
>;
