package profile

import (
	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/hub"
)

// MaxCardHandles is the most handles in one read-cards call.
const MaxCardHandles = 50

// ProfileCard holds the fields another Hub user sees beside a post or reply.
type ProfileCard struct {
	Handle      hub.HubHandle       `json:"handle"`
	Alias       *directory.HubAlias `json:"alias,omitempty"`
	DisplayName common.DisplayName  `json:"display_name"`
	PictureURL  *string             `json:"picture_url,omitempty"`
}

func validHandles(handles []hub.HubHandle) bool {
	if len(handles) < 1 || len(handles) > MaxCardHandles {
		return false
	}
	seen := make(map[hub.HubHandle]bool, len(handles))
	for _, handle := range handles {
		if !hub.IsHubHandle(handle) || seen[handle] {
			return false
		}
		seen[handle] = true
	}
	return true
}

type ReadCardsRequest struct {
	Handles []hub.HubHandle `json:"handles"`
}

func (r *ReadCardsRequest) Normalize() {}

func (r ReadCardsRequest) Validate() []string {
	if !validHandles(r.Handles) {
		return []string{"handles"}
	}
	return []string{}
}

type ReadCardsResponse struct {
	Cards []ProfileCard `json:"cards"`
	// Unavailable lists handles whose region did not answer in time.
	Unavailable []hub.HubHandle `json:"unavailable"`
}

// RelayReadCardsRequest is accepted only from the tenant-local Hub API. The
// viewer fields must come from its authenticated session.
type RelayReadCardsRequest struct {
	ViewerHubUserDID hub.HubUserDID  `json:"viewer_hub_user_did"`
	ViewerHandle     hub.HubHandle   `json:"viewer_handle"`
	Handles          []hub.HubHandle `json:"handles"`
}

func (r *RelayReadCardsRequest) Normalize() {}

func (r RelayReadCardsRequest) Validate() []string {
	return validateCardsPeer(r.ViewerHubUserDID, r.ViewerHandle, r.Handles)
}

// PeerReadCardsRequest is sent over authenticated tenant-to-tenant HTTPS.
type PeerReadCardsRequest struct {
	ViewerHubUserDID hub.HubUserDID  `json:"viewer_hub_user_did"`
	ViewerHandle     hub.HubHandle   `json:"viewer_handle"`
	Handles          []hub.HubHandle `json:"handles"`
}

func (r *PeerReadCardsRequest) Normalize() {}

func (r PeerReadCardsRequest) Validate() []string {
	return validateCardsPeer(r.ViewerHubUserDID, r.ViewerHandle, r.Handles)
}

func validateCardsPeer(
	did hub.HubUserDID, handle hub.HubHandle, handles []hub.HubHandle,
) []string {
	fields := []string{}
	if !hub.IsHubUserDID(did) {
		fields = append(fields, "viewer_hub_user_did")
	}
	if !hub.IsHubHandle(handle) {
		fields = append(fields, "viewer_handle")
	}
	if !validHandles(handles) {
		fields = append(fields, "handles")
	}
	return fields
}
