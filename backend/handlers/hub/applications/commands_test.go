package applications

import (
	"testing"

	"github.com/vetchium/src/typespec/problem"
	federationproblem "github.com/vetchium/src/typespec/problem/federation"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"
)

// Only the rejections the Hub contract declares pass to the browser; an
// initiator mismatch or a malformed command is a fault between tenants.
func TestStoredRejectionsMapOnlyToDeclaredHubProblems(t *testing.T) {
	for _, tc := range []struct {
		name  string
		known map[string]problem.Details
		want  map[string]string
	}{
		{"apply", applyRejections, map[string]string{
			hubproblem.OpeningNotFoundError.Type:           hubproblem.OpeningNotFoundError.Type,
			hubproblem.OpeningNotAcceptingError.Type:       hubproblem.OpeningNotAcceptingError.Type,
			hubproblem.ApplicationExistsError.Type:         hubproblem.ApplicationExistsError.Type,
			hubproblem.ReferralAgencyNotEligibleError.Type: hubproblem.ReferralAgencyNotEligibleError.Type,
			federationproblem.AuthorityNotFoundError.Type:  hubproblem.OrgNotFoundError.Type,
		}},
		{"withdraw", withdrawRejections, map[string]string{
			hubproblem.ApplicationNotFoundError.Type:      hubproblem.ApplicationNotFoundError.Type,
			hubproblem.ApplicationStateConflictError.Type: hubproblem.ApplicationStateConflictError.Type,
			federationproblem.AuthorityNotFoundError.Type: hubproblem.ApplicationNotFoundError.Type,
		}},
	} {
		if len(tc.known) != len(tc.want) {
			t.Errorf("%s maps %d problems, want %d", tc.name, len(tc.known), len(tc.want))
		}
		for upstream, want := range tc.want {
			if got := tc.known[upstream].Type; got != want {
				t.Errorf("%s %q = %q, want %q", tc.name, upstream, got, want)
			}
		}
		for _, fault := range []string{
			federationproblem.InitiatorMismatchError.Type,
			problem.ValidationFailedError.Type,
		} {
			if _, ok := tc.known[fault]; ok {
				t.Errorf("%s passes %q to the browser", tc.name, fault)
			}
		}
	}
}
