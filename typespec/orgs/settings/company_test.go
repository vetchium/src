package settings

import (
	"github.com/vetchium/src/typespec/common"
	"strings"
	"testing"
)

func TestCompanyName(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name  string
		valid bool
	}{{"  நிறுவனம்  ", true}, {"", false}, {" \t ", false}, {strings.Repeat("界", 200), true}, {strings.Repeat("界", 201), false}} {
		r := SetCompanyNameRequest{DisplayName: common.DisplayName(test.name)}
		r.Normalize()
		if (len(r.Validate()) == 0) != test.valid {
			t.Errorf("valid=%t for name length %d", !test.valid, len([]rune(test.name)))
		}
	}
}
