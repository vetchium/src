package posts

import (
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/common"
	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	postsspec "github.com/vetchium/src/typespec/hub/posts"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
)

const (
	quoteID  = "0123456789abcdefghij0123456789abcdefghij"
	targetID = "1123456789abcdefghij0123456789abcdefghij"
	didOne   = "0194f3a0-0000-7000-8000-000000000001"
	didTwo   = "0194f3a0-0000-7000-8000-000000000002"
	didThree = "0194f3a0-0000-7000-8000-000000000003"
)

func timelineQuote(id, quoter, targetOwner string) postsspec.Post {
	return postsspec.Post{
		PostID: postsspec.PostID(id), Kind: postsspec.KindQuote,
		Owner: postsspec.PostOwner{Handle: hubspec.HubHandle("quoter-" + quoter)},
		QuoteTarget: &postsspec.QuoteTarget{
			Type:  postsspec.QuoteTargetTimelinePost,
			Owner: profilespec.ProfileAddress(targetOwner), PostID: targetID,
		},
	}
}

func TestPlanEmbedsGroupsByTargetOwnerTenant(t *testing.T) {
	t.Parallel()
	posts := []postsspec.Post{
		timelineQuote(quoteID, "a", "owner-sgp"),
		timelineQuote(targetID, "a", "owner-deu"),
		timelineQuote("2123456789abcdefghij0123456789abcdefghij", "a", "owner-sgp"),
		{PostID: "plain", Kind: postsspec.KindPost},
		{
			PostID: "opening", Kind: postsspec.KindQuote,
			QuoteTarget: &postsspec.QuoteTarget{
				Type: postsspec.QuoteTargetOpening, OrgDomain: "example.com",
				OpeningNumber: 7,
			},
		},
		timelineQuote("3123456789abcdefghij0123456789abcdefghij", "a", "owner-lost"),
	}
	resolved := map[string]userLocation{
		"quoter-a":  {did: didOne, tenant: "sgp"},
		"owner-sgp": {did: didTwo, tenant: "sgp"},
		"owner-deu": {did: didThree, tenant: "deu"},
	}
	plan := planEmbeds(posts, resolved)
	got := map[directoryspec.TenantID][]int{}
	for tenant, refs := range plan.byTenant {
		for _, ref := range refs {
			got[tenant] = append(got[tenant], ref.index)
		}
	}
	want := map[directoryspec.TenantID][]int{"sgp": {0, 2}, "deu": {1}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("groups = %v, want %v", got, want)
	}
	first := plan.byTenant["sgp"][0].item
	if first.OwnerHubUserDID != didTwo || first.QuoterHubUserDID != didOne ||
		first.QuotePostID != quoteID || first.TargetPostID != targetID {
		t.Fatalf("item = %+v", first)
	}
	if !reflect.DeepEqual(plan.openings, map[openingKey][]int{
		{"example.com", 7}: {4},
	}) {
		t.Fatalf("openings = %v", plan.openings)
	}
}

func TestHandlesToResolveSkipsKnownHandles(t *testing.T) {
	t.Parallel()
	posts := []postsspec.Post{
		timelineQuote(quoteID, "a", "owner-sgp"),
		timelineQuote(targetID, "b", "owner-sgp"),
		{PostID: "plain", Kind: postsspec.KindPost},
	}
	need := handlesToResolve(posts, map[string]userLocation{
		"quoter-a": {},
	})
	var got []string
	for handle := range need {
		got = append(got, handle)
	}
	sort.Strings(got)
	want := []string{"owner-sgp", "quoter-b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("need = %v, want %v", got, want)
	}
}

func TestGroupQuoteRefsGroupsByQuoterTenant(t *testing.T) {
	t.Parallel()
	refs := []postsspec.MeshQuoteReference{
		{QuoterHubUserDID: didOne, QuoterTenantID: "sgp", QuotePostID: quoteID},
		{QuoterHubUserDID: didTwo, QuoterTenantID: "deu", QuotePostID: targetID},
		{QuoterHubUserDID: didThree, QuoterTenantID: "sgp", QuotePostID: "x"},
	}
	groups := groupQuoteRefs(refs)
	if len(groups) != 2 || len(groups["sgp"]) != 2 || len(groups["deu"]) != 1 {
		t.Fatalf("groups = %v", groups)
	}
	if groups["deu"][0].OwnerHubUserDID != didTwo || groups["deu"][0].PostID != targetID {
		t.Fatalf("deu = %+v", groups["deu"])
	}
}

func TestQuotesAcceptsOnlyAQuoteOfThePost(t *testing.T) {
	t.Parallel()
	good := timelineQuote(quoteID, "a", "owner")
	if !quotes(good, targetID) {
		t.Fatal("a quote of the post was refused")
	}
	if quotes(good, quoteID) {
		t.Fatal("a quote of another post was accepted")
	}
	plain := good
	plain.Kind = postsspec.KindPost
	if quotes(plain, targetID) {
		t.Fatal("a plain post was accepted")
	}
}

func TestSummarizeKeepsOnlyAPublishedOpening(t *testing.T) {
	t.Parallel()
	title := "Engineer"
	country := common.CountryCode("SG")
	arrangement := common.OpeningRemote
	employment := common.OpeningFullTime
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	result := openingsspec.GetOrgOpeningResponse{
		Org: openingsspec.PublicOrg{Domain: "example.com", DisplayName: "Example"},
		Opening: openingsspec.PublicOpening{
			OpeningNumber: 7, State: openingsspec.Published,
			FirstPublishedAt: &at,
			Content: &common.OpeningContent{
				Title: &title, EmployingCountry: &country,
				WorkArrangement: &arrangement, EmploymentType: &employment,
			},
		},
	}
	embedded, ok := summarize(result)
	if !ok || embedded.Opening.Title != title || embedded.Opening.OpeningNumber != 7 ||
		embedded.Org.Domain != "example.com" {
		t.Fatalf("summary = %+v, %v", embedded, ok)
	}
	closed := result
	closed.Opening.State = openingsspec.NotAccepting
	if _, ok := summarize(closed); ok {
		t.Fatal("an Opening that is not published was embedded")
	}
	bare := result
	bare.Opening.Content = nil
	if _, ok := summarize(bare); ok {
		t.Fatal("an Opening without content was embedded")
	}
}
