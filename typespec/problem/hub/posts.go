package hub

import "github.com/vetchium/src/typespec/problem"

var HubPostNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/hub-post-not-found",
	Title:  "Hub post not found",
	Status: 404,
	Detail: "No live post has that ID",
}

var HubPostUnavailableError = problem.Details{
	Type:   "vetchium-problem-details/hub-post-unavailable",
	Title:  "Hub post unavailable",
	Status: 503,
	Detail: "The region that holds the post did not answer. Try again later",
}

var HubPostLimitReachedError = problem.Details{
	Type:   "vetchium-problem-details/hub-post-limit-reached",
	Title:  "Hub post limit reached",
	Status: 429,
	Detail: "You reached your limit of posts or replies for today",
}

var HubPostEditClosedError = problem.Details{
	Type:   "vetchium-problem-details/hub-post-edit-closed",
	Title:  "Hub post edit closed",
	Status: 409,
	Detail: "The time to edit has ended",
}

var HubPostConflictError = problem.Details{
	Type:   "vetchium-problem-details/hub-post-conflict",
	Title:  "Hub post conflict",
	Status: 409,
	Detail: "The text changed since you opened it",
}

var HubPostRepliesClosedError = problem.Details{
	Type:   "vetchium-problem-details/hub-post-replies-closed",
	Title:  "Hub post replies closed",
	Status: 409,
	Detail: "The author closed replies to this post",
}

var HubPostReplyRefusedError = problem.Details{
	Type:   "vetchium-problem-details/hub-post-reply-refused",
	Title:  "Hub post reply refused",
	Status: 403,
	Detail: "You cannot reply here",
}

var HubPostQuoteRefusedError = problem.Details{
	Type:   "vetchium-problem-details/hub-post-quote-refused",
	Title:  "Hub post quote refused",
	Status: 403,
	Detail: "You cannot quote this post",
}

var HubReplyNotFoundError = problem.Details{
	Type:   "vetchium-problem-details/hub-reply-not-found",
	Title:  "Hub reply not found",
	Status: 404,
	Detail: "No live reply has that ID",
}
