package profile

import (
	"reflect"
	"testing"

	"github.com/vetchium/src/typespec/hub"
)

func TestFederatedProfileReadRequests(t *testing.T) {
	viewer := hub.HubUserDID("01987aef-1234-7abc-8abc-123456789abc")
	handle := hub.HubHandle("abcde000-123456789ab")
	relay := RelayReadProfileRequest{
		ViewerHubUserDID: viewer,
		ViewerHandle:     handle,
		Address:          "  abcde000-123456789ab  ",
	}
	relay.Normalize()
	if relay.Address != ProfileAddress(handle) || len(relay.Validate()) != 0 {
		t.Fatalf("valid relay request rejected: %#v, %v", relay, relay.Validate())
	}
	relay.ViewerHubUserDID = "bad"
	relay.ViewerHandle = "bad"
	relay.Address = "BAD"
	if got := relay.Validate(); !reflect.DeepEqual(got, []string{
		"viewer_hub_user_did", "viewer_handle", "address",
	}) {
		t.Fatalf("invalid relay fields: %v", got)
	}
	peer := PeerReadProfileRequest{
		ViewerHubUserDID: viewer,
		ViewerHandle:     handle,
		TargetHubUserDID: viewer,
	}
	if got := peer.Validate(); len(got) != 0 {
		t.Fatalf("valid peer request rejected: %v", got)
	}
	peer.TargetHubUserDID = "bad"
	if got := peer.Validate(); !reflect.DeepEqual(got, []string{"target_hub_user_did"}) {
		t.Fatalf("invalid peer fields: %v", got)
	}
}
