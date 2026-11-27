import type { Details } from "../details.ts";

export const HubPostNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-post-not-found",
  title: "Hub post not found",
  status: 404,
  detail: "No live post has that ID",
};

export const HubPostUnavailableError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-post-unavailable",
  title: "Hub post unavailable",
  status: 503,
  detail: "The region that holds the post did not answer. Try again later",
};

export const HubPostLimitReachedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-post-limit-reached",
  title: "Hub post limit reached",
  status: 429,
  detail: "You reached your limit of posts or replies for today",
};

export const HubPostEditClosedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-post-edit-closed",
  title: "Hub post edit closed",
  status: 409,
  detail: "The time to edit has ended",
};

export const HubPostConflictError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-post-conflict",
  title: "Hub post conflict",
  status: 409,
  detail: "The text changed since you opened it",
};

export const HubPostRepliesClosedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-post-replies-closed",
  title: "Hub post replies closed",
  status: 409,
  detail: "The author closed replies to this post",
};

export const HubPostReplyRefusedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-post-reply-refused",
  title: "Hub post reply refused",
  status: 403,
  detail: "You cannot reply here",
};

export const HubPostQuoteRefusedError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-post-quote-refused",
  title: "Hub post quote refused",
  status: 403,
  detail: "You cannot quote this post",
};

export const HubReplyNotFoundError: Readonly<Details> = {
  type: "vetchium-problem-details/hub-reply-not-found",
  title: "Hub reply not found",
  status: 404,
  detail: "No live reply has that ID",
};
