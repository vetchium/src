package openingsearch

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/orgs"

	"backend/internal/db/sqlc"
)

type queryStub struct {
	searchRows  []sqlc.SearchOpeningsRow
	searchArg   sqlc.SearchOpeningsParams
	suggestRows []sqlc.SuggestOpeningOrgsRow
	suggestArg  sqlc.SuggestOpeningOrgsParams
	calls       int
}

func (s *queryStub) SearchOpenings(
	_ context.Context, arg sqlc.SearchOpeningsParams,
) ([]sqlc.SearchOpeningsRow, error) {
	s.calls++
	s.searchArg = arg
	return s.searchRows, nil
}

func (s *queryStub) SuggestOpeningOrgs(
	_ context.Context, arg sqlc.SuggestOpeningOrgsParams,
) ([]sqlc.SuggestOpeningOrgsRow, error) {
	s.calls++
	s.suggestArg = arg
	return s.suggestRows, nil
}

type logoStub struct{ calls int }

func (s *logoStub) SignLogoGet(_ context.Context, id pgtype.UUID) (string, error) {
	s.calls++
	return fmt.Sprintf("https://media.example/%x", id.Bytes[0]), nil
}

func searchRow(domain string, logo byte, number int, matched int32) sqlc.SearchOpeningsRow {
	row := sqlc.SearchOpeningsRow{
		MatchedTags: matched, Domain: domain, DisplayName: "Org " + domain,
		Country: "SG",
		Summary: fmt.Appendf(nil, `{"opening_number":%d,"title":"Opening",`+
			`"employing_country":"SG","work_arrangement":"hybrid",`+
			`"employment_type":"full_time",`+
			`"first_published_at":"2026-10-%02dT01:00:00.123456Z","tags":["golang"],`+
			`"salary":{"currency":"SGD","min":1,"max":2,"period":"month"}}`,
			number, number),
	}
	if logo != 0 {
		row.LogoObjectID = pgtype.UUID{Bytes: [16]byte{logo}, Valid: true}
	}
	return row
}

func fullQuery() openingsspec.OpeningSearchQuery {
	keyword := openingsspec.OpeningSearchKeyword("Engineer")
	domain := orgs.OrgDomain("example.com")
	posted := openingsspec.PostedWithinWeek
	years := openingsspec.OpeningSearchExperienceYears(0)
	education := common.OpeningBachelor
	salary := true
	limit := openingsspec.OpeningSearchPageSize(2)
	return openingsspec.OpeningSearchQuery{
		Keyword: &keyword, OrgDomain: &domain,
		TagOIDs:          []common.OpeningTagOID{"rust", "golang"},
		WorkCountries:    []common.CountryCode{"SG", "IN"},
		WorkArrangements: []common.OpeningWorkArrangement{common.OpeningRemote, common.OpeningHybrid},
		EmploymentTypes:  []common.OpeningEmploymentType{common.OpeningPartTime, common.OpeningFullTime},
		PostedWithinDays: &posted, ExperienceYears: &years,
		EducationLevel: &education, SalaryDisclosed: &salary, Limit: &limit,
	}
}

func TestSearchPassesNormalizedFiltersAndTrimsPage(t *testing.T) {
	stub := &queryStub{searchRows: []sqlc.SearchOpeningsRow{
		searchRow("b.example", 0, 3, 2), searchRow("a.example", 0, 2, 1),
		searchRow("a.example", 0, 1, 1),
	}}
	reader := Reader{Queries: stub, TenantID: "sgp"}
	response, err := reader.Search(context.Background(), fullQuery())
	if err != nil || len(response.Openings) != 2 || response.NextPaginationKey == nil {
		t.Fatalf("first page = %+v, %v", response, err)
	}
	arg := stub.searchArg
	if arg.PageSize != 3 || arg.CursorAt.Valid || arg.Keyword.String != "Engineer" ||
		arg.OrgDomain.String != "example.com" ||
		!slices.Equal(arg.TagOids, []string{"golang", "rust"}) ||
		!slices.Equal(arg.WorkCountries, []string{"IN", "SG"}) ||
		!slices.Equal(arg.WorkArrangements, []string{"hybrid", "remote"}) ||
		!slices.Equal(arg.EmploymentTypes, []string{"full_time", "part_time"}) ||
		arg.PostedWithinDays != (pgtype.Int4{Int32: 7, Valid: true}) ||
		arg.ExperienceYears != (pgtype.Int4{Int32: 0, Valid: true}) ||
		arg.EducationLevel.String != "bachelor" || !arg.SalaryDisclosed {
		t.Fatalf("query parameters = %+v", arg)
	}
	second := response.Openings[1]
	if second.Org.Domain != "a.example" || second.Opening.OpeningNumber != 2 ||
		second.Opening.Salary == nil || len(second.Opening.Tags) != 1 {
		t.Fatalf("second result = %+v", second)
	}

	query := fullQuery()
	query.PaginationKey = response.NextPaginationKey
	if _, err := reader.Search(context.Background(), query); err != nil {
		t.Fatalf("next page: %v", err)
	}
	arg = stub.searchArg
	if !arg.CursorAt.Valid || !arg.CursorAt.Time.Equal(second.Opening.FirstPublishedAt) ||
		arg.CursorMatchedTags.Int32 != 1 || arg.CursorDomain.String != "a.example" ||
		arg.CursorNumber.Int32 != 2 {
		t.Fatalf("cursor parameters = %+v", arg)
	}
}

func TestSearchKeyBindsEveryFilterAndTenant(t *testing.T) {
	stub := &queryStub{searchRows: []sqlc.SearchOpeningsRow{
		searchRow("a.example", 0, 3, 1), searchRow("a.example", 0, 2, 1),
		searchRow("a.example", 0, 1, 1),
	}}
	reader := Reader{Queries: stub, TenantID: "sgp"}
	first, err := reader.Search(context.Background(), fullQuery())
	if err != nil || first.NextPaginationKey == nil {
		t.Fatalf("first page = %+v, %v", first, err)
	}
	reordered := fullQuery()
	slices.Reverse(reordered.TagOIDs)
	slices.Reverse(reordered.WorkCountries)
	upper := openingsspec.OpeningSearchKeyword("ENGINEER")
	reordered.Keyword = &upper
	reordered.PaginationKey = first.NextPaginationKey
	if _, err := reader.Search(context.Background(), reordered); err != nil {
		t.Fatalf("equivalent query rejected: %v", err)
	}

	otherKeyword := openingsspec.OpeningSearchKeyword("designer")
	otherDomain := orgs.OrgDomain("other.example")
	otherPosted := openingsspec.PostedWithinMonth
	otherYears := openingsspec.OpeningSearchExperienceYears(3)
	otherEducation := common.OpeningMaster
	noSalary := false
	changes := map[string]func(*openingsspec.OpeningSearchQuery){
		"keyword":    func(q *openingsspec.OpeningSearchQuery) { q.Keyword = &otherKeyword },
		"no keyword": func(q *openingsspec.OpeningSearchQuery) { q.Keyword = nil },
		"org domain": func(q *openingsspec.OpeningSearchQuery) { q.OrgDomain = &otherDomain },
		"tags":       func(q *openingsspec.OpeningSearchQuery) { q.TagOIDs = q.TagOIDs[:1] },
		"countries":  func(q *openingsspec.OpeningSearchQuery) { q.WorkCountries = nil },
		"arrangements": func(q *openingsspec.OpeningSearchQuery) {
			q.WorkArrangements = []common.OpeningWorkArrangement{common.OpeningOnSite}
		},
		"employment types": func(q *openingsspec.OpeningSearchQuery) {
			q.EmploymentTypes = []common.OpeningEmploymentType{common.OpeningContract}
		},
		"posted":     func(q *openingsspec.OpeningSearchQuery) { q.PostedWithinDays = &otherPosted },
		"experience": func(q *openingsspec.OpeningSearchQuery) { q.ExperienceYears = &otherYears },
		"no experience": func(q *openingsspec.OpeningSearchQuery) {
			q.ExperienceYears = nil
		},
		"education": func(q *openingsspec.OpeningSearchQuery) { q.EducationLevel = &otherEducation },
		"salary":    func(q *openingsspec.OpeningSearchQuery) { q.SalaryDisclosed = &noSalary },
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			stub := &queryStub{}
			query := fullQuery()
			change(&query)
			query.PaginationKey = first.NextPaginationKey
			_, err := Reader{Queries: stub, TenantID: "sgp"}.Search(context.Background(), query)
			if !errors.Is(err, ErrInvalidPaginationKey) || stub.calls != 0 {
				t.Fatalf("changed %s: error %v, %d queries", name, err, stub.calls)
			}
		})
	}

	t.Run("tenant", func(t *testing.T) {
		stub := &queryStub{}
		query := fullQuery()
		query.PaginationKey = first.NextPaginationKey
		_, err := Reader{Queries: stub, TenantID: "usa1"}.Search(context.Background(), query)
		if !errors.Is(err, ErrInvalidPaginationKey) || stub.calls != 0 {
			t.Fatalf("other tenant: error %v, %d queries", err, stub.calls)
		}
	})
	t.Run("malformed", func(t *testing.T) {
		stub := &queryStub{}
		query := fullQuery()
		key := common.PaginationKey("bm90LWpzb24")
		query.PaginationKey = &key
		_, err := Reader{Queries: stub, TenantID: "sgp"}.Search(context.Background(), query)
		if !errors.Is(err, ErrInvalidPaginationKey) || stub.calls != 0 {
			t.Fatalf("malformed key: error %v, %d queries", err, stub.calls)
		}
	})
}

func TestSearchLastPageHasNoKey(t *testing.T) {
	stub := &queryStub{searchRows: []sqlc.SearchOpeningsRow{
		searchRow("a.example", 0, 2, 0), searchRow("a.example", 0, 1, 0),
	}}
	limit := openingsspec.OpeningSearchPageSize(2)
	response, err := Reader{Queries: stub, TenantID: "sgp"}.Search(
		context.Background(), openingsspec.OpeningSearchQuery{Limit: &limit})
	if err != nil || len(response.Openings) != 2 || response.NextPaginationKey != nil {
		t.Fatalf("last page = %+v, %v", response, err)
	}
	if stub.searchArg.TagOids != nil || stub.searchArg.Keyword.Valid ||
		stub.searchArg.ExperienceYears.Valid || stub.searchArg.SalaryDisclosed {
		t.Fatalf("unfiltered parameters = %+v", stub.searchArg)
	}
}

func TestSearchSignsEachOrgLogoOnce(t *testing.T) {
	stub := &queryStub{searchRows: []sqlc.SearchOpeningsRow{
		searchRow("a.example", 1, 4, 0), searchRow("b.example", 2, 3, 0),
		searchRow("a.example", 1, 2, 0), searchRow("c.example", 0, 1, 0),
	}}
	logos := &logoStub{}
	response, err := Reader{Queries: stub, Logos: logos, TenantID: "sgp"}.Search(
		context.Background(), openingsspec.OpeningSearchQuery{})
	if err != nil || len(response.Openings) != 4 || logos.calls != 2 {
		t.Fatalf("search = %+v, %v, %d signatures", response, err, logos.calls)
	}
	first, third := response.Openings[0].Org, response.Openings[2].Org
	if first.LogoURL == nil || third.LogoURL == nil || *first.LogoURL != *third.LogoURL ||
		response.Openings[3].Org.LogoURL != nil {
		t.Fatalf("logo URLs = %+v", response.Openings)
	}
}

func TestSuggestOrgsSignsLogosAndCapsResults(t *testing.T) {
	stub := &queryStub{suggestRows: []sqlc.SuggestOpeningOrgsRow{
		{Domain: "a.example", DisplayName: "Alpha", Country: "SG",
			LogoObjectID: pgtype.UUID{Bytes: [16]byte{1}, Valid: true}},
		{Domain: "b.example", DisplayName: "Beta", Country: "IN"},
	}}
	logos := &logoStub{}
	response, err := Reader{Queries: stub, Logos: logos, TenantID: "sgp"}.SuggestOrgs(
		context.Background(), openingsspec.SuggestOpeningOrgsQuery{Query: "al"})
	if err != nil || len(response.Orgs) != 2 || logos.calls != 1 ||
		response.Orgs[0].LogoURL == nil || response.Orgs[1].LogoURL != nil ||
		response.Orgs[1].Country != "IN" {
		t.Fatalf("suggestions = %+v, %v", response, err)
	}
	if stub.suggestArg.Query != "al" ||
		stub.suggestArg.MaxOrgs != openingsspec.MaxOpeningOrgSuggestions {
		t.Fatalf("suggestion parameters = %+v", stub.suggestArg)
	}
}

func TestEmptyResultsEncodeAsEmptyLists(t *testing.T) {
	reader := Reader{Queries: &queryStub{}, TenantID: "sgp"}
	search, err := reader.Search(context.Background(), openingsspec.OpeningSearchQuery{})
	if err != nil {
		t.Fatal(err)
	}
	suggestions, err := reader.SuggestOrgs(context.Background(),
		openingsspec.SuggestOpeningOrgsQuery{Query: "zz"})
	if err != nil {
		t.Fatal(err)
	}
	for _, check := range []struct {
		value any
		want  string
	}{
		{search, `{"openings":[]}`}, {suggestions, `{"orgs":[]}`},
	} {
		data, err := json.Marshal(check.value)
		if err != nil || string(data) != check.want {
			t.Fatalf("encoded = %s, %v; want %s", data, err, check.want)
		}
	}
}

func matchQuery(text string) openingsspec.OpeningSearchQuery {
	limit := openingsspec.OpeningSearchPageSize(2)
	ideal := hub.IdealJob(text)
	return openingsspec.OpeningSearchQuery{
		OpeningSearchFilters: openingsspec.OpeningSearchFilters{Limit: &limit},
		Sort:                 new(openingsspec.SortIdealJobMatch), IdealJobText: &ideal,
	}
}

func rankedRows() []sqlc.SearchOpeningsRow {
	rows := []sqlc.SearchOpeningsRow{
		searchRow("a.example", 0, 3, 0), searchRow("a.example", 0, 2, 0),
		searchRow("a.example", 0, 1, 0),
	}
	rows[0].Rank, rows[1].Rank, rows[2].Rank = 0.6079271, 0.2431708, 0.1
	return rows
}

func TestSearchMatchPassesTextAndKeepsRankInKey(t *testing.T) {
	stub := &queryStub{searchRows: rankedRows()}
	reader := Reader{Queries: stub, TenantID: "sgp"}
	const text = "Go backend engineer"
	first, err := reader.Search(context.Background(), matchQuery(text))
	if err != nil || first.NextPaginationKey == nil {
		t.Fatalf("first page = %+v, %v", first, err)
	}
	if stub.searchArg.IdealJobText != (pgtype.Text{String: text, Valid: true}) ||
		stub.searchArg.CursorRank.Valid {
		t.Fatalf("first page parameters = %+v", stub.searchArg)
	}
	data, err := base64.RawURLEncoding.DecodeString(string(*first.NextPaginationKey))
	if err != nil || strings.Contains(strings.ToLower(string(data)), "backend") {
		t.Fatalf("key %s holds the ideal-job text (%v)", data, err)
	}

	query := matchQuery(text)
	query.PaginationKey = first.NextPaginationKey
	if _, err := reader.Search(context.Background(), query); err != nil {
		t.Fatalf("next page: %v", err)
	}
	arg := stub.searchArg
	if arg.CursorRank != (pgtype.Float4{Float32: 0.2431708, Valid: true}) ||
		arg.CursorNumber.Int32 != 2 || arg.IdealJobText.String != text {
		t.Fatalf("cursor parameters = %+v", arg)
	}
}

func TestSearchKeyBindsSortAndText(t *testing.T) {
	reader := Reader{Queries: &queryStub{searchRows: rankedRows()}, TenantID: "sgp"}
	match, err := reader.Search(context.Background(), matchQuery("Go backend"))
	if err != nil || match.NextPaginationKey == nil {
		t.Fatalf("match page = %+v, %v", match, err)
	}
	limit := openingsspec.OpeningSearchPageSize(2)
	newestQuery := openingsspec.OpeningSearchQuery{
		OpeningSearchFilters: openingsspec.OpeningSearchFilters{Limit: &limit},
	}
	newest, err := reader.Search(context.Background(), newestQuery)
	if err != nil || newest.NextPaginationKey == nil {
		t.Fatalf("newest page = %+v, %v", newest, err)
	}

	changed := map[string]openingsspec.OpeningSearchQuery{
		"match key under newest": withKey(newestQuery, match.NextPaginationKey),
		"match key, other text":  withKey(matchQuery("Go frontend"), match.NextPaginationKey),
		"newest key under match": withKey(matchQuery("Go backend"), newest.NextPaginationKey),
	}
	for name, query := range changed {
		t.Run(name, func(t *testing.T) {
			stub := &queryStub{}
			_, err := Reader{Queries: stub, TenantID: "sgp"}.Search(context.Background(), query)
			if !errors.Is(err, ErrInvalidPaginationKey) || stub.calls != 0 {
				t.Fatalf("error %v, %d queries", err, stub.calls)
			}
		})
	}
}

func withKey(
	query openingsspec.OpeningSearchQuery, key *common.PaginationKey,
) openingsspec.OpeningSearchQuery {
	query.PaginationKey = key
	return query
}

func TestSearchNewestPassesNoText(t *testing.T) {
	stub := &queryStub{searchRows: rankedRows()}
	query := matchQuery("Go backend")
	query.Sort = new(openingsspec.SortNewest)
	first, err := Reader{Queries: stub, TenantID: "sgp"}.Search(context.Background(), query)
	if err != nil || first.NextPaginationKey == nil {
		t.Fatalf("newest page = %+v, %v", first, err)
	}
	if stub.searchArg.IdealJobText.Valid {
		t.Fatalf("newest search sent the text: %+v", stub.searchArg)
	}
}
