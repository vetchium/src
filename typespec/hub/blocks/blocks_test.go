package blocks

import (
	"reflect"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/hub/profile"
)

func TestBlockUserRequest(t *testing.T) {
	t.Parallel()
	request := BlockUserRequest{User: "  abcde000-123456789ab  "}
	original := request
	copyRequest := request
	copyRequest.Normalize()
	if request != original {
		t.Fatal("normalizing a copy changed the original")
	}
	if copyRequest.User != "abcde000-123456789ab" || len(copyRequest.Validate()) != 0 {
		t.Fatalf("valid request rejected: %#v", copyRequest)
	}
	for _, user := range []string{"", "BAD address", "api"} {
		if got := (BlockUserRequest{User: profile.ProfileAddress(user)}).Validate(); !reflect.DeepEqual(got, []string{"user"}) {
			t.Fatalf("user %q: %v", user, got)
		}
	}
}

func TestListRequests(t *testing.T) {
	t.Parallel()
	key := common.PaginationKey("")
	limits := map[int32]bool{0: false, 51: false, 1: true, 50: true}
	for limit, ok := range limits {
		limit := limit
		blocked := ListBlockedUsersRequest{Limit: &limit}.Validate()
		muted := ListMutedUsersRequest{Limit: &limit}.Validate()
		want := []string{"limit"}
		if ok {
			want = []string{}
		}
		if !reflect.DeepEqual(blocked, want) || !reflect.DeepEqual(muted, want) {
			t.Fatalf("limit %d: %v %v", limit, blocked, muted)
		}
	}
	if got := (ListBlockedUsersRequest{PaginationKey: &key}).Validate(); !reflect.DeepEqual(got, []string{"pagination_key"}) {
		t.Fatalf("empty key: %v", got)
	}
	if got := (ListMutedUsersRequest{}).EffectiveLimit(); got != DefaultLimit {
		t.Fatalf("default limit %d", got)
	}
}

func TestCheckBlockRequest(t *testing.T) {
	t.Parallel()
	did := hub.HubUserDID("01987aef-1234-7abc-8abc-123456789abc")
	valid := CheckBlockRequest{
		BlockerHubUserDID: did,
		BlockedHubUserDID: did,
		ViewerHandle:      "abcde000-123456789ab",
	}
	if got := valid.Validate(); len(got) != 0 {
		t.Fatalf("valid request rejected: %v", got)
	}
	got := CheckBlockRequest{}.Validate()
	want := []string{"blocker_hub_user_did", "blocked_hub_user_did", "viewer_handle"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("invalid fields: %v", got)
	}
}
