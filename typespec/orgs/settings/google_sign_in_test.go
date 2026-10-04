package settings

import (
	"encoding/json"
	"testing"
)

func TestGoogleSignInRequiresExplicitBoolean(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		body  string
		valid bool
	}{
		{`{}`, false}, {`{"enabled":null}`, false},
		{`{"enabled":true}`, true}, {`{"enabled":false}`, true},
	} {
		t.Run(tc.body, func(t *testing.T) {
			var request SetGoogleSignInRequest
			if err := json.Unmarshal([]byte(tc.body), &request); err != nil {
				t.Fatal(err)
			}
			request.Normalize()
			fields := request.Validate()
			if tc.valid && len(fields) != 0 {
				t.Fatalf("unexpected validation: %v", fields)
			}
			if !tc.valid && (len(fields) != 1 || fields[0] != "enabled") {
				t.Fatalf("missing enabled validation: %v", fields)
			}
		})
	}
}
