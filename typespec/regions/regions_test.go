package regions

import (
	"slices"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func TestListSignupRegionsValidation(t *testing.T) {
	for _, tt := range []struct {
		country common.CountryCode
		key     *common.PaginationKey
		want    int
	}{
		{"IN", nil, 0}, {"ZZ", nil, 1}, {"in", nil, 1}, {"IN", new(common.PaginationKey("")), 1}, {"IN", new(common.PaginationKey("abc")), 0},
	} {
		r := ListSignupRegionsRequest{ResidentCountry: tt.country, PaginationKey: tt.key}
		r.Normalize()
		if len(r.Validate()) != tt.want {
			t.Fatalf("validation=%v", r.Validate())
		}
	}
}

func TestListOrgSignupRegionsValidation(t *testing.T) {
	for _, tt := range []struct {
		country common.CountryCode
		key     *common.PaginationKey
		want    []string
	}{
		{"IN", nil, []string{}},
		{"IN", new(common.PaginationKey("abc")), []string{}},
		{"ZZ", nil, []string{"country"}},
		{"in", nil, []string{"country"}},
		{"", nil, []string{"country"}},
		{"IN", new(common.PaginationKey("")), []string{"pagination_key"}},
		{
			"ZZ", new(common.PaginationKey("")),
			[]string{"country", "pagination_key"},
		},
	} {
		r := ListOrgSignupRegionsRequest{
			Country: tt.country, PaginationKey: tt.key,
		}
		before := r
		r.Normalize()
		if r != before {
			t.Fatalf("Normalize() changed %+v to %+v", before, r)
		}
		if got := r.Validate(); !slices.Equal(got, tt.want) {
			t.Fatalf("Validate(%+v) = %v, want %v", r, got, tt.want)
		}
	}
}
