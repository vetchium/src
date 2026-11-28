package posts

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func timelineTarget() QuoteTarget {
	return QuoteTarget{Type: QuoteTargetTimelinePost, Owner: ownerAddress, PostID: validID}
}

func openingTarget() QuoteTarget {
	return QuoteTarget{Type: QuoteTargetOpening, OrgDomain: "example.com", OpeningNumber: 7}
}

func TestQuoteTargetDiscriminator(t *testing.T) {
	t.Parallel()
	if !timelineTarget().Valid() || !openingTarget().Valid() {
		t.Fatal("valid target refused")
	}
	mixed := timelineTarget()
	mixed.OpeningNumber = 1
	crossed := openingTarget()
	crossed.PostID = validID
	for name, target := range map[string]QuoteTarget{
		"unknown type":          {Type: "reply", Owner: ownerAddress, PostID: validID},
		"empty type":            {Owner: ownerAddress, PostID: validID},
		"timeline no owner":     {Type: QuoteTargetTimelinePost, PostID: validID},
		"timeline bad post id":  {Type: QuoteTargetTimelinePost, Owner: ownerAddress, PostID: "x"},
		"timeline bad owner":    {Type: QuoteTargetTimelinePost, Owner: "BAD address", PostID: validID},
		"timeline with opening": mixed,
		"opening no domain":     {Type: QuoteTargetOpening, OpeningNumber: 1},
		"opening zero number":   {Type: QuoteTargetOpening, OrgDomain: "example.com"},
		"opening negative":      {Type: QuoteTargetOpening, OrgDomain: "example.com", OpeningNumber: -1},
		"opening with post":     crossed,
	} {
		if target.Valid() {
			t.Errorf("%s: accepted", name)
		}
	}
	if !IsQuoteTargetType(QuoteTargetOpening) || IsQuoteTargetType("reply") {
		t.Fatal("target type values")
	}
}

func TestQuoteTargetWire(t *testing.T) {
	t.Parallel()
	data, err := json.Marshal(openingTarget())
	if err != nil || string(data) != `{"type":"opening","org_domain":"example.com","opening_number":7}` {
		t.Fatalf("opening wire: %s %v", data, err)
	}
	data, err = json.Marshal(timelineTarget())
	if err != nil || strings.Contains(string(data), "org_domain") ||
		!strings.Contains(string(data), `"type":"timeline_post"`) {
		t.Fatalf("timeline wire: %s %v", data, err)
	}
}

func TestPostEmbedDiscriminator(t *testing.T) {
	t.Parallel()
	post := EmbeddedPost{PostID: validID}
	for name, want := range map[string]struct {
		embed PostEmbed
		valid bool
	}{
		"post":                {PostEmbed{State: EmbedPost, Post: &post}, true},
		"opening":             {PostEmbed{State: EmbedOpening, Opening: &EmbeddedOpening{}}, true},
		"unavailable":         {PostEmbed{State: EmbedUnavailable}, true},
		"post without post":   {PostEmbed{State: EmbedPost}, false},
		"post with opening":   {PostEmbed{State: EmbedPost, Post: &post, Opening: &EmbeddedOpening{}}, false},
		"unavailable w/ post": {PostEmbed{State: EmbedUnavailable, Post: &post}, false},
		"unknown":             {PostEmbed{State: "x"}, false},
	} {
		if want.embed.Valid() != want.valid {
			t.Errorf("%s: valid = %v", name, !want.valid)
		}
	}
	nested := Post{PostID: validID, QuoteTarget: &QuoteTarget{Type: QuoteTargetTimelinePost, Owner: ownerAddress, PostID: validID}}
	embedded := nested.Embedded()
	if embedded.QuoteTarget == nil || embedded.PostID != validID {
		t.Fatalf("embedded: %#v", embedded)
	}
	data, _ := json.Marshal(embedded)
	if strings.Contains(string(data), `"embed"`) {
		t.Fatalf("embedded post holds an embed: %s", data)
	}
}

func TestCreateQuoteRequest(t *testing.T) {
	t.Parallel()
	request := CreateQuoteRequest{
		Target: QuoteTarget{
			Type: QuoteTargetTimelinePost, Owner: "  " + ownerAddress + "  ", PostID: validID,
		},
		Body: "  agreed  ",
	}
	original := request
	copyRequest := request
	copyRequest.Normalize()
	if request != original || copyRequest.Body != "agreed" ||
		string(copyRequest.Target.Owner) != ownerAddress || len(copyRequest.Validate()) != 0 {
		t.Fatalf("normalize: %#v %v", copyRequest, copyRequest.Validate())
	}
	opening := CreateQuoteRequest{
		Target: QuoteTarget{Type: QuoteTargetOpening, OrgDomain: "  Example.COM ", OpeningNumber: 3},
		Body:   "hiring",
	}
	opening.Normalize()
	if opening.Target.OrgDomain != "example.com" || len(opening.Validate()) != 0 {
		t.Fatalf("opening: %#v %v", opening, opening.Validate())
	}

	bad := CreateQuoteRequest{Body: ""}
	badReply, badQuote := ReplyPolicy("x"), QuotePolicy("x")
	bad.ReplyPolicy, bad.QuotePolicy = &badReply, &badQuote
	want := []string{"target", "body", "reply_policy", "quote_policy"}
	if got := bad.Validate(); !reflect.DeepEqual(got, want) {
		t.Fatalf("bad request: %v", got)
	}
	for _, body := range []string{"", strings.Repeat("a", MaxBodyLength+1), "a\x00"} {
		got := CreateQuoteRequest{Target: timelineTarget(), Body: body}.Validate()
		if !reflect.DeepEqual(got, []string{"body"}) {
			t.Errorf("body %q: %v", body, got)
		}
	}
	ok := CreateQuoteRequest{Target: openingTarget(), Body: strings.Repeat("😀", MaxBodyLength)}
	if got := ok.Validate(); len(got) != 0 {
		t.Fatalf("512 code points refused: %v", got)
	}
}

func TestQuoteListAndDetachRequests(t *testing.T) {
	t.Parallel()
	list := ListQuotesRequest{Owner: "  " + ownerAddress + "  ", PostID: validID}
	list.Normalize()
	if string(list.Owner) != ownerAddress || list.EffectiveLimit() != DefaultLimit ||
		len(list.Validate()) != 0 {
		t.Fatalf("list: %#v %v", list, list.Validate())
	}
	for _, limit := range []int32{1, MaxLimit} {
		if got := (ListQuotesRequest{Owner: ownerAddress, PostID: validID, Limit: &limit}).Validate(); len(got) != 0 {
			t.Errorf("limit %d: %v", limit, got)
		}
	}
	for _, limit := range []int32{0, MaxLimit + 1} {
		got := ListQuotesRequest{Owner: ownerAddress, PostID: validID, Limit: &limit}.Validate()
		if !reflect.DeepEqual(got, []string{"limit"}) {
			t.Errorf("limit %d: %v", limit, got)
		}
	}
	key := common.PaginationKey("")
	got := ListQuotesRequest{Owner: "api", PostID: "x", PaginationKey: &key}.Validate()
	if !reflect.DeepEqual(got, []string{"owner", "post_id", "pagination_key"}) {
		t.Fatalf("bad list: %v", got)
	}

	detach := DetachQuoteRequest{PostID: validID, Quoter: "  " + ownerAddress + "  ", QuotePostID: validID}
	detach.Normalize()
	if string(detach.Quoter) != ownerAddress || len(detach.Validate()) != 0 {
		t.Fatalf("detach: %v", detach.Validate())
	}
	got = DetachQuoteRequest{Quoter: "BAD address"}.Validate()
	if !reflect.DeepEqual(got, []string{"post_id", "quoter", "quote_post_id"}) {
		t.Fatalf("bad detach: %v", got)
	}
}

func TestMeshQuoteRequests(t *testing.T) {
	t.Parallel()
	target := MeshReadQuoteTargetRequest{
		TargetPostID: validID, ViewerHubUserDID: viewerDID, ViewerHandle: viewerHandle,
	}
	if got := target.Validate(); len(got) != 0 {
		t.Fatalf("target: %v", got)
	}
	want := []string{"target_post_id", "viewer_hub_user_did", "viewer_handle"}
	if got := (MeshReadQuoteTargetRequest{TargetPostID: "x"}).Validate(); !reflect.DeepEqual(got, want) {
		t.Fatalf("bad target: %v", got)
	}

	item := MeshEmbedReference{TargetPostID: validID, QuotePostID: validID, QuoterHubUserDID: viewerDID}
	embeds := func(items []MeshEmbedReference) []string {
		return MeshReadEmbedsRequest{
			ViewerHubUserDID: viewerDID, ViewerHandle: viewerHandle, Items: items,
		}.Validate()
	}
	for _, count := range []int{1, MaxGetMany} {
		if got := embeds(repeat(item, count)); len(got) != 0 {
			t.Errorf("%d items: %v", count, got)
		}
	}
	for _, count := range []int{0, MaxGetMany + 1} {
		if got := embeds(repeat(item, count)); !reflect.DeepEqual(got, []string{"items"}) {
			t.Errorf("%d items: %v", count, got)
		}
	}
	for _, broken := range []MeshEmbedReference{
		{TargetPostID: "x", QuotePostID: validID, QuoterHubUserDID: viewerDID},
		{TargetPostID: validID, QuotePostID: "x", QuoterHubUserDID: viewerDID},
		{TargetPostID: validID, QuotePostID: validID, QuoterHubUserDID: "x"},
	} {
		if got := embeds([]MeshEmbedReference{broken}); !reflect.DeepEqual(got, []string{"items"}) {
			t.Errorf("%#v: %v", broken, got)
		}
	}

	list := MeshListQuotesRequest{PostID: validID, ViewerHubUserDID: viewerDID, ViewerHandle: viewerHandle}
	if got := list.Validate(); len(got) != 0 || list.EffectiveLimit() != DefaultLimit {
		t.Fatalf("list: %v", got)
	}
	limit := int32(51)
	bad := MeshListQuotesRequest{PostID: "x", Limit: &limit}
	want = []string{"post_id", "viewer_hub_user_did", "viewer_handle", "limit"}
	if got := bad.Validate(); !reflect.DeepEqual(got, want) {
		t.Fatalf("bad list: %v", got)
	}
}

func repeat(item MeshEmbedReference, count int) []MeshEmbedReference {
	items := make([]MeshEmbedReference, count)
	for i := range items {
		items[i] = item
	}
	return items
}
