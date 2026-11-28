package posts

import (
	"strings"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/hub/profile"
)

// ThreadReplyState is how a reply shows in a thread for one viewer.
type ThreadReplyState string

const (
	ThreadReplyLive   ThreadReplyState = "live"
	ThreadReplyHidden ThreadReplyState = "hidden"
	// ThreadReplyPlaceholder has no body and shows only when the reply has
	// sub-replies (PST-THR-004).
	ThreadReplyPlaceholder ThreadReplyState = "placeholder"
)

func IsThreadReplyState(value ThreadReplyState) bool {
	switch value {
	case ThreadReplyLive, ThreadReplyHidden, ThreadReplyPlaceholder:
		return true
	default:
		return false
	}
}

// Reply is one reply in a thread. Body is nil for a placeholder.
type Reply struct {
	ReplyID       PostID           `json:"reply_id"`
	PostID        PostID           `json:"post_id"`
	ParentReplyID *PostID          `json:"parent_reply_id,omitempty"`
	AuthorHandle  hub.HubHandle    `json:"author_handle"`
	Body          *string          `json:"body,omitempty"`
	State         ThreadReplyState `json:"state"`
	ChildCount    int32            `json:"child_count"`
	Revision      int32            `json:"revision"`
	Edited        bool             `json:"edited"`
	CreatedAt     time.Time        `json:"created_at"`
}

func normalizeAddress(owner profile.ProfileAddress) profile.ProfileAddress {
	return profile.ProfileAddress(strings.TrimSpace(string(owner)))
}

// ReplyRequest carries the `Idempotency-Key` header beside this body.
type ReplyRequest struct {
	Owner         profile.ProfileAddress `json:"owner"`
	PostID        PostID                 `json:"post_id"`
	ParentReplyID *PostID                `json:"parent_reply_id,omitempty"`
	Body          string                 `json:"body"`
}

func (r *ReplyRequest) Normalize() {
	r.Owner = normalizeAddress(r.Owner)
	r.Body = strings.TrimSpace(r.Body)
}

func (r ReplyRequest) Validate() []string {
	fields := []string{}
	if !profile.IsProfileAddress(r.Owner) {
		fields = append(fields, "owner")
	}
	if !IsPostID(r.PostID) {
		fields = append(fields, "post_id")
	}
	if r.ParentReplyID != nil && !IsPostID(*r.ParentReplyID) {
		fields = append(fields, "parent_reply_id")
	}
	if !IsBody(r.Body) {
		fields = append(fields, "body")
	}
	return fields
}

type EditReplyRequest struct {
	ReplyID  PostID `json:"reply_id"`
	Body     string `json:"body"`
	Revision int32  `json:"revision"`
}

func (r *EditReplyRequest) Normalize() {
	r.Body = strings.TrimSpace(r.Body)
}

func (r EditReplyRequest) Validate() []string {
	fields := []string{}
	if !IsPostID(r.ReplyID) {
		fields = append(fields, "reply_id")
	}
	if !IsBody(r.Body) {
		fields = append(fields, "body")
	}
	if r.Revision < 1 {
		fields = append(fields, "revision")
	}
	return fields
}

type RemoveReplyRequest struct {
	ReplyID PostID `json:"reply_id"`
}

func (r *RemoveReplyRequest) Normalize() {}

func (r RemoveReplyRequest) Validate() []string {
	if !IsPostID(r.ReplyID) {
		return []string{"reply_id"}
	}
	return []string{}
}

// HideReplyRequest is the body of `/hide-reply` and `/unhide-reply`.
type HideReplyRequest struct {
	PostID  PostID `json:"post_id"`
	ReplyID PostID `json:"reply_id"`
}

func (r *HideReplyRequest) Normalize() {}

func (r HideReplyRequest) Validate() []string {
	fields := []string{}
	if !IsPostID(r.PostID) {
		fields = append(fields, "post_id")
	}
	if !IsPostID(r.ReplyID) {
		fields = append(fields, "reply_id")
	}
	return fields
}

type ListRepliesRequest struct {
	Owner         profile.ProfileAddress `json:"owner"`
	PostID        PostID                 `json:"post_id"`
	ParentReplyID *PostID                `json:"parent_reply_id,omitempty"`
	// FromReplyID starts the page at this reply of the list (PST-THR-009).
	FromReplyID   *PostID               `json:"from_reply_id,omitempty"`
	PaginationKey *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit         *int32                `json:"limit,omitempty"`
}

func (r *ListRepliesRequest) Normalize() {
	r.Owner = normalizeAddress(r.Owner)
}

func (r ListRepliesRequest) EffectiveLimit() int32 {
	return effectiveLimit(r.Limit)
}

func (r ListRepliesRequest) Validate() []string {
	fields := []string{}
	if !profile.IsProfileAddress(r.Owner) {
		fields = append(fields, "owner")
	}
	if !IsPostID(r.PostID) {
		fields = append(fields, "post_id")
	}
	if r.ParentReplyID != nil && !IsPostID(*r.ParentReplyID) {
		fields = append(fields, "parent_reply_id")
	}
	fields = append(fields, validFrom(r.FromReplyID, r.PaginationKey)...)
	return append(fields, ValidPage(r.PaginationKey, r.Limit)...)
}

// validFrom checks a start reply. A page starts at it or after a key, never
// both.
func validFrom(from *PostID, key *common.PaginationKey) []string {
	if from != nil && (!IsPostID(*from) || key != nil) {
		return []string{"from_reply_id"}
	}
	return nil
}

type ListRepliesResponse struct {
	Replies           []Reply               `json:"replies"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type AuthorReplyState string

const (
	AuthorReplyLive        AuthorReplyState = "live"
	AuthorReplyPostRemoved AuthorReplyState = "post_removed"
)

func IsAuthorReplyState(value AuthorReplyState) bool {
	return value == AuthorReplyLive || value == AuthorReplyPostRemoved
}

// AuthorReply is a reply as the Replies tab shows it. It never holds post
// words (PST-TAB-003).
type AuthorReply struct {
	ReplyID         PostID        `json:"reply_id"`
	PostID          PostID        `json:"post_id"`
	PostOwnerHandle hub.HubHandle `json:"post_owner_handle"`
	// Body is nil when State is post_removed (PST-TAB-002).
	Body      *string          `json:"body,omitempty"`
	State     AuthorReplyState `json:"state"`
	Edited    bool             `json:"edited"`
	CreatedAt time.Time        `json:"created_at"`
}

// LocateReplyRequest names one reply of one post, for a reply link
// (PST-THR-009).
type LocateReplyRequest struct {
	Owner   profile.ProfileAddress `json:"owner"`
	PostID  PostID                 `json:"post_id"`
	ReplyID PostID                 `json:"reply_id"`
}

func (r *LocateReplyRequest) Normalize() {
	r.Owner = normalizeAddress(r.Owner)
}

func (r LocateReplyRequest) Validate() []string {
	fields := []string{}
	if !profile.IsProfileAddress(r.Owner) {
		fields = append(fields, "owner")
	}
	if !IsPostID(r.PostID) {
		fields = append(fields, "post_id")
	}
	if !IsPostID(r.ReplyID) {
		fields = append(fields, "reply_id")
	}
	return fields
}

type LocateReplyResponse struct {
	ReplyID       PostID  `json:"reply_id"`
	ParentReplyID *PostID `json:"parent_reply_id,omitempty"`
}

type ListAuthorRepliesRequest struct {
	Owner         profile.ProfileAddress `json:"owner"`
	PaginationKey *common.PaginationKey  `json:"pagination_key,omitempty"`
	Limit         *int32                 `json:"limit,omitempty"`
}

func (r *ListAuthorRepliesRequest) Normalize() {
	r.Owner = normalizeAddress(r.Owner)
}

func (r ListAuthorRepliesRequest) EffectiveLimit() int32 {
	return effectiveLimit(r.Limit)
}

func (r ListAuthorRepliesRequest) Validate() []string {
	fields := []string{}
	if !profile.IsProfileAddress(r.Owner) {
		fields = append(fields, "owner")
	}
	return append(fields, ValidPage(r.PaginationKey, r.Limit)...)
}

type ListAuthorRepliesResponse struct {
	Replies           []AuthorReply         `json:"replies"`
	Muted             bool                  `json:"muted"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}
