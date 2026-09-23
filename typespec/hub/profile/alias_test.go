package profile

import (
	"encoding/json"
	"slices"
	"testing"
)

func TestSetAliasRequestRequiresExplicitValue(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		body string
		want []string
	}{
		{`{"profile_alias":"a-b"}`, []string{}},
		{`{"profile_alias":null}`, []string{}},
		{`{}`, []string{"profile_alias"}},
		{`{"profile_alias":"api"}`, []string{"profile_alias"}},
		{`{"profile_alias":"alice--2"}`, []string{"profile_alias"}},
	} {
		var request SetAliasRequest
		if err := json.Unmarshal([]byte(test.body), &request); err != nil {
			t.Fatal(err)
		}
		if got := request.Validate(); !slices.Equal(got, test.want) {
			t.Errorf("%s fields = %v, want %v", test.body, got, test.want)
		}
	}
}
