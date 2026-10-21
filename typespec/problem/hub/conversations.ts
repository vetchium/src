import type { Details } from "../details.ts";

export const HubConversationNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-conversation-not-found",
  title: "Hub conversation not found",
  status: 404,
  detail: "No conversation has that identifier",
};

export const HubAgencyMessagesOffError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-agency-messages-off",
  title: "Hub agency messages off",
  status: 403,
  detail: "Agency messages are turned off in your settings",
};

export const HubConversationPartyDeletedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-conversation-party-deleted",
  title: "Hub conversation party deleted",
  status: 409,
  detail: "The agency no longer exists on Vetchium",
};
