package openings

import (
	"slices"
	"testing"

	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"
)

func TestRelayProblemAllowsOnlyPublicOpeningProblems(t *testing.T) {
	for _, tc := range []struct{ upstream, want string }{
		{hubproblem.OrgNotFoundError.Type, hubproblem.OrgNotFoundError.Type},
		{hubproblem.OpeningNotFoundError.Type, hubproblem.OpeningNotFoundError.Type},
		{problem.InvalidPaginationKeyError.Type, problem.InvalidPaginationKeyError.Type},
		{problem.InternalServerError.Type, hubproblem.OrgUnavailableError.Type},
		{"unexpected-private-problem", hubproblem.OrgUnavailableError.Type},
	} {
		if got := relayProblem(tc.upstream).Type; got != tc.want {
			t.Errorf("relay problem %q = %q, want %q", tc.upstream, got, tc.want)
		}
	}
}

func TestSearchRelayProblemForwardsOnlyQueryFaults(t *testing.T) {
	validation := problem.ValidationFailedError
	validation.Fields = []string{"query.keyword", "query.tag_oids.1"}
	got := searchRelayProblem(validation)
	if got.Type != problem.ValidationFailedError.Type ||
		!slices.Equal(got.Fields, []string{"keyword", "tag_oids.1"}) {
		t.Fatalf("validation problem = %+v", got)
	}
	tenantOnly := problem.ValidationFailedError
	tenantOnly.Fields = []string{"tenant_id"}
	for _, tc := range []struct {
		upstream problem.Details
		want     string
	}{
		{problem.InvalidPaginationKeyError, problem.InvalidPaginationKeyError.Type},
		{tenantOnly, hubproblem.RegionUnavailableError.Type},
		{problem.InvalidJSONError, hubproblem.RegionUnavailableError.Type},
		{hubproblem.RegionUnavailableError, hubproblem.RegionUnavailableError.Type},
		{problem.InternalServerError, hubproblem.RegionUnavailableError.Type},
		{problem.Details{Type: "unexpected-private-problem"}, hubproblem.RegionUnavailableError.Type},
	} {
		if got := searchRelayProblem(tc.upstream).Type; got != tc.want {
			t.Errorf("relay problem %q = %q, want %q", tc.upstream.Type, got, tc.want)
		}
	}
}
