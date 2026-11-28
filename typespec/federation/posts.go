package federation

import (
	"strings"
	"time"

	"github.com/vetchium/src/typespec/hub"
	hubposts "github.com/vetchium/src/typespec/hub/posts"
)

// HubPostReplyRegisterKind is the command the replier's home tenant sends to
// the post owner's tenant to register a reply (PST-RPL-005). Its authority
// principal is the post owner and its aggregate id is the post ID.
const HubPostReplyRegisterKind CommandKind = "hub-post-reply-register"

// AggregateHubReply versions hub-reply-edited and hub-reply-removed events by
// the reply's version. Its aggregate id is the reply ID.
const AggregateHubReply AggregateType = "hub_reply"

// AggregateHubPost versions hub-post-removed events by the post's version and
// hub-post-quoted events by the quote post's version. Its aggregate id is the
// post ID.
const AggregateHubPost AggregateType = "hub_post"

type HubPostReplyRegisterPayload struct {
	PostID            hubposts.PostID  `json:"post_id"`
	ReplyID           hubposts.PostID  `json:"reply_id"`
	ParentReplyID     *hubposts.PostID `json:"parent_reply_id,omitempty"`
	ReplierHubUserDID hub.HubUserDID   `json:"replier_hub_user_did"`
	ReplierHandle     hub.HubHandle    `json:"replier_handle"`
	Body              string           `json:"body"`
	CreatedAt         time.Time        `json:"created_at"`
}

// Normalize trims the body without touching storage the caller shares.
func (p *HubPostReplyRegisterPayload) Normalize() {
	p.Body = strings.TrimSpace(p.Body)
}

func (p HubPostReplyRegisterPayload) Validate() []string {
	fields := []string{}
	if !hubposts.IsPostID(p.PostID) {
		fields = append(fields, "post_id")
	}
	if !hubposts.IsPostID(p.ReplyID) {
		fields = append(fields, "reply_id")
	}
	if p.ParentReplyID != nil && !hubposts.IsPostID(*p.ParentReplyID) {
		fields = append(fields, "parent_reply_id")
	}
	if !hub.IsHubUserDID(p.ReplierHubUserDID) {
		fields = append(fields, "replier_hub_user_did")
	}
	if !hub.IsHubHandle(p.ReplierHandle) {
		fields = append(fields, "replier_handle")
	}
	if !hubposts.IsBody(p.Body) {
		fields = append(fields, "body")
	}
	if p.CreatedAt.IsZero() {
		fields = append(fields, "created_at")
	}
	return fields
}

// HubPostReplyRegisterResult is the stored `200` body of a successful
// hub-post-reply-register.
type HubPostReplyRegisterResult struct {
	ReplyID   hubposts.PostID `json:"reply_id"`
	CreatedAt time.Time       `json:"created_at"`
}

// HubReplyEditedKind is the event the reply author's tenant enqueues for the
// post owner's tenant, which updates the reply copy (PST-RPL-010). Aggregate
// type AggregateHubReply, aggregate id the reply ID, version the reply's
// version. It shares a watermark with HubReplyRemovedKind.
const HubReplyEditedKind EventKind = "hub-reply-edited"

type HubReplyEditedPayload struct {
	PostID   hubposts.PostID `json:"post_id"`
	ReplyID  hubposts.PostID `json:"reply_id"`
	Body     string          `json:"body"`
	Revision int32           `json:"revision"`
}

func (p HubReplyEditedPayload) Validate() []string {
	fields := []string{}
	if !hubposts.IsPostID(p.PostID) {
		fields = append(fields, "post_id")
	}
	if !hubposts.IsPostID(p.ReplyID) {
		fields = append(fields, "reply_id")
	}
	if !hubposts.IsBody(p.Body) {
		fields = append(fields, "body")
	}
	if p.Revision < 1 {
		fields = append(fields, "revision")
	}
	return fields
}

// HubReplyRemovedKind is the event the reply author's tenant enqueues for the
// post owner's tenant, which clears the reply copy (PST-RPL-011). Aggregate
// as for HubReplyEditedKind.
const HubReplyRemovedKind EventKind = "hub-reply-removed"

type HubReplyRemovedPayload struct {
	PostID  hubposts.PostID `json:"post_id"`
	ReplyID hubposts.PostID `json:"reply_id"`
}

func (p HubReplyRemovedPayload) Validate() []string {
	fields := []string{}
	if !hubposts.IsPostID(p.PostID) {
		fields = append(fields, "post_id")
	}
	if !hubposts.IsPostID(p.ReplyID) {
		fields = append(fields, "reply_id")
	}
	return fields
}

// HubPostRemovedKind is the event the post owner's tenant enqueues for each
// reply author after a post is removed (PST-RPL-013). Aggregate type
// AggregateHubPost, aggregate id the post ID, version the post's version.
const HubPostRemovedKind EventKind = "hub-post-removed"

type HubPostRemovedPayload struct {
	PostID hubposts.PostID `json:"post_id"`
}

func (p HubPostRemovedPayload) Validate() []string {
	if !hubposts.IsPostID(p.PostID) {
		return []string{"post_id"}
	}
	return []string{}
}
