package publicopenings

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

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
