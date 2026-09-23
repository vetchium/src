package profile

import (
	"strings"

	"github.com/vetchium/src/typespec/hub"
)

// RelayReadProfileRequest is accepted only from the tenant-local Hub API.
// The viewer fields must come from its authenticated session.
type RelayReadProfileRequest struct {
	ViewerHubUserDID hub.HubUserDID `json:"viewer_hub_user_did"`
	ViewerHandle     hub.HubHandle  `json:"viewer_handle"`
	Address          ProfileAddress `json:"address"`
}

func (r *RelayReadProfileRequest) Normalize() {
	r.Address = ProfileAddress(strings.TrimSpace(string(r.Address)))
}

func (r RelayReadProfileRequest) Validate() []string {
	fields := []string{}
	if !hub.IsHubUserDID(r.ViewerHubUserDID) {
		fields = append(fields, "viewer_hub_user_did")
	}
	if !hub.IsHubHandle(r.ViewerHandle) {
		fields = append(fields, "viewer_handle")
	}
	if !IsProfileAddress(r.Address) {
		fields = append(fields, "address")
	}
	return fields
}

// PeerReadProfileRequest is sent over authenticated tenant-to-tenant HTTPS.
type PeerReadProfileRequest struct {
	ViewerHubUserDID hub.HubUserDID `json:"viewer_hub_user_did"`
	ViewerHandle     hub.HubHandle  `json:"viewer_handle"`
	TargetHubUserDID hub.HubUserDID `json:"target_hub_user_did"`
}

func (r *PeerReadProfileRequest) Normalize() {}

func (r PeerReadProfileRequest) Validate() []string {
	fields := []string{}
	if !hub.IsHubUserDID(r.ViewerHubUserDID) {
		fields = append(fields, "viewer_hub_user_did")
	}
	if !hub.IsHubHandle(r.ViewerHandle) {
		fields = append(fields, "viewer_handle")
	}
	if !hub.IsHubUserDID(r.TargetHubUserDID) {
		fields = append(fields, "target_hub_user_did")
	}
	return fields
}
