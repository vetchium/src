package listings

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/hiring"
	"github.com/vetchium/src/typespec/orgs/marketplace"

	"backend/internal/db/sqlc"
)

type queryStub struct {
	rows      []sqlc.SearchPublicListingsRow
	searchArg sqlc.SearchPublicListingsParams
	getRow    sqlc.GetPublicListingRow
	getErr    error
	getArg    sqlc.GetPublicListingParams
}

func (s *queryStub) SearchPublicListings(
	_ context.Context, arg sqlc.SearchPublicListingsParams,
) ([]sqlc.SearchPublicListingsRow, error) {
	s.searchArg = arg
	return s.rows, nil
}

func (s *queryStub) GetPublicListing(
	_ context.Context, arg sqlc.GetPublicListingParams,
) (sqlc.GetPublicListingRow, error) {
	s.getArg = arg
	return s.getRow, s.getErr
}

type logoStub struct{ calls int }

func (s *logoStub) SignLogoGet(context.Context, pgtype.UUID) (string, error) {
	s.calls++
	return "https://media.example/logo", nil
}

func row(name, domain string) sqlc.SearchPublicListingsRow {
	return sqlc.SearchPublicListingsRow{
		CapabilityOid: "background_check", Headline: "Checks for " + name,
		ServiceWorldwide: true, DisplayName: name, Domain: domain,
		Country: "SG", SortName: "sort-" + name,
		CheckTypes: []string{"identity"},
	}
}

func TestSearchPassesFiltersAndPlansToTheQuery(t *testing.T) {
	t.Parallel()
	stub := &queryStub{}
	reader := Reader{
		Queries: stub, ListingPlanOIDs: []string{"silver"}, LogoPlanOIDs: []string{"gold"},
	}
	country, language, query := common.CountryCode("IN"), common.LanguageTag("en"), "ab"
	_, err := reader.Search(context.Background(), marketplace.PeerSearchListingsRequest{
		Capability: marketplace.BackgroundCheck, Country: &country,
		Language: &language, CheckTypes: []hiring.CheckType{hiring.IdentityCheck},
		Query: &query, Limit: 5,
		After: &marketplace.ListingSearchPosition{SortName: "acme", Domain: "acme.test"},
	})
	if err != nil {
		t.Fatal(err)
	}
	arg := stub.searchArg
	if arg.CapabilityOid != "background_check" || arg.Country.String != "IN" ||
		arg.Language.String != "en" || !slices.Equal(arg.CheckTypes, []string{"identity"}) ||
		arg.Query.String != "ab" || arg.AfterName.String != "acme" ||
		arg.AfterDomain.String != "acme.test" || arg.PageLimit != 6 ||
		!slices.Equal(arg.ListingPlanOids, []string{"silver"}) ||
		!slices.Equal(arg.LogoPlanOids, []string{"gold"}) {
		t.Fatalf("query arguments = %+v", arg)
	}
	_, err = reader.Search(context.Background(), marketplace.PeerSearchListingsRequest{
		Capability: marketplace.Sourcing, Limit: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	arg = stub.searchArg
	if arg.Country.Valid || arg.Language.Valid || arg.CheckTypes != nil ||
		arg.Query.Valid || arg.AfterName.Valid || arg.AfterDomain.Valid {
		t.Fatalf("absent filters must be NULL: %+v", arg)
	}
}

func TestSearchReturnsOnePageAndSaysWhenMoreFollows(t *testing.T) {
	t.Parallel()
	stub := &queryStub{rows: []sqlc.SearchPublicListingsRow{
		row("a", "a.test"), row("b", "b.test"), row("c", "c.test"),
	}}
	response, err := Reader{Queries: stub}.Search(context.Background(),
		marketplace.PeerSearchListingsRequest{Capability: marketplace.BackgroundCheck, Limit: 2})
	if err != nil || len(response.Listings) != 2 || !response.HasMore {
		t.Fatalf("page = %+v, %v", response, err)
	}
	first := response.Listings[0]
	if first.SortName != "sort-a" || first.Listing.Provider.Domain != "a.test" ||
		first.Listing.Provider.Country != "SG" ||
		len(first.Listing.CheckTypes) != 1 ||
		first.Listing.Languages == nil || first.Listing.Service.Countries == nil {
		t.Fatalf("summary = %+v", first)
	}
	stub.rows = stub.rows[:2]
	response, err = Reader{Queries: stub}.Search(context.Background(),
		marketplace.PeerSearchListingsRequest{Capability: marketplace.BackgroundCheck, Limit: 2})
	if err != nil || len(response.Listings) != 2 || response.HasMore {
		t.Fatalf("last page = %+v, %v", response, err)
	}
	stub.rows = nil
	response, err = Reader{Queries: stub}.Search(context.Background(),
		marketplace.PeerSearchListingsRequest{Capability: marketplace.BackgroundCheck, Limit: 2})
	if err != nil || response.Listings == nil || len(response.Listings) != 0 {
		t.Fatalf("empty page = %+v, %v", response, err)
	}
}

func TestSearchSignsOnlyAvailableLogos(t *testing.T) {
	t.Parallel()
	withLogo := row("a", "a.test")
	withLogo.LogoObjectID = pgtype.UUID{Valid: true}
	stub := &queryStub{rows: []sqlc.SearchPublicListingsRow{withLogo, row("b", "b.test")}}
	logos := &logoStub{}
	response, err := Reader{Queries: stub, Logos: logos}.Search(context.Background(),
		marketplace.PeerSearchListingsRequest{Capability: marketplace.BackgroundCheck, Limit: 5})
	if err != nil || logos.calls != 1 ||
		response.Listings[0].Listing.Provider.LogoURL == nil ||
		response.Listings[1].Listing.Provider.LogoURL != nil {
		t.Fatalf("logos = %+v calls=%d, %v", response, logos.calls, err)
	}
	if _, err := (Reader{Queries: stub}).Search(context.Background(),
		marketplace.PeerSearchListingsRequest{Capability: marketplace.BackgroundCheck, Limit: 5}); err == nil {
		t.Fatal("a logo without a signer must not be silently dropped")
	}
}

func TestGetMapsTheListingAndHidesAbsentOnes(t *testing.T) {
	t.Parallel()
	disclosure := "We verify."
	stub := &queryStub{getRow: sqlc.GetPublicListingRow{
		CapabilityOid: "background_check", Headline: "H", Description: "D",
		ServiceCountries: []string{"IN"}, Languages: []string{"en"},
		CheckTypes:        []string{"identity", "education"},
		ConsentDisclosure: pgtype.Text{String: disclosure, Valid: true},
		Domain:            "acme.test", DisplayName: "Acme", Country: "IN",
	}}
	reader := Reader{Queries: stub, ListingPlanOIDs: []string{"silver"}}
	detail, err := reader.Get(context.Background(), marketplace.GetListingRequest{
		Domain: orgs.OrgDomain("acme.test"), Capability: marketplace.BackgroundCheck,
	})
	if err != nil || detail.Description != "D" || *detail.ConsentDisclosure != disclosure ||
		detail.Provider.Domain != "acme.test" || len(detail.CheckTypes) != 2 ||
		detail.Service.Worldwide || len(detail.Service.Countries) != 1 {
		t.Fatalf("detail = %+v, %v", detail, err)
	}
	if stub.getArg.Domain != "acme.test" || stub.getArg.CapabilityOid != "background_check" ||
		!slices.Equal(stub.getArg.ListingPlanOids, []string{"silver"}) {
		t.Fatalf("query arguments = %+v", stub.getArg)
	}
	stub.getErr = pgx.ErrNoRows
	if _, err := reader.Get(context.Background(), marketplace.GetListingRequest{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing Listing error = %v", err)
	}
	stub.getErr = errors.New("database down")
	if _, err := reader.Get(context.Background(), marketplace.GetListingRequest{}); err == nil || errors.Is(err, ErrNotFound) {
		t.Fatalf("database error = %v", err)
	}
}
