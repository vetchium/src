package posts

import (
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
)

// MaxGetMany is the most references in one get-many call.
const MaxGetMany = 50

// MeshPost is a post as the owner's tenant serves it to another tenant.
type MeshPost struct {
	Post
	OwnerHubUserDID hub.HubUserDID `json:"owner_hub_user_did"`
}

// MeshListPostsRequest carries the viewer fields from the local Hub API
// session. The serving tenant verifies that the caller homes the viewer.
type MeshListPostsRequest struct {
	OwnerHubUserDID  hub.HubUserDID        `json:"owner_hub_user_did"`
	ViewerHubUserDID hub.HubUserDID        `json:"viewer_hub_user_did"`
	ViewerHandle     hub.HubHandle         `json:"viewer_handle"`
	PaginationKey    *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit            *int32                `json:"limit,omitempty"`
}

func (r *MeshListPostsRequest) Normalize() {}

func (r MeshListPostsRequest) EffectiveLimit() int32 {
	return effectiveLimit(r.Limit)
}

func (r MeshListPostsRequest) Validate() []string {
	fields := []string{}
	if !hub.IsHubUserDID(r.OwnerHubUserDID) {
		fields = append(fields, "owner_hub_user_did")
	}
	if !hub.IsHubUserDID(r.ViewerHubUserDID) {
		fields = append(fields, "viewer_hub_user_did")
	}
	if !hub.IsHubHandle(r.ViewerHandle) {
		fields = append(fields, "viewer_handle")
	}
	return append(fields, ValidPage(r.PaginationKey, r.Limit)...)
}

type MeshListPostsResponse struct {
	Posts             []MeshPost            `json:"posts"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type MeshPostReference struct {
	OwnerHubUserDID hub.HubUserDID `json:"owner_hub_user_did"`
	PostID          PostID         `json:"post_id"`
}

type MeshGetManyPostsRequest struct {
	ViewerHubUserDID hub.HubUserDID      `json:"viewer_hub_user_did"`
	ViewerHandle     hub.HubHandle       `json:"viewer_handle"`
	Posts            []MeshPostReference `json:"posts"`
}

func (r *MeshGetManyPostsRequest) Normalize() {}

func (r MeshGetManyPostsRequest) Validate() []string {
	fields := []string{}
	if !hub.IsHubUserDID(r.ViewerHubUserDID) {
		fields = append(fields, "viewer_hub_user_did")
	}
	if !hub.IsHubHandle(r.ViewerHandle) {
		fields = append(fields, "viewer_handle")
	}
	valid := len(r.Posts) >= 1 && len(r.Posts) <= MaxGetMany
	for _, reference := range r.Posts {
		if !hub.IsHubUserDID(reference.OwnerHubUserDID) ||
			!IsPostID(reference.PostID) {
			valid = false
		}
	}
	if !valid {
		fields = append(fields, "posts")
	}
	return fields
}

type MeshPostStatus string

const (
	MeshPostFound    MeshPostStatus = "found"
	MeshPostNotFound MeshPostStatus = "not-found"
	MeshPostNotHomed MeshPostStatus = "not-homed"
)

// MeshPostResult is one get-many result. Post is set only when Status is
// `found`.
type MeshPostResult struct {
	Status          MeshPostStatus `json:"status"`
	OwnerHubUserDID hub.HubUserDID `json:"owner_hub_user_did"`
	PostID          PostID         `json:"post_id"`
	Post            *MeshPost      `json:"post,omitempty"`
}

type MeshGetManyPostsResponse struct {
	Results []MeshPostResult `json:"results"`
}

// MeshReply is a reply as the post owner's tenant serves it. The author DID
// lets the viewer's tenant filter muted authors (PST-THR-005).
type MeshReply struct {
	Reply
	AuthorHubUserDID hub.HubUserDID `json:"author_hub_user_did"`
}

func validViewer(did hub.HubUserDID, handle hub.HubHandle) []string {
	fields := []string{}
	if !hub.IsHubUserDID(did) {
		fields = append(fields, "viewer_hub_user_did")
	}
	if !hub.IsHubHandle(handle) {
		fields = append(fields, "viewer_handle")
	}
	return fields
}

type MeshListRepliesRequest struct {
	OwnerHubUserDID  hub.HubUserDID        `json:"owner_hub_user_did"`
	PostID           PostID                `json:"post_id"`
	ParentReplyID    *PostID               `json:"parent_reply_id,omitempty"`
	FromReplyID      *PostID               `json:"from_reply_id,omitempty"`
	ViewerHubUserDID hub.HubUserDID        `json:"viewer_hub_user_did"`
	ViewerHandle     hub.HubHandle         `json:"viewer_handle"`
	PaginationKey    *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit            *int32                `json:"limit,omitempty"`
}

func (r *MeshListRepliesRequest) Normalize() {}

func (r MeshListRepliesRequest) EffectiveLimit() int32 {
	return effectiveLimit(r.Limit)
}

func (r MeshListRepliesRequest) Validate() []string {
	fields := []string{}
	if !hub.IsHubUserDID(r.OwnerHubUserDID) {
		fields = append(fields, "owner_hub_user_did")
	}
	if !IsPostID(r.PostID) {
		fields = append(fields, "post_id")
	}
	if r.ParentReplyID != nil && !IsPostID(*r.ParentReplyID) {
		fields = append(fields, "parent_reply_id")
	}
	fields = append(fields, validFrom(r.FromReplyID, r.PaginationKey)...)
	fields = append(fields, validViewer(r.ViewerHubUserDID, r.ViewerHandle)...)
	return append(fields, ValidPage(r.PaginationKey, r.Limit)...)
}

type MeshListRepliesResponse struct {
	Replies           []MeshReply           `json:"replies"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}

type MeshGetReplyRequest struct {
	OwnerHubUserDID  hub.HubUserDID `json:"owner_hub_user_did"`
	PostID           PostID         `json:"post_id"`
	ReplyID          PostID         `json:"reply_id"`
	ViewerHubUserDID hub.HubUserDID `json:"viewer_hub_user_did"`
	ViewerHandle     hub.HubHandle  `json:"viewer_handle"`
}

func (r *MeshGetReplyRequest) Normalize() {}

func (r MeshGetReplyRequest) Validate() []string {
	fields := []string{}
	if !hub.IsHubUserDID(r.OwnerHubUserDID) {
		fields = append(fields, "owner_hub_user_did")
	}
	if !IsPostID(r.PostID) {
		fields = append(fields, "post_id")
	}
	if !IsPostID(r.ReplyID) {
		fields = append(fields, "reply_id")
	}
	return append(fields, validViewer(r.ViewerHubUserDID, r.ViewerHandle)...)
}

// MeshGetReplyResponse tells the replier's tenant who wrote a parent reply
// before a sub-reply (PST-RPL-004). It holds no words.
type MeshGetReplyResponse struct {
	ReplyID          PostID             `json:"reply_id"`
	PostID           PostID             `json:"post_id"`
	ParentReplyID    *PostID            `json:"parent_reply_id,omitempty"`
	AuthorHubUserDID hub.HubUserDID     `json:"author_hub_user_did"`
	AuthorTenantID   directory.TenantID `json:"author_tenant_id"`
	AuthorHandle     hub.HubHandle      `json:"author_handle"`
	State            ThreadReplyState   `json:"state"`
}

type MeshListAuthorRepliesRequest struct {
	AuthorHubUserDID hub.HubUserDID        `json:"author_hub_user_did"`
	ViewerHubUserDID hub.HubUserDID        `json:"viewer_hub_user_did"`
	ViewerHandle     hub.HubHandle         `json:"viewer_handle"`
	PaginationKey    *common.PaginationKey `json:"pagination_key,omitempty"`
	Limit            *int32                `json:"limit,omitempty"`
}

func (r *MeshListAuthorRepliesRequest) Normalize() {}

func (r MeshListAuthorRepliesRequest) EffectiveLimit() int32 {
	return effectiveLimit(r.Limit)
}

func (r MeshListAuthorRepliesRequest) Validate() []string {
	fields := []string{}
	if !hub.IsHubUserDID(r.AuthorHubUserDID) {
		fields = append(fields, "author_hub_user_did")
	}
	fields = append(fields, validViewer(r.ViewerHubUserDID, r.ViewerHandle)...)
	return append(fields, ValidPage(r.PaginationKey, r.Limit)...)
}

type MeshListAuthorRepliesResponse struct {
	Replies           []AuthorReply         `json:"replies"`
	NextPaginationKey *common.PaginationKey `json:"next_pagination_key,omitempty"`
}
