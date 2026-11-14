package openings

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
)

func TestSearchOpeningsRequestValidate(t *testing.T) {
	t.Parallel()
	astral := strings.Repeat("😀", 200)
	tests := []struct {
		name    string
		request SearchOpeningsRequest
		want    []string
	}{
		{"empty", SearchOpeningsRequest{}, []string{}},
		{"keyword 1", SearchOpeningsRequest{Keyword: new(OpeningSearchKeyword("g"))}, []string{"keyword"}},
		{"keyword 2", SearchOpeningsRequest{Keyword: new(OpeningSearchKeyword("go"))}, []string{}},
		{"keyword 200 code points", SearchOpeningsRequest{Keyword: new(OpeningSearchKeyword(astral))}, []string{}},
		{"keyword 201 code points", SearchOpeningsRequest{Keyword: new(OpeningSearchKeyword(astral + "a"))}, []string{"keyword"}},
		{"org domain", SearchOpeningsRequest{OrgDomain: new(orgs.OrgDomain("example.com"))}, []string{}},
		{"malformed org domain", SearchOpeningsRequest{OrgDomain: new(orgs.OrgDomain("not a domain"))}, []string{"org_domain"}},
		{"five tags", SearchOpeningsRequest{TagOIDs: []common.OpeningTagOID{"a1", "b1", "c1", "d1", "e1"}}, []string{}},
		{"six tags", SearchOpeningsRequest{TagOIDs: []common.OpeningTagOID{"a1", "b1", "c1", "d1", "e1", "f1"}}, []string{"tag_oids"}},
		{"empty tags", SearchOpeningsRequest{TagOIDs: []common.OpeningTagOID{}}, []string{"tag_oids"}},
		{"repeated tag", SearchOpeningsRequest{TagOIDs: []common.OpeningTagOID{"golang", "golang"}}, []string{"tag_oids.1"}},
		{"malformed tag", SearchOpeningsRequest{TagOIDs: []common.OpeningTagOID{"Go Lang"}}, []string{"tag_oids.0"}},
		{"ten countries", SearchOpeningsRequest{WorkCountries: []common.CountryCode{"DE", "FR", "GB", "IN", "SG", "US", "JP", "CA", "AU", "NL"}}, []string{}},
		{"eleven countries", SearchOpeningsRequest{WorkCountries: []common.CountryCode{"DE", "FR", "GB", "IN", "SG", "US", "JP", "CA", "AU", "NL", "BE"}}, []string{"work_countries"}},
		{"unknown country", SearchOpeningsRequest{WorkCountries: []common.CountryCode{"XX"}}, []string{"work_countries.0"}},
		{"every arrangement", SearchOpeningsRequest{WorkArrangements: []common.OpeningWorkArrangement{common.OpeningOnSite, common.OpeningHybrid, common.OpeningRemote}}, []string{}},
		{"repeated arrangement", SearchOpeningsRequest{WorkArrangements: []common.OpeningWorkArrangement{common.OpeningRemote, common.OpeningRemote}}, []string{"work_arrangements.1"}},
		{"unknown arrangement", SearchOpeningsRequest{WorkArrangements: []common.OpeningWorkArrangement{"office"}}, []string{"work_arrangements.0"}},
		{"every employment type", SearchOpeningsRequest{EmploymentTypes: []common.OpeningEmploymentType{common.OpeningFullTime, common.OpeningPartTime, common.OpeningContract, common.OpeningInternship}}, []string{}},
		{"unknown employment type", SearchOpeningsRequest{EmploymentTypes: []common.OpeningEmploymentType{"gig"}}, []string{"employment_types.0"}},
		{"posted within 7", SearchOpeningsRequest{PostedWithinDays: new(PostedWithinWeek)}, []string{}},
		{"posted within 2", SearchOpeningsRequest{PostedWithinDays: new(OpeningSearchPostedWithinDays(2))}, []string{"posted_within_days"}},
		{"experience 0", SearchOpeningsRequest{ExperienceYears: new(OpeningSearchExperienceYears(0))}, []string{}},
		{"experience 50", SearchOpeningsRequest{ExperienceYears: new(OpeningSearchExperienceYears(50))}, []string{}},
		{"experience -1", SearchOpeningsRequest{ExperienceYears: new(OpeningSearchExperienceYears(-1))}, []string{"experience_years"}},
		{"experience 51", SearchOpeningsRequest{ExperienceYears: new(OpeningSearchExperienceYears(51))}, []string{"experience_years"}},
		{"education", SearchOpeningsRequest{EducationLevel: new(common.OpeningMaster)}, []string{}},
		{"unknown education", SearchOpeningsRequest{EducationLevel: new(common.OpeningEducation("diploma"))}, []string{"education_level"}},
		{"malformed pagination key", SearchOpeningsRequest{PaginationKey: new(common.PaginationKey(""))}, []string{"pagination_key"}},
		{"limit 1", SearchOpeningsRequest{Limit: new(OpeningSearchPageSize(1))}, []string{}},
		{"limit 50", SearchOpeningsRequest{Limit: new(OpeningSearchPageSize(50))}, []string{}},
		{"limit 0", SearchOpeningsRequest{Limit: new(OpeningSearchPageSize(0))}, []string{"limit"}},
		{"limit 51", SearchOpeningsRequest{Limit: new(OpeningSearchPageSize(51))}, []string{"limit"}},
		{"region", SearchOpeningsRequest{Region: new(directory.TenantID("usa1"))}, []string{}},
		{"malformed region", SearchOpeningsRequest{Region: new(directory.TenantID("USA 1"))}, []string{"region"}},
		{
			"several fields at once",
			SearchOpeningsRequest{
				Keyword: new(OpeningSearchKeyword("g")), Limit: new(OpeningSearchPageSize(0)),
				Region: new(directory.TenantID("X")),
			},
			[]string{"keyword", "limit", "region"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := test.request.Validate(); !slices.Equal(got, test.want) {
				t.Fatalf("Validate() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestSearchOpeningsRequestNormalizeKeepsTheOriginal(t *testing.T) {
	t.Parallel()
	keyword := OpeningSearchKeyword("  golang  ")
	domain := orgs.OrgDomain("Example.COM")
	countries := []common.CountryCode{" de ", "fr"}
	original := SearchOpeningsRequest{
		Keyword: &keyword, OrgDomain: &domain, WorkCountries: countries}
	normalized := original
	normalized.Normalize()

	if *normalized.Keyword != "golang" || *normalized.OrgDomain != "example.com" ||
		!slices.Equal(normalized.WorkCountries, []common.CountryCode{"DE", "FR"}) {
		t.Fatalf("Normalize() = %+v", normalized.OpeningSearchQuery)
	}
	if keyword != "  golang  " || domain != "Example.COM" || countries[0] != " de " {
		t.Fatal("Normalize() changed the caller's storage")
	}
	if len(normalized.Validate()) != 0 {
		t.Fatalf("normalized request is invalid: %v", normalized.Validate())
	}
}

func TestOpeningSearchEffectiveLimit(t *testing.T) {
	t.Parallel()
	if got := (OpeningSearchQuery{}).EffectiveLimit(); got != 20 {
		t.Fatalf("default limit = %d, want 20", got)
	}
	if got := (OpeningSearchQuery{Limit: new(OpeningSearchPageSize(7))}).EffectiveLimit(); got != 7 {
		t.Fatalf("limit = %d, want 7", got)
	}
}

func TestSuggestOpeningOrgsRequest(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		request SuggestOpeningOrgsRequest
		want    []string
	}{
		{"query 1", SuggestOpeningOrgsRequest{Query: "a"}, []string{"query"}},
		{"query 2", SuggestOpeningOrgsRequest{Query: "ab"}, []string{}},
		{"query 100 code points", SuggestOpeningOrgsRequest{Query: OrgSuggestionQuery(strings.Repeat("é", 100))}, []string{}},
		{"query 101 code points", SuggestOpeningOrgsRequest{Query: OrgSuggestionQuery(strings.Repeat("é", 101))}, []string{"query"}},
		{"malformed region", SuggestOpeningOrgsRequest{Query: "ab", Region: new(directory.TenantID("1x"))}, []string{"region"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := test.request.Validate(); !slices.Equal(got, test.want) {
				t.Fatalf("Validate() = %v, want %v", got, test.want)
			}
		})
	}

	request := SuggestOpeningOrgsRequest{Query: "  ab "}
	request.Normalize()
	if request.Query != "ab" {
		t.Fatalf("Normalize() query = %q, want %q", request.Query, "ab")
	}
}

func TestRelayRequestsPrefixQueryFields(t *testing.T) {
	t.Parallel()
	search := RelaySearchOpeningsRequest{
		TenantID: "Bad",
		Query:    OpeningSearchQuery{Keyword: new(OpeningSearchKeyword("g"))},
	}
	if got, want := search.Validate(), []string{"tenant_id", "query.keyword"}; !slices.Equal(got, want) {
		t.Fatalf("search Validate() = %v, want %v", got, want)
	}
	suggest := RelaySuggestOpeningOrgsRequest{TenantID: "usa1", Query: SuggestOpeningOrgsQuery{Query: "a"}}
	if got, want := suggest.Validate(), []string{"query.query"}; !slices.Equal(got, want) {
		t.Fatalf("suggest Validate() = %v, want %v", got, want)
	}
}

func TestSearchResponsesEncodeEmptyListsAsArrays(t *testing.T) {
	t.Parallel()
	for _, value := range []any{SearchOpeningsResponse{}, SuggestOpeningOrgsResponse{}} {
		body, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), ":[]") || strings.Contains(string(body), "null") {
			t.Fatalf("empty response = %s", body)
		}
	}
}

func TestSearchOpeningsRequestDecodesFlatFields(t *testing.T) {
	t.Parallel()
	var request SearchOpeningsRequest
	body := `{"keyword":"go","region":"usa1","posted_within_days":7,"limit":5}`
	if err := json.Unmarshal([]byte(body), &request); err != nil {
		t.Fatal(err)
	}
	if request.Keyword == nil || *request.Keyword != "go" || request.Region == nil ||
		*request.Region != "usa1" || *request.PostedWithinDays != PostedWithinWeek ||
		request.EffectiveLimit() != 5 {
		t.Fatalf("decoded %+v", request)
	}
}
