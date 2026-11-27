package posts

import (
	"github.com/vetchium/src/typespec/common"
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
