import "../hub/posts/posts.tsp";
import "../hub/types.tsp";
import "../problem/federation/commands.tsp";
import "../problem/hub/posts.tsp";

namespace Vetchium.Federation.Posts;

/**
 * The payload of the `hub-post-reply-register` command. Its initiator is the
 * replier's home tenant and its authority principal is the post owner. Its
 * aggregate id is the post ID (PST-RPL-005).
 */
model HubPostReplyRegisterPayload {
  post_id: Vetchium.Hub.Posts.PostID;
  reply_id: Vetchium.Hub.Posts.PostID;

  /** Set on a sub-reply. */
  parent_reply_id?: Vetchium.Hub.Posts.PostID;

  replier_hub_user_did: Vetchium.Hub.HubUserDID;
  replier_handle: Vetchium.Hub.HubHandle;
  body: Vetchium.Hub.Posts.PostBody;
  created_at: utcDateTime;
}

/** The stored `200` result of `hub-post-reply-register`. */
model HubPostReplyRegisterResult {
  reply_id: Vetchium.Hub.Posts.PostID;
  created_at: utcDateTime;
}

/**
 * The deterministic rejections of `hub-post-reply-register`: a post that is
 * not live, a locked post or a `nobody` reply policy, a replier the post
 * owner blocked, a parent reply that is not in the post or not live, and a
 * replier the sending tenant does not home.
 */
alias HubPostReplyRegisterRejections =
  | Vetchium.Problem.HubPostNotFoundErrorResponse
  | Vetchium.Problem.HubPostRepliesClosedErrorResponse
  | Vetchium.Problem.HubPostReplyRefusedErrorResponse
  | Vetchium.Problem.HubReplyNotFoundErrorResponse
  | Vetchium.Problem.FederationInitiatorMismatchErrorResponse;

/**
 * The payload of the `hub-reply-edited` event. Its origin is the reply
 * author's tenant; the destination is the post owner. Aggregate type
 * `hub_reply`, aggregate id the reply ID, version the reply's `version`
 * (PST-RPL-015). It shares a watermark with `hub-reply-removed`.
 */
model HubReplyEditedPayload {
  post_id: Vetchium.Hub.Posts.PostID;
  reply_id: Vetchium.Hub.Posts.PostID;
  body: Vetchium.Hub.Posts.PostBody;
  revision: int32;
}

/** The payload of the `hub-reply-removed` event; aggregate as for an edit. */
model HubReplyRemovedPayload {
  post_id: Vetchium.Hub.Posts.PostID;
  reply_id: Vetchium.Hub.Posts.PostID;
}

/**
 * The payload of the `hub-post-removed` event. Its origin is the post
 * owner's tenant; the destination is each reply author. Aggregate type
 * `hub_post`, aggregate id the post ID, version the post's `version`.
 */
model HubPostRemovedPayload {
  post_id: Vetchium.Hub.Posts.PostID;
}
