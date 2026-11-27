package posts

import (
	"reflect"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
)

const validID = PostID("0123456789abcdefghij0123456789abcdefghij")

func TestIsPostID(t *testing.T) {
	t.Parallel()
	valid := []string{string(validID), strings.Repeat("0", 20) + strings.Repeat("z", 20)}
	invalid := []string{
		"",
		strings.Repeat("0", 39),
		strings.Repeat("0", 41),
		// w to z are outside the XID alphabet.
		"w" + strings.Repeat("0", 39),
		strings.Repeat("0", 20) + strings.Repeat("A", 20),
		strings.Repeat("0", 20) + strings.Repeat("-", 20),
	}
	for _, value := range valid {
		if !IsPostID(PostID(value)) {
			t.Errorf("%q refused", value)
		}
	}
	for _, value := range invalid {
		if IsPostID(PostID(value)) {
			t.Errorf("%q accepted", value)
		}
	}
}

func TestBodyLimit(t *testing.T) {
	t.Parallel()
	for _, character := range []string{"a", "é", "日", "😀"} {
		ok := CreatePostRequest{Body: strings.Repeat(character, MaxBodyLength)}
		if got := ok.Validate(); len(got) != 0 {
			t.Errorf("512 of %q refused: %v", character, got)
		}
		tooLong := CreatePostRequest{Body: strings.Repeat(character, MaxBodyLength+1)}
		if got := tooLong.Validate(); !reflect.DeepEqual(got, []string{"body"}) {
			t.Errorf("513 of %q: %v", character, got)
		}
	}
	for _, body := range []string{"", "a\x00b", "\x00"} {
		if got := (CreatePostRequest{Body: body}).Validate(); !reflect.DeepEqual(got, []string{"body"}) {
			t.Errorf("body %q: %v", body, got)
		}
	}
}

func TestCreatePostRequest(t *testing.T) {
	t.Parallel()
	request := CreatePostRequest{Body: "  line one\nline two  "}
	original := request
	copyRequest := request
	copyRequest.Normalize()
	if request != original {
		t.Fatal("normalizing a copy changed the original")
	}
	if copyRequest.Body != "line one\nline two" || len(copyRequest.Validate()) != 0 {
		t.Fatalf("valid request rejected: %#v", copyRequest)
	}
	blank := CreatePostRequest{Body: " \n\t "}
	blank.Normalize()
	if got := blank.Validate(); !reflect.DeepEqual(got, []string{"body"}) {
		t.Fatalf("blank body: %v", got)
	}
	// 512 code points plus surrounding whitespace is valid after trimming.
	padded := CreatePostRequest{Body: " " + strings.Repeat("é", MaxBodyLength) + " "}
	padded.Normalize()
	if got := padded.Validate(); len(got) != 0 {
		t.Fatalf("padded body: %v", got)
	}
	nobody, bad := ReplyNobody, ReplyPolicy("some")
	quote := QuotePolicy("some")
	if got := (CreatePostRequest{Body: "a", ReplyPolicy: &nobody}).Validate(); len(got) != 0 {
		t.Fatalf("valid policy refused: %v", got)
	}
	got := CreatePostRequest{Body: "a", ReplyPolicy: &bad, QuotePolicy: &quote}.Validate()
	if !reflect.DeepEqual(got, []string{"reply_policy", "quote_policy"}) {
		t.Fatalf("policies: %v", got)
	}
}

func TestEditPostRequest(t *testing.T) {
	t.Parallel()
	request := EditPostRequest{PostID: validID, Body: "  new  ", Revision: 1}
	original := request
	copyRequest := request
	copyRequest.Normalize()
	if request != original || copyRequest.Body != "new" {
		t.Fatalf("normalize: %#v %#v", request, copyRequest)
	}
	if got := copyRequest.Validate(); len(got) != 0 {
		t.Fatalf("valid request refused: %v", got)
	}
	bad := EditPostRequest{PostID: "x", Body: "a\x00", Revision: 0}
	if got := bad.Validate(); !reflect.DeepEqual(got, []string{"post_id", "body", "revision"}) {
		t.Fatalf("bad request: %v", got)
	}
}

func TestRemoveAndPoliciesRequests(t *testing.T) {
	t.Parallel()
	if got := (RemovePostRequest{PostID: validID}).Validate(); len(got) != 0 {
		t.Fatalf("remove: %v", got)
	}
	if got := (RemovePostRequest{}).Validate(); !reflect.DeepEqual(got, []string{"post_id"}) {
		t.Fatalf("remove: %v", got)
	}
	ok := SetPostPoliciesRequest{PostID: validID, ReplyPolicy: ReplyNobody, QuotePolicy: QuoteEveryone}
	if got := ok.Validate(); len(got) != 0 {
		t.Fatalf("policies: %v", got)
	}
	bad := SetPostPoliciesRequest{}
	if got := bad.Validate(); !reflect.DeepEqual(got, []string{"post_id", "reply_policy", "quote_policy"}) {
		t.Fatalf("policies: %v", got)
	}
}

func TestListAndGetRequests(t *testing.T) {
	t.Parallel()
	owner := "  abcde000-123456789ab  "
	request := ListPostsRequest{Owner: "  abcde000-123456789ab  "}
	original := request
	copyRequest := request
	copyRequest.Normalize()
	if request != original || string(copyRequest.Owner) != strings.TrimSpace(owner) {
		t.Fatalf("normalize: %#v", copyRequest)
	}
	if got := copyRequest.Validate(); len(got) != 0 {
		t.Fatalf("valid list refused: %v", got)
	}
	if copyRequest.EffectiveLimit() != DefaultLimit {
		t.Fatal("default limit")
	}
	for limit, ok := range map[int32]bool{0: false, 51: false, 1: true, 50: true} {
		limit := limit
		got := ListPostsRequest{Owner: "abcde000-123456789ab", Limit: &limit}.Validate()
		want := []string{"limit"}
		if ok {
			want = []string{}
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("limit %d: %v", limit, got)
		}
	}
	key := common.PaginationKey("")
	got := ListPostsRequest{Owner: "BAD address", PaginationKey: &key}.Validate()
	if !reflect.DeepEqual(got, []string{"owner", "pagination_key"}) {
		t.Fatalf("bad list: %v", got)
	}
	if got := (GetPostRequest{Owner: "abcde000-123456789ab", PostID: validID}).Validate(); len(got) != 0 {
		t.Fatalf("get: %v", got)
	}
	if got := (GetPostRequest{Owner: "api", PostID: "x"}).Validate(); !reflect.DeepEqual(got, []string{"owner", "post_id"}) {
		t.Fatalf("bad get: %v", got)
	}
}

func TestMeshRequests(t *testing.T) {
	t.Parallel()
	did := hub.HubUserDID("01987aef-1234-7abc-8abc-123456789abc")
	handle := hub.HubHandle("abcde000-123456789ab")
	list := MeshListPostsRequest{OwnerHubUserDID: did, ViewerHubUserDID: did, ViewerHandle: handle}
	if got := list.Validate(); len(got) != 0 {
		t.Fatalf("list: %v", got)
	}
	bad := MeshListPostsRequest{}
	if got := bad.Validate(); !reflect.DeepEqual(got, []string{"owner_hub_user_did", "viewer_hub_user_did", "viewer_handle"}) {
		t.Fatalf("bad list: %v", got)
	}
	reference := MeshPostReference{OwnerHubUserDID: did, PostID: validID}
	many := MeshGetManyPostsRequest{ViewerHubUserDID: did, ViewerHandle: handle, Posts: []MeshPostReference{reference}}
	if got := many.Validate(); len(got) != 0 {
		t.Fatalf("get-many: %v", got)
	}
	many.Posts = make([]MeshPostReference, MaxGetMany+1)
	for index := range many.Posts {
		many.Posts[index] = reference
	}
	if got := many.Validate(); !reflect.DeepEqual(got, []string{"posts"}) {
		t.Fatalf("51 references: %v", got)
	}
	many.Posts = nil
	if got := many.Validate(); !reflect.DeepEqual(got, []string{"posts"}) {
		t.Fatalf("no references: %v", got)
	}
	many.Posts = []MeshPostReference{{OwnerHubUserDID: did, PostID: "x"}}
	if got := many.Validate(); !reflect.DeepEqual(got, []string{"posts"}) {
		t.Fatalf("bad reference: %v", got)
	}
}
