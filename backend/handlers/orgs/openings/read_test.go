package openings

import (
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/openings"
)

func TestOpeningFiltersHashExcludesPagePosition(t *testing.T) {
	query := openings.OpeningTitleQuery("engineer")
	first := openings.ListOpeningsRequest{TitleQuery: &query}
	initial, err := openingFiltersHash(first)
	if err != nil {
		t.Fatal(err)
	}
	limit := common.PageSize(2)
	key := common.PaginationKey("cursor")
	first.Limit = &limit
	first.PaginationKey = &key
	continued, err := openingFiltersHash(first)
	if err != nil {
		t.Fatal(err)
	}
	if initial != continued {
		t.Fatal("page position changed filter binding")
	}
	other := openings.OpeningTitleQuery("designer")
	first.TitleQuery = &other
	changed, err := openingFiltersHash(first)
	if err != nil {
		t.Fatal(err)
	}
	if initial == changed {
		t.Fatal("different filters share a pagination binding")
	}
}
