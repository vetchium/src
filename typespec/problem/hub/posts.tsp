import "../details.tsp";

namespace Vetchium.Problem;

const HubPostNotFoundError = #{
  type: "vetchium-problem-details/hub-post-not-found",
  title: "Hub post not found",
  status: 404,
  detail: "No live post has that ID",
};
alias HubPostNotFoundErrorResponse = Response<404, typeof HubPostNotFoundError>;

const HubPostUnavailableError = #{
  type: "vetchium-problem-details/hub-post-unavailable",
  title: "Hub post unavailable",
  status: 503,
  detail: "The region that holds the post did not answer. Try again later",
};
alias HubPostUnavailableErrorResponse = Response<
  503,
  typeof HubPostUnavailableError
>;

const HubPostLimitReachedError = #{
  type: "vetchium-problem-details/hub-post-limit-reached",
  title: "Hub post limit reached",
  status: 429,
  detail: "You reached your limit of posts or replies for today",
};
alias HubPostLimitReachedErrorResponse = Response<
  429,
  typeof HubPostLimitReachedError
>;

const HubPostEditClosedError = #{
  type: "vetchium-problem-details/hub-post-edit-closed",
  title: "Hub post edit closed",
  status: 409,
  detail: "The time to edit has ended",
};
alias HubPostEditClosedErrorResponse = Response<
  409,
  typeof HubPostEditClosedError
>;

const HubPostConflictError = #{
  type: "vetchium-problem-details/hub-post-conflict",
  title: "Hub post conflict",
  status: 409,
  detail: "The text changed since you opened it",
};
alias HubPostConflictErrorResponse = Response<409, typeof HubPostConflictError>;

const HubPostRepliesClosedError = #{
  type: "vetchium-problem-details/hub-post-replies-closed",
  title: "Hub post replies closed",
  status: 409,
  detail: "The author closed replies to this post",
};
alias HubPostRepliesClosedErrorResponse = Response<
  409,
  typeof HubPostRepliesClosedError
>;

const HubPostReplyRefusedError = #{
  type: "vetchium-problem-details/hub-post-reply-refused",
  title: "Hub post reply refused",
  status: 403,
  detail: "You cannot reply here",
};
alias HubPostReplyRefusedErrorResponse = Response<
  403,
  typeof HubPostReplyRefusedError
>;

const HubPostQuoteRefusedError = #{
  type: "vetchium-problem-details/hub-post-quote-refused",
  title: "Hub post quote refused",
  status: 403,
  detail: "You cannot quote this post",
};
alias HubPostQuoteRefusedErrorResponse = Response<
  403,
  typeof HubPostQuoteRefusedError
>;

const HubReplyNotFoundError = #{
  type: "vetchium-problem-details/hub-reply-not-found",
  title: "Hub reply not found",
  status: 404,
  detail: "No live reply has that ID",
};
alias HubReplyNotFoundErrorResponse = Response<
  404,
  typeof HubReplyNotFoundError
>;
