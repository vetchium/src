package federation

import (
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/hub"
	hubposts "github.com/vetchium/src/typespec/hub/posts"
)

const postID = hubposts.PostID("0123456789abcdefghij0123456789abcdefghij")

func validReply() HubPostReplyRegisterPayload {
	return HubPostReplyRegisterPayload{
		PostID: postID, ReplyID: postID,
		ReplierHubUserDID: "01987aef-1234-7abc-8abc-123456789abc",
		ReplierHandle:     "abcde000-123456789ab",
		Body:              "hello",
		CreatedAt:         time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
	}
}

func TestPostKindsAreCommandAndEventKinds(t *testing.T) {
	t.Parallel()
	if !IsCommandKind(HubPostReplyRegisterKind) || HubPostReplyRegisterKind != "hub-post-reply-register" {
		t.Fatalf("command kind = %q", HubPostReplyRegisterKind)
	}
	events := map[EventKind]string{
		HubReplyEditedKind:  "hub-reply-edited",
		HubReplyRemovedKind: "hub-reply-removed",
		HubPostRemovedKind:  "hub-post-removed",
	}
	for kind, want := range events {
		if !IsEventKind(kind) || string(kind) != want {
			t.Errorf("event kind = %q, want %q", kind, want)
		}
	}
	for _, aggregate := range []AggregateType{AggregateHubReply, AggregateHubPost} {
		if !IsAggregateType(aggregate) {
			t.Errorf("aggregate type %q refused", aggregate)
		}
	}
	if AggregateHubReply != "hub_reply" || AggregateHubPost != "hub_post" {
		t.Fatal("aggregate type values")
	}
}

func TestHubPostReplyRegisterPayload(t *testing.T) {
	t.Parallel()
	payload := validReply()
	if got := payload.Validate(); len(got) != 0 {
		t.Fatalf("valid payload refused: %v", got)
	}
	parent := postID
	payload.ParentReplyID = &parent
	if got := payload.Validate(); len(got) != 0 {
		t.Fatalf("sub-reply refused: %v", got)
	}

	padded := validReply()
	padded.Body = "  hello  "
	original := padded
	copyPayload := padded
	copyPayload.Normalize()
	if padded != original || copyPayload.Body != "hello" {
		t.Fatalf("normalize: %#v", copyPayload)
	}

	badParent := hubposts.PostID("x")
	bad := HubPostReplyRegisterPayload{ParentReplyID: &badParent, Body: strings.Repeat("a", 513)}
	want := []string{
		"post_id", "reply_id", "parent_reply_id", "replier_hub_user_did",
		"replier_handle", "body", "created_at",
	}
	if got := bad.Validate(); !reflect.DeepEqual(got, want) {
		t.Fatalf("bad payload: %v", got)
	}
}

func TestReplyAndPostEventPayloads(t *testing.T) {
	t.Parallel()
	did := hub.HubUserDID("01987aef-1234-7abc-8abc-123456789abc")
	if got := (HubReplyEditedPayload{PostID: postID, ReplyID: postID, Body: "a", Revision: 2, AuthorHubUserDID: did}).Validate(); len(got) != 0 {
		t.Fatalf("edited: %v", got)
	}
	got := HubReplyEditedPayload{Body: "a\x00"}.Validate()
	if !reflect.DeepEqual(got, []string{"post_id", "reply_id", "body", "revision", "author_hub_user_did"}) {
		t.Fatalf("bad edited: %v", got)
	}
	if got := (HubReplyRemovedPayload{PostID: postID, ReplyID: postID, AuthorHubUserDID: did}).Validate(); len(got) != 0 {
		t.Fatalf("removed: %v", got)
	}
	if got := (HubReplyRemovedPayload{}).Validate(); !reflect.DeepEqual(got, []string{"post_id", "reply_id", "author_hub_user_did"}) {
		t.Fatalf("bad removed: %v", got)
	}
	if got := (HubPostRemovedPayload{PostID: postID, OwnerHubUserDID: did}).Validate(); len(got) != 0 {
		t.Fatalf("post removed: %v", got)
	}
	if got := (HubPostRemovedPayload{}).Validate(); !reflect.DeepEqual(got, []string{"post_id", "owner_hub_user_did"}) {
		t.Fatalf("bad post removed: %v", got)
	}
}
