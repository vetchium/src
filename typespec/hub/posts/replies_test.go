package posts

import (
	"reflect"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
)

const (
	ownerAddress = "abcde000-123456789ab"
	viewerDID    = hub.HubUserDID("01987aef-1234-7abc-8abc-123456789abc")
	viewerHandle = hub.HubHandle("abcde000-123456789ab")
)

func TestReplyRequest(t *testing.T) {
	t.Parallel()
	parent := validID
	request := ReplyRequest{
		Owner: "  " + ownerAddress + "  ", PostID: validID,
		ParentReplyID: &parent, Body: "  hi\nthere  ",
	}
	original := request
	copyRequest := request
	copyRequest.Normalize()
	if request != original {
		t.Fatal("normalizing a copy changed the original")
	}
	if string(copyRequest.Owner) != ownerAddress || copyRequest.Body != "hi\nthere" ||
		len(copyRequest.Validate()) != 0 {
		t.Fatalf("valid request refused: %#v %v", copyRequest, copyRequest.Validate())
	}
	badParent := PostID("x")
	bad := ReplyRequest{Owner: "BAD address", PostID: "x", ParentReplyID: &badParent, Body: "a\x00"}
	want := []string{"owner", "post_id", "parent_reply_id", "body"}
	if got := bad.Validate(); !reflect.DeepEqual(got, want) {
		t.Fatalf("bad request: %v", got)
	}
	for _, body := range []string{"", strings.Repeat("a", MaxBodyLength+1)} {
		got := ReplyRequest{Owner: ownerAddress, PostID: validID, Body: body}.Validate()
		if !reflect.DeepEqual(got, []string{"body"}) {
			t.Errorf("body length %d: %v", len(body), got)
		}
	}
	ok := ReplyRequest{Owner: ownerAddress, PostID: validID, Body: strings.Repeat("😀", MaxBodyLength)}
	if got := ok.Validate(); len(got) != 0 {
		t.Fatalf("512 code points refused: %v", got)
	}
}

func TestEditRemoveAndHideReplyRequests(t *testing.T) {
	t.Parallel()
	edit := EditReplyRequest{ReplyID: validID, Body: "  new  ", Revision: 1}
	original := edit
	copyEdit := edit
	copyEdit.Normalize()
	if edit != original || copyEdit.Body != "new" || len(copyEdit.Validate()) != 0 {
		t.Fatalf("edit: %#v %v", copyEdit, copyEdit.Validate())
	}
	bad := EditReplyRequest{ReplyID: "x", Body: "", Revision: 0}
	if got := bad.Validate(); !reflect.DeepEqual(got, []string{"reply_id", "body", "revision"}) {
		t.Fatalf("bad edit: %v", got)
	}
	if got := (RemoveReplyRequest{ReplyID: validID}).Validate(); len(got) != 0 {
		t.Fatalf("remove: %v", got)
	}
	if got := (RemoveReplyRequest{}).Validate(); !reflect.DeepEqual(got, []string{"reply_id"}) {
		t.Fatalf("remove: %v", got)
	}
	if got := (HideReplyRequest{PostID: validID, ReplyID: validID}).Validate(); len(got) != 0 {
		t.Fatalf("hide: %v", got)
	}
	if got := (HideReplyRequest{}).Validate(); !reflect.DeepEqual(got, []string{"post_id", "reply_id"}) {
		t.Fatalf("hide: %v", got)
	}
}

func TestListReplyRequests(t *testing.T) {
	t.Parallel()
	request := ListRepliesRequest{Owner: "  " + ownerAddress + "  ", PostID: validID}
	original := request
	copyRequest := request
	copyRequest.Normalize()
	if request != original || string(copyRequest.Owner) != ownerAddress {
		t.Fatalf("normalize: %#v", copyRequest)
	}
	if copyRequest.EffectiveLimit() != DefaultLimit || len(copyRequest.Validate()) != 0 {
		t.Fatalf("default list: %v", copyRequest.Validate())
	}
	for _, limit := range []int32{0, MaxLimit + 1} {
		got := ListRepliesRequest{Owner: ownerAddress, PostID: validID, Limit: &limit}.Validate()
		if !reflect.DeepEqual(got, []string{"limit"}) {
			t.Errorf("limit %d: %v", limit, got)
		}
	}
	key, parent := common.PaginationKey(""), PostID("x")
	got := ListRepliesRequest{Owner: "api", PostID: "x", ParentReplyID: &parent, PaginationKey: &key}.Validate()
	if !reflect.DeepEqual(got, []string{"owner", "post_id", "parent_reply_id", "pagination_key"}) {
		t.Fatalf("bad list: %v", got)
	}

	from, badFrom, realKey := PostID(validID), PostID("x"), common.PaginationKey("k")
	if got := (ListRepliesRequest{
		Owner: ownerAddress, PostID: validID, FromReplyID: &from,
	}).Validate(); len(got) != 0 {
		t.Fatalf("from: %v", got)
	}
	for _, request := range []ListRepliesRequest{
		{Owner: ownerAddress, PostID: validID, FromReplyID: &badFrom},
		{Owner: ownerAddress, PostID: validID, FromReplyID: &from, PaginationKey: &realKey},
	} {
		if got := request.Validate(); !reflect.DeepEqual(got, []string{"from_reply_id"}) {
			t.Errorf("from %#v: %v", request, got)
		}
	}

	locate := LocateReplyRequest{
		Owner: "  " + ownerAddress + "  ", PostID: validID, ReplyID: validID,
	}
	locateCopy := locate
	locateCopy.Normalize()
	if string(locate.Owner) == ownerAddress || string(locateCopy.Owner) != ownerAddress ||
		len(locateCopy.Validate()) != 0 {
		t.Fatalf("locate: %#v %v", locateCopy, locateCopy.Validate())
	}
	if got := (LocateReplyRequest{Owner: "api", PostID: "x", ReplyID: "y"}).Validate(); !reflect.DeepEqual(
		got, []string{"owner", "post_id", "reply_id"}) {
		t.Fatalf("bad locate: %v", got)
	}

	author := ListAuthorRepliesRequest{Owner: "  " + ownerAddress + "  "}
	author.Normalize()
	if string(author.Owner) != ownerAddress || author.EffectiveLimit() != DefaultLimit ||
		len(author.Validate()) != 0 {
		t.Fatalf("author list: %v", author.Validate())
	}
	limit := int32(51)
	got = ListAuthorRepliesRequest{Owner: "api", PaginationKey: &key, Limit: &limit}.Validate()
	if !reflect.DeepEqual(got, []string{"owner", "pagination_key", "limit"}) {
		t.Fatalf("bad author list: %v", got)
	}
}

func TestReplyStates(t *testing.T) {
	t.Parallel()
	for _, state := range []ThreadReplyState{ThreadReplyLive, ThreadReplyHidden, ThreadReplyPlaceholder} {
		if !IsThreadReplyState(state) {
			t.Errorf("%q refused", state)
		}
	}
	if IsThreadReplyState("hidden_by_owner") || IsThreadReplyState("") {
		t.Error("unknown thread state accepted")
	}
	if !IsAuthorReplyState(AuthorReplyLive) || !IsAuthorReplyState(AuthorReplyPostRemoved) ||
		IsAuthorReplyState("removed") {
		t.Error("author reply states")
	}
}

func TestMeshReplyRequests(t *testing.T) {
	t.Parallel()
	list := MeshListRepliesRequest{
		OwnerHubUserDID: viewerDID, PostID: validID,
		ViewerHubUserDID: viewerDID, ViewerHandle: viewerHandle,
	}
	if got := list.Validate(); len(got) != 0 {
		t.Fatalf("list: %v", got)
	}
	if list.EffectiveLimit() != DefaultLimit {
		t.Fatal("default limit")
	}
	parent := PostID("x")
	bad := MeshListRepliesRequest{ParentReplyID: &parent}
	want := []string{
		"owner_hub_user_did", "post_id", "parent_reply_id",
		"viewer_hub_user_did", "viewer_handle",
	}
	if got := bad.Validate(); !reflect.DeepEqual(got, want) {
		t.Fatalf("bad list: %v", got)
	}
	key := common.PaginationKey("k")
	list.FromReplyID, list.PaginationKey = &parent, &key
	if got := list.Validate(); !reflect.DeepEqual(got, []string{"from_reply_id"}) {
		t.Fatalf("bad from: %v", got)
	}

	get := MeshGetReplyRequest{
		OwnerHubUserDID: viewerDID, PostID: validID, ReplyID: validID,
		ViewerHubUserDID: viewerDID, ViewerHandle: viewerHandle,
	}
	if got := get.Validate(); len(got) != 0 {
		t.Fatalf("get: %v", got)
	}
	want = []string{"owner_hub_user_did", "post_id", "reply_id", "viewer_hub_user_did", "viewer_handle"}
	if got := (MeshGetReplyRequest{}).Validate(); !reflect.DeepEqual(got, want) {
		t.Fatalf("bad get: %v", got)
	}

	author := MeshListAuthorRepliesRequest{
		AuthorHubUserDID: viewerDID, ViewerHubUserDID: viewerDID, ViewerHandle: viewerHandle,
	}
	if got := author.Validate(); len(got) != 0 || author.EffectiveLimit() != DefaultLimit {
		t.Fatalf("author: %v", got)
	}
	limit := int32(0)
	want = []string{"author_hub_user_did", "viewer_hub_user_did", "viewer_handle", "limit"}
	if got := (MeshListAuthorRepliesRequest{Limit: &limit}).Validate(); !reflect.DeepEqual(got, want) {
		t.Fatalf("bad author: %v", got)
	}
}
