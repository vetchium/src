import type { Details } from "../details.ts";

export const HubConversationNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-conversation-not-found",
  title: "Hub conversation not found",
  status: 404,
  detail: "You have no conversation with that agency",
};

export const HubConversationPartyDeletedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-conversation-party-deleted",
  title: "Hub conversation party deleted",
  status: 409,
  detail: "The agency no longer exists on Vetchium",
};

export const HubChatRequestLimitReachedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-chat-request-limit-reached",
  title: "Hub chat request limit reached",
  status: 429,
  detail: "You reached your limit of chat requests for today",
};

export const HubChatRequestExistsError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-chat-request-exists",
  title: "Hub chat request exists",
  status: 409,
  detail: "A chat request between you and this agency is pending",
};

export const HubChatRequestBlockedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-chat-request-blocked",
  title: "Hub chat request blocked",
  status: 403,
  detail:
    "The agency declined chat requests from you for this Opening or until a later date",
};

export const HubChatRequestNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-chat-request-not-found",
  title: "Hub chat request not found",
  status: 404,
  detail: "No pending chat request to you from that agency has that number",
};

export const HubConversationOpenError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-conversation-open",
  title: "Hub conversation open",
  status: 409,
  detail: "You may still write in the conversation",
};

export const HubConversationClosedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-conversation-closed",
  title: "Hub conversation closed",
  status: 409,
  detail:
    "The conversation is closed to you until the agency writes or accepts a new chat request",
};

export const HubAgencyNotAssignedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-agency-not-assigned",
  title: "Hub agency not assigned",
  status: 422,
  detail: "The Opening is not published or the agency does not work on it",
};

export const HubConversationMessageNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-conversation-message-not-found",
  title: "Hub conversation message not found",
  status: 404,
  detail: "No text message you sent and have not deleted has that number",
};
