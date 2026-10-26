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

const HubAgencyMessagesOffError = #{
  type: "vetchium-problem-details/hub-agency-messages-off",
  title: "Hub agency messages off",
  status: 403,
  detail: "Agency messages are turned off in your settings",
};
alias HubAgencyMessagesOffErrorResponse = Response<
  403,
  typeof HubAgencyMessagesOffError
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
