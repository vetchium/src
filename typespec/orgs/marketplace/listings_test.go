package marketplace

import (
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/hiring"
)

func validContent() ListingContent {
	return ListingContent{
		Headline: "Structured interviews", Description: "We interview.",
		Service:   ServiceArea{Countries: []common.CountryCode{"IN", "SG"}},
		Languages: []common.LanguageTag{"en"},
	}
}

func backgroundContent() ListingContent {
	content := validContent()
	disclosure := "We verify what you tell us."
	content.CheckTypes = []hiring.CheckType{hiring.IdentityCheck, hiring.EducationCheck}
	content.ConsentDisclosure = &disclosure
	return content
}

func TestCreateListingNormalizesWithoutMutatingTheCaller(t *testing.T) {
	t.Parallel()
	price := " 100 per hour "
	countries := []common.CountryCode{" in "}
	request := CreateListingRequest{Capability: Interviewing, ListingContent: ListingContent{
		Headline: " H ", Description: " D ", IndicativePrice: &price,
		Service:   ServiceArea{Countries: countries},
		Languages: []common.LanguageTag{" en "},
	}}
	request.Normalize()
	if request.Headline != "H" || request.Description != "D" ||
		*request.IndicativePrice != "100 per hour" ||
		request.Service.Countries[0] != "IN" || request.Languages[0] != "en" {
		t.Fatalf("unexpected normalized request: %+v", request)
	}
	if countries[0] != " in " || price != " 100 per hour " {
		t.Fatal("normalization mutated the caller's values")
	}
}

func TestListingContentValidation(t *testing.T) {
	t.Parallel()
	with := func(edit func(*ListingContent)) ListingContent {
		content := validContent()
		edit(&content)
		return content
	}
	text := func(n int) *string { value := strings.Repeat("é", n); return &value }
	tests := []struct {
		name       string
		capability Capability
		content    ListingContent
		want       []string
	}{
		{"valid", Interviewing, validContent(), []string{}},
		{"valid background check", BackgroundCheck, backgroundContent(), []string{}},
		{"worldwide", Sourcing, with(func(c *ListingContent) {
			c.Service = ServiceArea{Worldwide: true, Countries: []common.CountryCode{}}
		}), []string{}},
		{"headline 200", Sourcing, with(func(c *ListingContent) { c.Headline = *text(200) }), []string{}},
		{"headline 201", Sourcing, with(func(c *ListingContent) { c.Headline = *text(201) }), []string{"headline"}},
		{"blank headline", Sourcing, with(func(c *ListingContent) { c.Headline = "" }), []string{"headline"}},
		{"description 10000", Sourcing, with(func(c *ListingContent) { c.Description = *text(10000) }), []string{}},
		{"description 10001", Sourcing, with(func(c *ListingContent) { c.Description = *text(10001) }), []string{"description"}},
		{"worldwide with countries", Sourcing, with(func(c *ListingContent) { c.Service.Worldwide = true }), []string{"service.countries"}},
		{"no countries", Sourcing, with(func(c *ListingContent) { c.Service.Countries = nil }), []string{"service.countries"}},
		{"duplicate country", Sourcing, with(func(c *ListingContent) {
			c.Service.Countries = []common.CountryCode{"IN", "IN"}
		}), []string{"service.countries"}},
		{"unknown country", Sourcing, with(func(c *ListingContent) {
			c.Service.Countries = []common.CountryCode{"ZZ"}
		}), []string{"service.countries"}},
		{"missing languages", Sourcing, with(func(c *ListingContent) { c.Languages = nil }), []string{"languages"}},
		{"unknown language", Sourcing, with(func(c *ListingContent) {
			c.Languages = []common.LanguageTag{"xx-nope"}
		}), []string{"languages"}},
		{"price 500", Sourcing, with(func(c *ListingContent) { c.IndicativePrice = text(500) }), []string{}},
		{"price 501", Sourcing, with(func(c *ListingContent) { c.IndicativePrice = text(501) }), []string{"indicative_price"}},
		{"blank price", Sourcing, with(func(c *ListingContent) { c.IndicativePrice = text(0) }), []string{"indicative_price"}},
		{"check types on interviewing", Interviewing, with(func(c *ListingContent) {
			c.CheckTypes = []hiring.CheckType{hiring.IdentityCheck}
		}), []string{"check_types"}},
		{"disclosure on assessment", Assessment, with(func(c *ListingContent) { c.ConsentDisclosure = text(1) }), []string{"consent_disclosure"}},
		{"background check needs both", BackgroundCheck, validContent(), []string{"check_types", "consent_disclosure"}},
		{"unknown check type", BackgroundCheck, func() ListingContent {
			c := backgroundContent()
			c.CheckTypes = []hiring.CheckType{"dna"}
			return c
		}(), []string{"check_types"}},
		{"duplicate check type", BackgroundCheck, func() ListingContent {
			c := backgroundContent()
			c.CheckTypes = []hiring.CheckType{hiring.IdentityCheck, hiring.IdentityCheck}
			return c
		}(), []string{"check_types"}},
		{"disclosure 5000", BackgroundCheck, func() ListingContent {
			c := backgroundContent()
			c.ConsentDisclosure = text(5000)
			return c
		}(), []string{}},
		{"NUL in headline", Sourcing, with(func(c *ListingContent) { c.Headline = "a\x00b" }), []string{"headline"}},
		{"NUL in description", Sourcing, with(func(c *ListingContent) { c.Description = "a\x00b" }), []string{"description"}},
		{"NUL in price", Sourcing, with(func(c *ListingContent) { value := "a\x00"; c.IndicativePrice = &value }), []string{"indicative_price"}},
		{"NUL in disclosure", BackgroundCheck, func() ListingContent {
			c := backgroundContent()
			value := "a\x00"
			c.ConsentDisclosure = &value
			return c
		}(), []string{"consent_disclosure"}},
		{"disclosure 5001", BackgroundCheck, func() ListingContent {
			c := backgroundContent()
			c.ConsentDisclosure = text(5001)
			return c
		}(), []string{"consent_disclosure"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := CreateListingRequest{Capability: test.capability, ListingContent: test.content}.Validate()
			if !slices.Equal(got, test.want) {
				t.Fatalf("fields = %v, want %v", got, test.want)
			}
		})
	}
}

func TestListingRequestsValidateCapabilityAndVersion(t *testing.T) {
	t.Parallel()
	if got := (CreateListingRequest{Capability: "plumbing", ListingContent: validContent()}).Validate(); !slices.Equal(got, []string{"capability"}) {
		t.Fatalf("create fields = %v", got)
	}
	update := UpdateListingRequest{Capability: Sourcing, Version: 0, ListingContent: validContent()}
	if got := update.Validate(); !slices.Equal(got, []string{"version"}) {
		t.Fatalf("update fields = %v", got)
	}
	update.Version = 1
	if got := update.Validate(); len(got) != 0 {
		t.Fatalf("update fields = %v", got)
	}
	if got := (ListingTarget{Capability: "x", Version: -1}).Validate(); !slices.Equal(got, []string{"capability", "version"}) {
		t.Fatalf("target fields = %v", got)
	}
}

func TestSearchListingsRequestValidation(t *testing.T) {
	t.Parallel()
	country, badCountry := common.CountryCode("IN"), common.CountryCode("in")
	language := common.LanguageTag("en")
	one, fifty, fiftyOne, zero := int32(1), int32(50), int32(51), int32(0)
	query := func(value string) *string { return &value }
	tests := []struct {
		name string
		in   SearchListingsRequest
		want []string
	}{
		{"capability only", SearchListingsRequest{Capability: Sourcing}, []string{}},
		{"unknown capability", SearchListingsRequest{Capability: "x"}, []string{"capability"}},
		{"filters", SearchListingsRequest{Capability: Sourcing, Country: &country, Language: &language, Query: query("ab"), Limit: &fifty}, []string{}},
		{"lowercase country", SearchListingsRequest{Capability: Sourcing, Country: &badCountry}, []string{"country"}},
		{"one character query", SearchListingsRequest{Capability: Sourcing, Query: query("a")}, []string{"query"}},
		{"NUL in query", SearchListingsRequest{Capability: Sourcing, Query: query("a\x00b")}, []string{"query"}},
		{"limit zero", SearchListingsRequest{Capability: Sourcing, Limit: &zero}, []string{"limit"}},
		{"limit 51", SearchListingsRequest{Capability: Sourcing, Limit: &fiftyOne}, []string{"limit"}},
		{"limit 1", SearchListingsRequest{Capability: Sourcing, Limit: &one}, []string{}},
		{"check types for background check", SearchListingsRequest{Capability: BackgroundCheck, CheckTypes: []hiring.CheckType{hiring.CriminalCheck}}, []string{}},
		{"check types elsewhere", SearchListingsRequest{Capability: Interviewing, CheckTypes: []hiring.CheckType{hiring.CriminalCheck}}, []string{"check_types"}},
		{"empty check types", SearchListingsRequest{Capability: BackgroundCheck, CheckTypes: []hiring.CheckType{}}, []string{"check_types"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := test.in.Validate(); !slices.Equal(got, test.want) {
				t.Fatalf("fields = %v, want %v", got, test.want)
			}
		})
	}
	if (SearchListingsRequest{}).EffectiveLimit() != MaxSearchPage {
		t.Fatal("default limit must be the page maximum")
	}
}

func TestGetListingRequestValidation(t *testing.T) {
	t.Parallel()
	request := GetListingRequest{Domain: " ACME.test ", Capability: Sourcing}
	request.Normalize()
	if request.Domain != "acme.test" || len(request.Validate()) != 0 {
		t.Fatalf("unexpected request %+v: %v", request, request.Validate())
	}
	if got := (GetListingRequest{Domain: "nope", Capability: "x"}).Validate(); !slices.Equal(got, []string{"domain", "capability"}) {
		t.Fatalf("fields = %v", got)
	}
}

func TestListingStates(t *testing.T) {
	t.Parallel()
	if !IsListingState(ListedListing) || IsListingState("hidden") || len(ListingStates()) != 3 {
		t.Fatal("unexpected Listing states")
	}
}
