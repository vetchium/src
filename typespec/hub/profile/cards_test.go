package profile

import (
	"reflect"
	"testing"

	"github.com/vetchium/src/typespec/hub"
)

func TestReadCardsRequest(t *testing.T) {
	t.Parallel()
	a, b := hub.HubHandle("abcde000-123456789ab"), hub.HubHandle("abcde001-123456789ab")
	cases := []struct {
		name    string
		handles []hub.HubHandle
		valid   bool
	}{
		{"one", []hub.HubHandle{a}, true},
		{"two", []hub.HubHandle{a, b}, true},
		{"none", nil, false},
		{"duplicate", []hub.HubHandle{a, a}, false},
		{"bad handle", []hub.HubHandle{"x"}, false},
	}
	many := make([]hub.HubHandle, MaxCardHandles+1)
	for index := range many {
		many[index] = hub.HubHandle("abcde" + string(rune('a'+index/26)) + string(rune('a'+index%26)) + "0-123456789ab")
	}
	cases = append(cases,
		struct {
			name    string
			handles []hub.HubHandle
			valid   bool
		}{"fifty", many[:MaxCardHandles], true},
		struct {
			name    string
			handles []hub.HubHandle
			valid   bool
		}{"fifty-one", many, false},
	)
	for _, test := range cases {
		got := ReadCardsRequest{Handles: test.handles}.Validate()
		want := []string{"handles"}
		if test.valid {
			want = []string{}
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s: %v", test.name, got)
		}
	}
}

func TestReadCardsPeerRequests(t *testing.T) {
	t.Parallel()
	did := hub.HubUserDID("01987aef-1234-7abc-8abc-123456789abc")
	handle := hub.HubHandle("abcde000-123456789ab")
	if got := (RelayReadCardsRequest{ViewerHubUserDID: did, ViewerHandle: handle, Handles: []hub.HubHandle{handle}}).Validate(); len(got) != 0 {
		t.Fatalf("relay: %v", got)
	}
	got := PeerReadCardsRequest{}.Validate()
	if !reflect.DeepEqual(got, []string{"viewer_hub_user_did", "viewer_handle", "handles"}) {
		t.Fatalf("peer: %v", got)
	}
}
