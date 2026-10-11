package mesh

import (
	"testing"

	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"
)

func TestOpeningPeerProblemAllowsOnlyPublicOpeningProblems(t *testing.T) {
	for _, tc := range []struct{ upstream, want string }{
		{hubproblem.OrgNotFoundError.Type, hubproblem.OrgNotFoundError.Type},
		{hubproblem.OpeningNotFoundError.Type, hubproblem.OpeningNotFoundError.Type},
		{problem.InvalidPaginationKeyError.Type, problem.InvalidPaginationKeyError.Type},
		{problem.InternalServerError.Type, hubproblem.OrgUnavailableError.Type},
		{"unexpected-private-problem", hubproblem.OrgUnavailableError.Type},
	} {
		if got := openingPeerProblem(tc.upstream).Type; got != tc.want {
			t.Errorf("peer problem %q = %q, want %q", tc.upstream, got, tc.want)
		}
	}
}
