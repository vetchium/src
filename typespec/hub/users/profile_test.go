package users

import (
	"encoding/json"
	"testing"
)

func TestAgenciesMayMessageRequiresExplicitBoolean(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		body  string
		valid bool
	}{
		{`{}`, false}, {`{"agencies_may_message":null}`, false},
		{`{"agencies_may_message":true}`, true},
		{`{"agencies_may_message":false}`, true},
	} {
		t.Run(tc.body, func(t *testing.T) {
			var request SetAgenciesMayMessageRequest
			if err := json.Unmarshal([]byte(tc.body), &request); err != nil {
				t.Fatal(err)
			}
			request.Normalize()
			fields := request.Validate()
			if tc.valid && len(fields) != 0 {
				t.Fatalf("unexpected validation: %v", fields)
			}
			if !tc.valid &&
				(len(fields) != 1 || fields[0] != "agencies_may_message") {
				t.Fatalf("missing agencies_may_message validation: %v", fields)
			}
		})
	}
}
