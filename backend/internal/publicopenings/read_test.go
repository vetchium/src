package publicopenings

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	openingsspec "github.com/vetchium/src/typespec/hub/openings"
	"github.com/vetchium/src/typespec/orgs"

	"backend/internal/db/sqlc"
)

type queryStub struct {
	listRow sqlc.ListPublicOrgOpeningsRow
	listArg sqlc.ListPublicOrgOpeningsParams
	calls   int
}

func (s *queryStub) ListPublicOrgOpenings(
	_ context.Context, arg sqlc.ListPublicOrgOpeningsParams,
) (sqlc.ListPublicOrgOpeningsRow, error) {
	s.calls++
	s.listArg = arg
	return s.listRow, nil
}

func (s *queryStub) GetPublicOrgOpening(
	context.Context, sqlc.GetPublicOrgOpeningParams,
) (sqlc.GetPublicOrgOpeningRow, error) {
	panic("unexpected get")
}

func (s *queryStub) ListPublicOpeningAgencies(
	context.Context, sqlc.ListPublicOpeningAgenciesParams,
) (sqlc.ListPublicOpeningAgenciesRow, error) {
	return sqlc.ListPublicOpeningAgenciesRow{}, nil
}

type logoStub struct{ calls int }

func (s *logoStub) SignLogoGet(_ context.Context, _ pgtype.UUID) (string, error) {
	s.calls++
	return "https://media.example/logo", nil
}

func TestListPublicOrgOpeningsBindsPaginationToFilters(t *testing.T) {
	stub := &queryStub{listRow: sqlc.ListPublicOrgOpeningsRow{
		DisplayName: "Example",
		Openings: []byte(`[{"opening_number":2,"title":"Second",` +
			`"employing_country":"SG","work_arrangement":"hybrid",` +
			`"employment_type":"full_time",` +
			`"first_published_at":"2026-10-11T01:00:00Z"},` +
			`{"opening_number":1,"title":"First",` +
			`"employing_country":"SG","work_arrangement":"hybrid",` +
			`"employment_type":"full_time",` +
			`"first_published_at":"2026-10-10T01:00:00Z"}]`),
	}}
	reader := Reader{Queries: stub}
	limit := openingsspec.OpeningPageSize(1)
	request := openingsspec.ListOrgOpeningsRequest{
		Domain: orgs.OrgDomain("example.com"), Limit: &limit,
	}
	first, err := reader.List(context.Background(), request)
	if err != nil || len(first.Openings) != 1 || first.NextPaginationKey == nil {
		t.Fatalf("first page = %+v, %v", first, err)
	}
	request.PaginationKey = first.NextPaginationKey
	_, err = reader.List(context.Background(), request)
	if err != nil || !stub.listArg.CursorAt.Valid ||
		stub.listArg.CursorNumber.Int32 != 2 || stub.listArg.PageSize != 2 {
		t.Fatalf("next page query = %+v, %v", stub.listArg, err)
	}
	calls := stub.calls
	title := openingsspec.OpeningTitleQuery("different")
	request.TitleQuery = &title
	if _, err := reader.List(context.Background(), request); !errors.Is(err, ErrInvalidPaginationKey) {
		t.Fatalf("filter-bound key error = %v", err)
	}
	if stub.calls != calls {
		t.Fatal("invalid key reached database")
	}
}

func TestListPublicOrgOpeningsSignsOnlyAvailableLogo(t *testing.T) {
	stub := &queryStub{listRow: sqlc.ListPublicOrgOpeningsRow{
		DisplayName: "Example", Country: "SG", Openings: []byte(`[]`),
		LogoObjectID: pgtype.UUID{Valid: true},
	}}
	logo := &logoStub{}
	reader := Reader{Queries: stub, Logos: logo}
	response, err := reader.List(context.Background(),
		openingsspec.ListOrgOpeningsRequest{Domain: "example.com"})
	if err != nil || response.Org.LogoURL == nil || logo.calls != 1 ||
		response.Org.Country != "SG" {
		t.Fatalf("signed Org = %+v, %v", response.Org, err)
	}
	stub.listRow.LogoObjectID = pgtype.UUID{}
	response, err = reader.List(context.Background(),
		openingsspec.ListOrgOpeningsRequest{Domain: "example.com"})
	if err != nil || response.Org.LogoURL != nil || logo.calls != 1 {
		t.Fatalf("Org without logo = %+v, %v", response.Org, err)
	}
}

func TestListPublicOrgOpeningsFiltersByTagAndDecodesTags(t *testing.T) {
	stub := &queryStub{listRow: sqlc.ListPublicOrgOpeningsRow{
		DisplayName: "Example",
		Openings: []byte(`[{"opening_number":2,"title":"Second",` +
			`"employing_country":"SG","work_arrangement":"hybrid",` +
			`"employment_type":"full_time",` +
			`"first_published_at":"2026-10-11T01:00:00Z",` +
			`"tags":["golang","rust"]},` +
			`{"opening_number":1,"title":"First",` +
			`"employing_country":"SG","work_arrangement":"hybrid",` +
			`"employment_type":"full_time",` +
			`"first_published_at":"2026-10-10T01:00:00Z","tags":["golang"]}]`),
	}}
	reader := Reader{Queries: stub}
	limit := openingsspec.OpeningPageSize(1)
	tag := common.OpeningTagOID("golang")
	request := openingsspec.ListOrgOpeningsRequest{
		Domain: "example.com", TagOID: &tag, Limit: &limit,
	}
	first, err := reader.List(context.Background(), request)
	if err != nil || len(first.Openings) != 1 || first.NextPaginationKey == nil {
		t.Fatalf("first page = %+v, %v", first, err)
	}
	if stub.listArg.TagOid != (pgtype.Text{String: "golang", Valid: true}) {
		t.Fatalf("tag parameter = %+v", stub.listArg.TagOid)
	}
	if !slices.Equal(first.Openings[0].Tags, []common.OpeningTagOID{"golang", "rust"}) {
		t.Fatalf("summary tags = %v", first.Openings[0].Tags)
	}
	calls := stub.calls
	other := common.OpeningTagOID("rust")
	request.TagOID = &other
	request.PaginationKey = first.NextPaginationKey
	if _, err := reader.List(context.Background(), request); !errors.Is(err, ErrInvalidPaginationKey) {
		t.Fatalf("tag-bound key error = %v", err)
	}
	if stub.calls != calls {
		t.Fatal("invalid key reached database")
	}
}

func TestListPublicOrgOpeningsDecodesSalary(t *testing.T) {
	stub := &queryStub{listRow: sqlc.ListPublicOrgOpeningsRow{
		DisplayName: "Example",
		Openings: []byte(`[{"opening_number":2,"title":"Paid",` +
			`"employing_country":"SG","work_arrangement":"hybrid",` +
			`"employment_type":"full_time",` +
			`"first_published_at":"2026-10-11T01:00:00Z","tags":[],` +
			`"salary":{"currency":"SGD","min":5000,"max":8000,"period":"month"}},` +
			`{"opening_number":1,"title":"Undisclosed",` +
			`"employing_country":"SG","work_arrangement":"hybrid",` +
			`"employment_type":"full_time",` +
			`"first_published_at":"2026-10-10T01:00:00Z","tags":[]}]`),
	}}
	response, err := Reader{Queries: stub}.List(context.Background(),
		openingsspec.ListOrgOpeningsRequest{Domain: "example.com"})
	if err != nil || len(response.Openings) != 2 {
		t.Fatalf("list = %+v, %v", response, err)
	}
	want := common.OpeningSalary{
		Currency: "SGD", Min: 5000, Max: 8000, Period: common.OpeningMonth,
	}
	if got := response.Openings[0].Salary; got == nil || *got != want {
		t.Fatalf("disclosed salary = %+v", got)
	}
	if got := response.Openings[1].Salary; got != nil {
		t.Fatalf("undisclosed salary = %+v", got)
	}
}
