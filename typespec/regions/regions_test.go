package regions

import (
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func TestListSignupRegionsValidation(t *testing.T) {
	for _, tt := range []struct {
		country common.CountryCode
		key     *common.PaginationKey
		want    int
	}{
		{"IND", nil, 0}, {"ZZZ", nil, 1}, {"ind", nil, 1}, {"IND", new(common.PaginationKey("")), 1}, {"IND", new(common.PaginationKey("abc")), 0},
	} {
		r := ListSignupRegionsRequest{ResidentCountry: tt.country, PaginationKey: tt.key}
		r.Normalize()
		if len(r.Validate()) != tt.want {
			t.Fatalf("validation=%v", r.Validate())
		}
	}
}
