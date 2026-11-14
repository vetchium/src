package users

import (
	"encoding/json"
	"strings"
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

func TestSetIdealJobNormalizesAndCountsCodePoints(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, input, normalized string
		valid                   bool
	}{
		{"trimmed", "  first\nsecond  ", "first\nsecond", true},
		{"whitespace only", " \n\t ", "", true},
		{"2000 astral", strings.Repeat("😀", 2000), strings.Repeat("😀", 2000), true},
		{"2001 astral", strings.Repeat("😀", 2001), strings.Repeat("😀", 2001), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := tc.input
			request := SetIdealJobRequest{IdealJob: &input}
			request.Normalize()
			if *request.IdealJob != tc.normalized || input != tc.input {
				t.Fatalf("normalized to %q from %q", *request.IdealJob, input)
			}
			fields := request.Validate()
			if tc.valid && len(fields) != 0 {
				t.Fatalf("unexpected validation: %v", fields)
			}
			if !tc.valid && (len(fields) != 1 || fields[0] != "ideal_job") {
				t.Fatalf("missing ideal_job validation: %v", fields)
			}
		})
	}
}

func TestSetIdealJobRequiresAValue(t *testing.T) {
	t.Parallel()
	for _, body := range []string{`{}`, `{"ideal_job":null}`} {
		var request SetIdealJobRequest
		if err := json.Unmarshal([]byte(body), &request); err != nil {
			t.Fatal(err)
		}
		request.Normalize()
		if fields := request.Validate(); len(fields) != 1 ||
			fields[0] != "ideal_job" {
			t.Fatalf("%s: missing ideal_job validation: %v", body, fields)
		}
	}
}

func TestLookingForJobRequiresExplicitBoolean(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		body  string
		valid bool
	}{
		{`{}`, false}, {`{"looking_for_job":null}`, false},
		{`{"looking_for_job":true}`, true},
		{`{"looking_for_job":false}`, true},
	} {
		t.Run(tc.body, func(t *testing.T) {
			var request SetLookingForJobRequest
			if err := json.Unmarshal([]byte(tc.body), &request); err != nil {
				t.Fatal(err)
			}
			request.Normalize()
			fields := request.Validate()
			if tc.valid && len(fields) != 0 {
				t.Fatalf("unexpected validation: %v", fields)
			}
			if !tc.valid &&
				(len(fields) != 1 || fields[0] != "looking_for_job") {
				t.Fatalf("missing looking_for_job validation: %v", fields)
			}
		})
	}
}
