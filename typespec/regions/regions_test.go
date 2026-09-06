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
		{"IN", nil, 0}, {"ZZ", nil, 1}, {"in", nil, 1}, {"IN", new(common.PaginationKey("")), 1}, {"IN", new(common.PaginationKey("abc")), 0},
	} {
		r := ListSignupRegionsRequest{ResidentCountry: tt.country, PaginationKey: tt.key}
		r.Normalize()
		if len(r.Validate()) != tt.want {
			t.Fatalf("validation=%v", r.Validate())
		}
	}
}
